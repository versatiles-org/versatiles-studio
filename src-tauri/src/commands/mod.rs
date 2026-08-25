//! Control plane — `#[tauri::command]` bindings over `studio-core`.
//!
//! These stay thin: no application logic, only translation. Tile bytes never travel here — they go
//! over the embedded server's HTTP, because Tauri serialises command returns as JSON and its own
//! docs warn that is slow for large payloads (Q3).

pub mod assets;
pub mod diagnostics;
pub mod export;
pub mod jobs;
pub mod layout;
pub mod project;
pub mod sources;
pub mod style;
pub mod views;
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

/// Enables or disables the menu items that need something to be open (S0.1).
///
/// **Pushed down, not pulled up.** Whether there is a project to save is a `$derived` in the
/// webview, and a native menu cannot read one — so the window tells the menu when the answer
/// changes. One flag, because one flag is what the menu actually varies on; anything finer would be
/// a mechanism built for a second caller that does not exist.
#[tauri::command]
#[specta::specta]
pub fn set_menu_state(app: AppHandle, has_project: bool) -> Result<(), String> {
	for item in [crate::menu::SAVE_PROJECT, crate::menu::SAVE_COPY] {
		crate::menu::set_enabled(&app, item, has_project).map_err(|error| format!("{error:#}"))?;
	}
	Ok(())
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
