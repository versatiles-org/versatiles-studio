//! Control plane — `#[tauri::command]` bindings over `studio-core`.
//!
//! These stay thin: no application logic, only translation. Tile bytes never travel here (Q3).

/// Smoke-test command proving the IPC boundary is wired.
#[tauri::command]
pub fn app_version() -> &'static str {
	env!("CARGO_PKG_VERSION")
}
