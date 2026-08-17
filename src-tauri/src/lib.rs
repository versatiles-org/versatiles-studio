//! Tauri bindings over `studio-core`.
//!
//! Deliberately thin — native window, menus, dialogs, drag & drop, and the two planes that cross
//! the process boundary. The data plane is HTTP and needs no code here: the embedded server lives
//! in the core (see `docs/architecture.md`).

mod assets;
mod commands;
mod events;
mod state;
mod windows;

use state::AppState;
use studio_core::{
	server::ServerManager,
	store::{Bookmarks, Layout, Recents},
};
use tokio::sync::Mutex;

/// One window per project; the landing screen is what an empty window shows (Q13, Q16).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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

			tauri::Manager::manage(
				app,
				AppState {
					server: Mutex::new(server),
					recents: Mutex::new(recents),
					bookmarks: Mutex::new(bookmarks),
					layout: Mutex::new(layout),
					pipeline: Mutex::new(None),
					data_dir,
				},
			);

			windows::open_extra_from_env(app.handle())?;
			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			commands::app_version,
			commands::server_base_url,
			commands::demo_job,
			commands::open_window,
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
			commands::vpl::vpl_review,
			commands::vpl::vpl_operations,
			commands::vpl::pipeline,
			commands::vpl::set_pipeline
		])
		.run(tauri::generate_context!())
		.expect("error while running VersaTiles Studio");
}
