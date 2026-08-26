//! Tauri bindings over `studio-core`.
//!
//! Deliberately thin - native window, menus, dialogs, drag & drop, and the two planes that cross
//! the process boundary. The data plane is HTTP and needs no code here: the embedded server lives
//! in the core (see `docs/architecture.md`).

mod assets;
mod bindings;
mod commands;
mod events;
mod menu;
mod opened;
mod state;
mod windows;

use state::AppState;
use studio_core::{
	diagnostics::{Diagnostics, Level, NewProblem, Origin},
	server::ServerManager,
	store::{Layout, Recents, Views},
};
use tokio::sync::Mutex;

/// One window per project; the landing screen is what an empty window shows (Q13, Q16).
/// Where app-wide state lives: recents, named views, the saved layout ([Q21]).
///
/// **The one path a test may move**, because there is only one and everything app-wide is under it.
/// Without this the end-to-end suite reads and writes the recents of whoever is running it, and
/// leaves them changed - a test that edits the tester's own data is a test people stop running.
///
/// Compiled in only under `e2e`, so no shipped build has an environment variable that can relocate
/// somebody's projects list ([the plan](../../docs/scope-e2e.md)).
///
/// [Q21]: ../../docs/decisions.md
fn data_dir(app: &tauri::App) -> std::path::PathBuf {
	if let Some(dir) = moved_aside() {
		return dir;
	}
	tauri::Manager::path(app)
		.app_data_dir()
		.unwrap_or_else(|_| std::path::PathBuf::from("."))
}

/// Where the problem log is written ([S6.8]).
///
/// It follows `data_dir` when a test has moved that aside, so a failed run leaves its problems
/// somewhere a CI job can collect them rather than in the runner's home directory.
///
/// [S6.8]: ../../docs/history.md
fn log_dir(app: &tauri::App, data_dir: &std::path::Path) -> std::path::PathBuf {
	if moved_aside().is_some() {
		return data_dir.join("logs");
	}
	tauri::Manager::path(app)
		.app_log_dir()
		.unwrap_or_else(|_| data_dir.join("logs"))
}

/// The directory an end-to-end run has been told to use instead, if this build can be told at all.
#[cfg(feature = "e2e")]
fn moved_aside() -> Option<std::path::PathBuf> {
	std::env::var("STUDIO_DATA_DIR").ok().map(std::path::PathBuf::from)
}

#[cfg(not(feature = "e2e"))]
fn moved_aside() -> Option<std::path::PathBuf> {
	None
}

/// The commands the webview may call, and the source of the generated TypeScript (S0.3).
///
/// One list rather than two: `generate_handler!` and a separate export list would drift the moment
/// someone added a command and forgot the other place. `bindings.rs` turns this into
/// `src/lib/ipc/bindings.ts`, and a test fails when the checked-in file is stale.
fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
	tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
		commands::app_version,
		commands::server_base_url,
		commands::open_window,
		commands::open_in_new_window,
		commands::open_empty_window,
		commands::open_launcher,
		commands::refresh_menu,
		commands::diagnostics::diagnostics,
		commands::diagnostics::previous_problems,
		commands::diagnostics::log_diagnostic,
		commands::diagnostics::clear_diagnostics,
		commands::diagnostics::save_report,
		commands::diagnostics::show_log,
		commands::diagnostics::environment,
		commands::export::export_graph,
		commands::export::estimate_export,
		commands::export::set_crop,
		commands::export::writable_formats,
		commands::jobs::subscribe_jobs,
		commands::jobs::job_log,
		commands::jobs::cancel_job,
		commands::sources::open_container,
		commands::sources::recent_sources,
		commands::sources::forget_recent,
		commands::sources::inspect_tile,
		commands::views::list_views,
		commands::views::save_view,
		commands::views::delete_view,
		commands::views::reorder_views,
		commands::style::style,
		commands::style::set_style_preset,
		commands::style::set_style_kind,
		commands::style::set_style_raster,
		commands::style::set_style_order,
		commands::style::set_style_hillshade,
		commands::style::prune_style_overrides,
		commands::style::set_style_recolor,
		commands::style::set_layer_override,
		commands::style::export_style,
		commands::style::export_style_bundle,
		commands::style::style_formats,
		commands::project::save_project,
		commands::project::open_project,
		commands::project::is_project,
		commands::project::project_path,
		commands::project::copy_plan,
		commands::project::save_project_copy,
		commands::assets::font_families,
		commands::assets::install_font,
		commands::assets::remove_font,
		commands::layout::layout,
		commands::layout::set_layout,
		commands::vpl::vpl_parse,
		commands::vpl::vpl_set_value,
		commands::vpl::vpl_set_property,
		commands::vpl::vpl_remove_property,
		commands::vpl::vpl_insert_node,
		commands::vpl::vpl_remove_node,
		commands::vpl::vpl_review,
		commands::vpl::vpl_operations,
		commands::vpl::import_kinds,
		commands::vpl::import_kind_for,
		commands::vpl::import_read_node,
		commands::vpl::field_suggestions,
		commands::vpl::graphs,
		commands::vpl::graph,
		commands::vpl::add_graph,
		commands::vpl::remove_graph,
		commands::vpl::rename_graph,
		commands::vpl::set_graph,
		commands::vpl::format_graph,
		commands::vpl::mount_graph,
		commands::vpl::set_graph_enabled,
		commands::vpl::set_node_enabled,
		commands::vpl::undo,
		commands::vpl::redo,
		commands::vpl::open_vpl,
		commands::vpl::save_vpl,
		opened::take_opened
	])
}

