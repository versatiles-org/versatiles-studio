//! Tauri bindings over `studio-core`.
//!
//! Deliberately thin — native window, menus, dialogs, drag & drop, and the two planes that cross
//! the process boundary. The data plane is HTTP and needs no code here: the embedded server lives
//! in the core (see `docs/architecture.md`).

mod commands;
mod events;
mod state;

use state::AppState;
use studio_core::server::ServerManager;
use tokio::sync::Mutex;

/// One window per project; the landing screen is what an empty window shows (Q13, Q16).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tauri::Builder::default()
		.setup(|app| {
			// The server is started once, for the whole application. Blocking here is deliberate:
			// no window should exist before the data plane does.
			let server = tauri::async_runtime::block_on(ServerManager::start())?;
			tauri::Manager::manage(
				app,
				AppState {
					server: Mutex::new(server),
				},
			);
			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			commands::app_version,
			commands::server_base_url,
			commands::demo_job
		])
		.run(tauri::generate_context!())
		.expect("error while running VersaTiles Studio");
}
