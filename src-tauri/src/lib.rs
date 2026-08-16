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
use studio_core::{project::Recents, server::ServerManager};
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
			// Recents live beside the app's configuration, not inside any project — they are
			// application state (Q16), and they must survive a window reload.
			let recents_path = tauri::Manager::path(app)
				.app_config_dir()
				.map(|dir| dir.join("recents.json"))
				.unwrap_or_else(|_| std::path::PathBuf::from("recents.json"));

			tauri::Manager::manage(
				app,
				AppState {
					server: Mutex::new(server),
					recents: Mutex::new(Recents::load(&recents_path)),
					recents_path,
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
			commands::sources::forget_recent
		])
		.run(tauri::generate_context!())
		.expect("error while running VersaTiles Studio");
}