/// Says a thing was given up on, in both places it has to be said.
///
/// **stderr *and* the panel.** A developer running `cargo tauri dev` reads the terminal, and a user
/// with a bundled build has no terminal to read - the `.app` a double-click launches has nowhere for
/// stderr to go. Neither audience is the other's fallback (S6.8).
fn warn(diagnostics: &Diagnostics, what: &str, error: &anyhow::Error) {
	eprintln!("{what}: {error:#}");
	diagnostics.record(NewProblem {
		level: Level::Warn,
		origin: Origin::Core,
		message: what.to_string(),
		// `{:#}` keeps anyhow's context chain, which is the half that says which file and why.
		detail: Some(format!("{error:#}")),
	});
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let builder = specta_builder();

	// **Before anything that could fail, including the builder.** A panic during start-up is the one
	// a user can least describe - the window never appears - and the hook is what turns it into a
	// line the next launch can still show and copy (S6.8).
	let diagnostics = Diagnostics::new();
	studio_core::diagnostics::catch_panics(&diagnostics);

	// Whether the last window to be destroyed was the launcher - see the exit handler below.
	let launcher_closed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

	// **A WebDriver server inside the application, and only when asked for.** The embedded provider
	// is the only one that can drive a WKWebView, which is what lets the end-to-end tests run on a
	// developer's Mac as well as on a Linux runner. `e2e` is off by default and `guards.test.ts`
	// asserts that nothing which builds a release turns it on: a remote-control listener in a
	// shipped binary would falsify the one promise Studio makes about itself ([Q1]).
	#[cfg(feature = "e2e")]
	let shell = tauri::Builder::default().plugin(tauri_plugin_wdio_webdriver::init());
	#[cfg(not(feature = "e2e"))]
	let shell = tauri::Builder::default();

	shell
		.plugin(tauri_plugin_dialog::init())
		// Auto-update (G4, S5.8). **Checked from the webview, never on its own**: an application
		// that downloads and swaps itself out while someone is mid-export is worse than one that
		// waits to be asked. `process` is the other half - an installed update takes effect on
		// restart, and offering the restart is the difference between "installed" and "running".
		.plugin(tauri_plugin_updater::Builder::new().build())
		.plugin(tauri_plugin_process::init())
		// Opening a URL in the *system* browser, which is the only kind of link Studio has: the
		// alpha ribbon's, pointing at the repository. A webview that navigated away from the
		// application would have no way back - and the capability scopes it to that one host, so
		// this cannot become a general way out.
		.plugin(tauri_plugin_opener::init())
		.setup(move |app| {
			// Before anything can fetch: a remote container opened during start-up would otherwise
			// go out as plain `versatiles/…` (vt#248).
			if let Err(error) = studio_core::identify(env!("CARGO_PKG_VERSION")) {
				warn(&diagnostics, "Could not name Studio in the User-Agent", &error);
			}
			// The server is started once, for the whole application. Blocking here is deliberate:
			// no window should exist before the data plane does.
			let mut server = tauri::async_runtime::block_on(ServerManager::start())?;
			// Sprites and Latin glyphs, mounted straight from their archives (Q9). Without them a
			// vector map renders but is illegible, so this is part of the shell, not a feature.
			tauri::async_runtime::block_on(assets::mount_bundled(app.handle(), &mut server))?;
			// App-wide state lives beside the application's *data*, not its configuration, and not
			// inside any project (Q21). It must survive a window reload (Q16).
			let data_dir = data_dir(app);
			// **Opened before anything else can fail**, and rotated as it opens: the run worth
			// reading back is the one that had no exit to write anything at (S6.8). Failing costs
			// the file and not the panel, so it is recorded rather than raised.
			let log_dir = log_dir(app, &data_dir);
			if let Err(error) = diagnostics.open_log(&log_dir) {
				warn(
					&diagnostics,
					"Problems will not be written to disk this session",
					&error,
				);
			}
			// Recents reset silently when unreadable; views do not, because they are the user's own
			// work. A broken views file is surfaced and left untouched rather than replaced.
			// Installed families, after the bundled tier so they extend it rather than shadow it
			// (G7, S4.1). Failing to mount one is not worth refusing to start over: the map falls
			// back to the Latin subset, which is what it had before the family was installed.
			let asset_dir = data_dir.join("fonts");
			if let Err(error) = tauri::async_runtime::block_on(assets::mount_fonts(&asset_dir, &mut server)) {
				warn(&diagnostics, "Could not mount an installed font family", &error);
			}
			let recents = Recents::load(&data_dir);
			let layout = Layout::load(&data_dir);
			let views = match Views::load(&data_dir) {
				Ok(loaded) => loaded,
				Err(error) => {
					warn(&diagnostics, "Views could not be read and were left alone", &error);
					Views::default()
				}
			};

			tauri::Manager::manage(app, opened::PendingOpen::default());

			tauri::Manager::manage(
				app,
				AppState {
					diagnostics,
					log_dir,
					server: Mutex::new(server),
					recents: Mutex::new(recents),
					views: Mutex::new(views),
					layout: Mutex::new(layout),
					// One project per window, each created when its window first asks (S7.1, [Q48]).
					projects: state::Projects::default(),
					jobs: studio_core::jobs::Jobs::new(),
					asset_dir,
					data_dir,
				},
			);

			// Before any window opens, so the first one gets it on Windows and Linux - where the menu
			// belongs to a window rather than to the application (S0.1).
			menu::install(app.handle())?;

			// **Nothing is declared in `tauri.conf.json` any more**, so what opens is decided here
			// (S7.7). A file passed on the command line opens a project window for itself; anything
			// else opens the launcher, which is what Studio shows when it has nothing to show.
			//
			// After `AppState` is managed, because a window that could not be opened is reported
			// through the problem log like everything else.
			opened::receive(app.handle(), opened::from_command_line());
			windows::open_extra_from_env(app.handle())?;
			if tauri::Manager::webview_windows(app).is_empty() {
				windows::open_launcher(app.handle())?;
			}
			Ok(())
		})
		.on_menu_event(|app, event| menu::chosen(app, event.id()))
		.invoke_handler(builder.invoke_handler())
		.build(tauri::generate_context!())
		.expect("error while building VersaTiles Studio")
		.run(move |app, event| {
			// macOS delivers a double-clicked file here, both at launch and while running. Linux
			// passes it on the command line instead, handled during setup.
			#[cfg(target_os = "macos")]
			if let tauri::RunEvent::Opened { urls } = &event {
				let paths: Vec<String> = urls
					.iter()
					.filter_map(|url| url.to_file_path().ok())
					.map(|path| path.to_string_lossy().into_owned())
					.collect();
				opened::receive(app, paths);
			}
			// **Whichever window is in front decides what the menu offers** (S7.8). On macOS there is
			// one menu for every window, so a focused launcher that left Save enabled would be
			// offering to save a project it does not have - and one that disabled it would take it
			// away from the window behind it.
			if let tauri::RunEvent::WindowEvent {
				label,
				event: tauri::WindowEvent::Focused(true),
				..
			} = &event
			{
				let app = app.clone();
				let label = label.clone();
				tauri::async_runtime::spawn(async move {
					let state = tauri::Manager::state::<AppState>(&app);
					if let Err(error) = menu::apply(&app, &state, &label).await {
						warn(&state.diagnostics, "Could not redraw the menu for this window", &error);
					}
				});
			}

			// **A window that is gone takes its project with it** (S7.1). Not on close *requested* and
			// not on a reload: the label survives a reload, which is what lets a window that crashed
			// come back to its work rather than to an empty project ([Q16]).
			if let tauri::RunEvent::WindowEvent {
				label,
				event: tauri::WindowEvent::Destroyed,
				..
			} = &event
			{
				// Which window went is what tells "close the last project" from "close the launcher",
				// and by the time the runtime says every window is gone there is nothing left to ask.
				launcher_closed.store(label == windows::LAUNCHER, std::sync::atomic::Ordering::Relaxed);
				let app = app.clone();
				let label = label.clone();
				tauri::async_runtime::spawn(async move {
					let state = tauri::Manager::state::<AppState>(&app);
					let Some(held) = state.projects.close(&label).await else {
						return;
					};
					// **And what it was serving goes with it** (S7.2). One server serves the whole
					// application, so a closed window's tiles would otherwise stay mounted and
					// answering for the rest of the session.
					let prefix = held.lock().await.mounts();
					if let Err(error) = state.server.lock().await.unmount_prefix(&prefix) {
						warn(&state.diagnostics, "Could not unmount a closed window's tiles", &error);
					}
				});
			}
			// **The launcher comes back when the last project window closes**, on every platform
			// ([Q48], S7.7) - an application that vanishes when you close a document is the behaviour
			// being avoided, and one that lingers with no window is the behaviour nobody outside
			// macOS expects.
			//
			// Decided here rather than on the close itself: this is the event that means *no windows
			// are left*, and answering it there would be a guess about what the runtime is about to
			// conclude. `code` is `None` only for the last window closing - ⌘Q and the updater's
			// restart both set one, and neither is a request to reopen anything.
			if let tauri::RunEvent::ExitRequested { code: None, api, .. } = &event
				&& !launcher_closed.load(std::sync::atomic::Ordering::Relaxed)
			{
				api.prevent_exit();
				if let Err(error) = windows::open_launcher(app) {
					let state = tauri::Manager::state::<AppState>(app);
					warn(&state.diagnostics, "Could not reopen the launcher", &error);
				}
			}
			let _ = (app, event);
		});
}
