//! The native menu, and how a click on it reaches the window (S0.1).
//!
//! **These were buttons in the corner of the window.** Open a project, save it, save a copy — verbs
//! about the application rather than about anything on screen, sitting in a strip that
//! [Q39](../../docs/decisions.md) had already emptied of its original purpose. A menu is where a
//! person looks for them, and it is the one place that gets accelerators, platform conventions and
//! keyboard navigation without any of it being written here.
//!
//! **Nothing about what the actions *do* moves.** The menu emits [`EVENT`] with the id of what was
//! chosen and stops there; the actions stay in `App.svelte`, beside the state they already touch.
//! That is the same shape as `studio://opened`, and it is what keeps this file declarative.
//!
//! **The Edit submenu exists to keep the webview usable, not to add features.** On macOS, a custom
//! menu that omits cut, copy, paste and select-all takes those shortcuts away from every text field
//! in the window — including the VPL editor. Undo and redo are deliberately *not* here: an
//! accelerator is handled before the webview sees the key, so a `⌘Z` menu item would take the
//! keystroke away from the document-wide undo in `App.svelte` and hand it to whichever text box
//! happened to have focus.

use anyhow::{Context, Result};
use tauri::menu::{Menu, MenuId, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry};

/// What the webview hears when something is chosen. The payload is the item's id.
pub const EVENT: &str = "studio://menu";

/// The File submenu's own id, so an item inside it can be found again to be enabled or disabled.
const FILE: &str = "file";

/// Items whose availability depends on what is open, named once so both ends agree.
pub const SAVE_PROJECT: &str = "save-project";
pub const SAVE_COPY: &str = "save-copy";

/// Named because it moves between submenus by platform, and both places must spell it the same.
const CHECK_UPDATES: &str = "check-updates";

/// Builds the menu and hands it to the application.
///
/// App-wide rather than per-window: on macOS that is the only kind there is, and elsewhere Tauri
/// gives it to every window that has not asked for one of its own — including windows opened later.
pub fn install(app: &AppHandle) -> Result<()> {
	let menu = build(app).context("building the menu")?;
	app.set_menu(menu).context("setting the menu")?;
	Ok(())
}

fn build(app: &AppHandle) -> Result<Menu<Wry>> {
	let menu = Menu::new(app)?;

	// The application submenu, which on macOS is the one holding About and Quit. Elsewhere there is
	// no such convention and Quit lives at the bottom of File.
	#[cfg(target_os = "macos")]
	{
		menu.append(&application(app)?)?;
	}

	menu.append(&file(app)?)?;

	// Fonts and updates are about *Studio* rather than about the project. macOS has a place for
	// exactly that and every Mac user knows where it is; nowhere else does, so elsewhere they get a
	// submenu of their own rather than being wedged into File, which is about documents.
	#[cfg(not(target_os = "macos"))]
	{
		menu.append(&tools(app)?)?;
	}

	#[cfg(target_os = "macos")]
	{
		menu.append(&edit(app)?)?;
		menu.append(&window(app)?)?;
	}

	menu.append(&help(app)?)?;
	Ok(menu)
}

#[cfg(target_os = "macos")]
fn application(app: &AppHandle) -> Result<Submenu<Wry>> {
	Ok(SubmenuBuilder::new(app, "VersaTiles Studio")
		.about(None)
		.text(CHECK_UPDATES, "Check for Updates…")
		.separator()
		.text("fonts", "Fonts…")
		.separator()
		.services()
		.separator()
		.hide()
		.hide_others()
		.show_all()
		.separator()
		.quit()
		.build()?)
}

/// Opening and saving — everything that is about the project rather than about the selection.
///
/// **`⌘S` saves the *project*.** It used to save the current `.vpl`, which was right when a window
/// held one document and became quietly wrong when [Q6](../../docs/decisions.md) made a project the
/// thing you open and share. The pipeline keeps its own Save and Save as… buttons in the pane that
/// owns it ([Q31](../../docs/decisions.md)); what it loses is a shortcut that named the wrong noun.
fn file(app: &AppHandle) -> Result<Submenu<Wry>> {
	#[cfg_attr(target_os = "macos", allow(unused_mut))]
	let mut file = SubmenuBuilder::with_id(app, FILE, "File")
		.text("new-project", "New Project…")
		.separator()
		.text("open", "Open…")
		.text("open-project", "Open Project…")
		.separator()
		.text(SAVE_PROJECT, "Save Project")
		.text("save-project-as", "Save Project As…")
		.text(SAVE_COPY, "Save a Copy…");

	// On macOS both of these live where the platform puts them — Close in the Window submenu, Quit
	// in the application one — and repeating them here would put two ⌘W items in one menu bar.
	#[cfg(not(target_os = "macos"))]
	{
		file = file.separator().close_window().separator().quit();
	}

	let file = file.build()?;
	accelerate(&file, "new-project", "CmdOrCtrl+N")?;
	accelerate(&file, "open", "CmdOrCtrl+O")?;
	accelerate(&file, "open-project", "CmdOrCtrl+Shift+O")?;
	accelerate(&file, SAVE_PROJECT, "CmdOrCtrl+S")?;
	accelerate(&file, "save-project-as", "CmdOrCtrl+Shift+S")?;
	Ok(file)
}

