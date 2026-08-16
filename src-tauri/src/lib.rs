//! Tauri bindings over `studio-core`.
//!
//! Deliberately thin — native window, menus, dialogs, drag & drop, and the two planes that cross
//! the process boundary. The data plane is HTTP and needs no code here: the embedded server lives
//! in the core (see `docs/architecture.md`).

mod commands;
mod events;

/// One window per project; the landing screen is what an empty window shows (Q13, Q16).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tauri::Builder::default()
		.invoke_handler(tauri::generate_handler![commands::app_version])
		.run(tauri::generate_context!())
		.expect("error while running VersaTiles Studio");
}
