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

/// The submenus whose items are enabled and disabled, by id, so they can be found again.
const FILE: &str = "file";
const HELP: &str = "help";

/// Items whose availability depends on what is open, named once so both ends agree.
const SAVE_PROJECT: &str = "save-project";
const SAVE_PROJECT_AS: &str = "save-project-as";
const SAVE_COPY: &str = "save-copy";
const PROBLEMS: &str = "problems";

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
		.text(SAVE_PROJECT_AS, "Save Project As…")
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
	accelerate(&file, SAVE_PROJECT_AS, "CmdOrCtrl+Shift+S")?;
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
	Ok(SubmenuBuilder::with_id(app, HELP, "Help")
		.text(PROBLEMS, "Problems…")
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

/// Enables and disables the items for the window in front of the person reading them (S7.8).
///
/// **Applied per window, because on macOS there is one menu for all of them.** A focused launcher
/// that disabled Save would disable it for the project window behind it — so this runs whenever a
/// window takes focus, and again whenever the focused window's own answer changes.
///
/// **The answer comes from the core, not from the webview.** Whether there is anything to save is
/// something the project already knows; a flag pushed up from a `$derived` would be a second copy of
/// it, and two copies of one fact disagree the first time one of them is not sent.
pub async fn apply(app: &AppHandle, state: &crate::state::AppState, label: &str) -> Result<()> {
	// The launcher holds no project and never will: it exists to make one somewhere else.
	let has_project = match state.projects.peek(label).await {
		Some(project) => !project.lock().await.graphs.list().is_empty(),
		None => false,
	};
	let is_launcher = label == crate::windows::LAUNCHER;

	set_enabled(app, FILE, SAVE_PROJECT, has_project)?;
	set_enabled(app, FILE, SAVE_PROJECT_AS, has_project)?;
	set_enabled(app, FILE, SAVE_COPY, has_project)?;
	// The launcher has no status bar to expand, so there would be nothing for this to open there.
	set_enabled(app, HELP, PROBLEMS, !is_launcher)?;
	Ok(())
}

/// Enables or disables one item of one submenu.
fn set_enabled(app: &AppHandle, submenu: &str, id: &str, enabled: bool) -> Result<()> {
	let menu = app.menu().context("the application has no menu")?;
	let found = menu
		.get(submenu)
		.with_context(|| format!("the menu has no {submenu:?} submenu"))?;
	let found = found
		.as_submenu()
		.with_context(|| format!("{submenu:?} is not a submenu"))?;
	let item = found.get(id).with_context(|| format!("no menu item {id:?}"))?;
	item
		.as_menuitem()
		.with_context(|| format!("{id:?} is not a plain menu item"))?
		.set_enabled(enabled)?;
	Ok(())
}
