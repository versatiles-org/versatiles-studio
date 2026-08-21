//! Tauri bindings over `studio-core`.
//!
//! Deliberately thin — native window, menus, dialogs, drag & drop, and the two planes that cross
//! the process boundary. The data plane is HTTP and needs no code here: the embedded server lives
//! in the core (see `docs/architecture.md`).

mod assets;
mod bindings;
mod commands;
mod events;
mod opened;
mod state;
mod windows;

use state::AppState;
use std::path::PathBuf;
use studio_core::{
	history::History,
	server::ServerManager,
	store::{Bookmarks, Layout, Recents},
};
use tokio::sync::Mutex;

/// One window per project; the landing screen is what an empty window shows (Q13, Q16).
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
		commands::export::export_graph,
		commands::export::estimate_export,
		commands::export::writable_formats,
		commands::jobs::subscribe_jobs,
		commands::jobs::job_log,
		commands::jobs::cancel_job,
		commands::sources::open_container,
		commands::sources::recent_sources,
		commands::sources::forget_recent,
		commands::sources::inspect_tile,
		commands::bookmarks::list_bookmarks,
		commands::bookmarks::save_bookmark,
		commands::bookmarks::delete_bookmark,
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
		commands::vpl::preview_pipeline,
		commands::vpl::mount_graph,
		commands::vpl::pinned,
		commands::vpl::set_pin,
		commands::vpl::undo,
		commands::vpl::redo,
		commands::vpl::open_vpl,
		commands::vpl::save_vpl,
		opened::take_opened
	])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let builder = specta_builder();

	tauri::Builder::default()
		.plugin(tauri_plugin_dialog::init())
		.setup(|app| {
			// The server is started once, for the whole application. Blocking here is deliberate:
			// no window should exist before the data plane does.
			let mut server = tauri::async_runtime::block_on(ServerManager::start())?;
			// Sprites and Latin glyphs, mounted straight from their archives (Q9). Without them a
			// vector map renders but is illegible, so this is part of the shell, not a feature.
			tauri::async_runtime::block_on(assets::mount_bundled(app.handle(), &mut server))?;
			// App-wide state lives beside the application's *data*, not its configuration, and not
			// inside any project (Q21). It must survive a window reload (Q16).
			let data_dir = tauri::Manager::path(app)
				.app_data_dir()
				.unwrap_or_else(|_| std::path::PathBuf::from("."));
			// Recents reset silently when unreadable; bookmarks do not, because they are the user's
			// own work. A broken bookmarks file is surfaced and left untouched rather than replaced.
			let recents = Recents::load(&data_dir);
			let layout = Layout::load(&data_dir);
			let bookmarks = match Bookmarks::load(&data_dir) {
				Ok(loaded) => loaded,
				Err(error) => {
					eprintln!("bookmarks could not be read and were left alone: {error:#}");
					Bookmarks::default()
				}
			};

			tauri::Manager::manage(app, opened::PendingOpen::default());
			opened::receive(app.handle(), opened::from_command_line());

			tauri::Manager::manage(
				app,
				AppState {
					server: Mutex::new(server),
					recents: Mutex::new(recents),
					bookmarks: Mutex::new(bookmarks),
					layout: Mutex::new(layout),
					graphs: Mutex::new(studio_core::graphs::Graphs::new()),
					history: Mutex::new(History::new()),
					jobs: studio_core::jobs::Jobs::new(),
					pinned: Mutex::new(None),
					project_dir: Mutex::new(std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))),
					data_dir,
				},
			);

			windows::open_extra_from_env(app.handle())?;
			Ok(())
		})
		.invoke_handler(builder.invoke_handler())
		.build(tauri::generate_context!())
		.expect("error while building VersaTiles Studio")
		.run(|app, event| {
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
			let _ = (app, event);
		});
}
