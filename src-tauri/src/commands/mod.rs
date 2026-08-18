//! Control plane — `#[tauri::command]` bindings over `studio-core`.
//!
//! These stay thin: no application logic, only translation. Tile bytes never travel here — they go
//! over the embedded server's HTTP, because Tauri serialises command returns as JSON and its own
//! docs warn that is slow for large payloads (Q3).

pub mod bookmarks;
pub mod export;
pub mod jobs;
pub mod layout;
pub mod sources;
pub mod vpl;

use crate::state::AppState;
use tauri::{AppHandle, State};

/// Smoke-test command proving the IPC boundary is wired.
#[tauri::command]
#[specta::specta]
pub fn app_version() -> &'static str {
	env!("CARGO_PKG_VERSION")
}

/// Base URL of the embedded server, for MapLibre to fetch tiles from.
///
/// The webview learns the port this way rather than assuming one, because the server binds an
/// ephemeral port (see `studio_core::server`).
#[tauri::command]
#[specta::specta]
pub async fn server_base_url(state: State<'_, AppState>) -> Result<String, String> {
	let server = state.server.lock().await;
	Ok(server.base_url())
}

/// Opens another window. One window per project ([Q16]) — this is what ⌘N does.
///
/// Each window gets its own webview process, so a crash takes one project down rather than all of
/// them. The label must be unique; the caller owns that.
///
/// [Q16]: ../../docs/decisions.md
#[tauri::command]
#[specta::specta]
pub fn open_window(app: AppHandle, label: String) -> Result<(), String> {
	crate::windows::open(&app, &label).map_err(|e| e.to_string())
}