/// What is about Studio rather than about the project. macOS puts these in the application submenu.
#[cfg(not(target_os = "macos"))]
fn tools(app: &AppHandle) -> Result<Submenu<Wry>> {
	Ok(SubmenuBuilder::new(app, "Tools")
		.text("fonts", "Fonts…")
		.separator()
		.text(CHECK_UPDATES, "Check for Updates…")
		.build()?)
}

/// The clipboard, and nothing else. See this module's note on why undo is not here.
#[cfg(target_os = "macos")]
fn edit(app: &AppHandle) -> Result<Submenu<Wry>> {
	Ok(SubmenuBuilder::new(app, "Edit")
		.cut()
		.copy()
		.paste()
		.separator()
		.select_all()
		.build()?)
}

#[cfg(target_os = "macos")]
fn window(app: &AppHandle) -> Result<Submenu<Wry>> {
	Ok(SubmenuBuilder::new(app, "Window")
		.minimize()
		.separator()
		.close_window()
		.build()?)
}

/// Where a problem goes (S6.8), and where the source is.
fn help(app: &AppHandle) -> Result<Submenu<Wry>> {
	Ok(SubmenuBuilder::new(app, "Help")
		.text("problems", "Problems…")
		.text("report-problem", "Report a Problem…")
		.text("show-log", "Show Problem Log")
		.separator()
		.text("repository", "VersaTiles Studio on GitHub")
		.build()?)
}

/// Sets an accelerator after the fact.
///
/// `SubmenuBuilder::text` takes no accelerator, and building each item separately to give it one
/// costs a `let` and a `.item()` per line — six of them, for a submenu whose shape is the thing
/// worth reading. This keeps the shape above and the keys beside each other.
fn accelerate(submenu: &Submenu<Wry>, id: &str, keys: &str) -> Result<()> {
	let item = submenu
		.get(id)
		.with_context(|| format!("no menu item {id:?} to give an accelerator to"))?;
	item
		.as_menuitem()
		.with_context(|| format!("{id:?} is not a plain menu item"))?
		.set_accelerator(Some(keys))?;
	Ok(())
}

/// Turns a choice into an event for the window in front of the person who made it.
///
/// **To the focused window, not to all of them.** The menu is app-wide on macOS, and one window per
/// project ([Q16](../../docs/decisions.md)) means "save" broadcast everywhere would save every
/// project open on the machine.
pub fn chosen(app: &AppHandle, id: &MenuId) {
	// **Answered here, because no window is involved in the answer.** Everything else acts on the
	// project in front of someone; opening a window is the shell's own errand, and sending it
	// through a webview only to have it call back would put a round trip between the key and the
	// window.
	// **⌘N opens the launcher**, which is what starting a project now means ([Q48], S7.5). It used
	// to open an empty project window — a window that could do nothing until you used File → Open,
	// which is the launcher's job said less well.
	if id.0 == "new-project" {
		if let Err(error) = crate::windows::open_launcher(app) {
			let state = app.state::<crate::state::AppState>();
			crate::warn(&state.diagnostics, "Could not open the launcher", &error);
		}
		return;
	}

	// Answered here for the same reason as the one below it: showing a file in the file manager is
	// the shell's errand, and the file is the application's own — no window is involved in either.
	if id.0 == "show-log" {
		if let Err(error) = crate::commands::diagnostics::reveal_log(app) {
			let state = app.state::<crate::state::AppState>();
			crate::warn(&state.diagnostics, "Could not show the problem log", &error);
		}
		return;
	}

	// **The focused one, found by asking.** `get_focused_window` is behind Tauri's `unstable`
	// feature, and a menu is not worth an unstable feature flag.
	let Some(window) = app
		.webview_windows()
		.into_values()
		.find(|window| window.is_focused().unwrap_or(false))
	else {
		// Nothing is focused — a menu reached through the macOS menu bar with every window hidden.
		// There is no window to act in, and no way to say so that anybody would see.
		return;
	};
	if let Err(error) = app.emit_to(window.label(), EVENT, id.0.as_str()) {
		let state = app.state::<crate::state::AppState>();
		crate::warn(
			&state.diagnostics,
			"A menu choice did not reach the window",
			&anyhow::Error::new(error),
		);
	}
}

/// Enables or disables the items that need something to be open.
///
/// **The webview says when.** Whether there is a project is a question about what is on screen, and
/// the menu cannot read `$derived` — so this is pushed down rather than pulled up.
pub fn set_enabled(app: &AppHandle, id: &str, enabled: bool) -> Result<()> {
	let menu = app.menu().context("the application has no menu")?;
	let file = menu.get(FILE).context("the menu has no File submenu")?;
	let file = file.as_submenu().context("File is not a submenu")?;
	let item = file.get(id).with_context(|| format!("no menu item {id:?}"))?;
	item
		.as_menuitem()
		.with_context(|| format!("{id:?} is not a plain menu item"))?
		.set_enabled(enabled)?;
	Ok(())
}
