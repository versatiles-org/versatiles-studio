//! Control plane — `#[tauri::command]` bindings over `studio-core`.
//!
//! These stay thin: no application logic, only translation. Tile bytes never travel here — they go
//! over the embedded server's HTTP, because Tauri serialises command returns as JSON and its own
//! docs warn that is slow for large payloads (Q3).

pub mod bookmarks;
pub mod sources;

use crate::{events::channel_sink, state::AppState};
use studio_core::jobs::{CancelToken, JobEvent, JobHandle};
use tauri::{AppHandle, State, ipc::Channel};

/// Smoke-test command proving the IPC boundary is wired.
#[tauri::command]
pub fn app_version() -> &'static str {
	env!("CARGO_PKG_VERSION")
}

/// Base URL of the embedded server, for MapLibre to fetch tiles from.
///
/// The webview learns the port this way rather than assuming one, because the server binds an
/// ephemeral port (see `studio_core::server`).
#[tauri::command]
pub async fn server_base_url(state: State<'_, AppState>) -> Result<String, String> {
	let server = state.server.lock().await;
	Ok(server.base_url())
}

/// Smoke test for the event plane: streams a few progress events over a Channel.
///
/// Exists so S0.4 is verified rather than merely written. Delete it when the real job runner lands
/// at S3.1 — by then this path is exercised by actual work.
#[tauri::command]
pub async fn demo_job(channel: Channel<JobEvent>) -> Result<(), String> {
	let job = JobHandle::new(0, channel_sink(channel), CancelToken::new());

	for step in 1..=4 {
		if job.is_cancelled() {
			job.cancelled();
			return Ok(());
		}
		job.progress(f64::from(step) / 4.0, format!("step {step} of 4"));
		tokio::time::sleep(std::time::Duration::from_millis(120)).await;
	}
	job.log("nothing was actually done, which is the point");
	job.finished();
	Ok(())
}

/// Opens another window. One window per project ([Q16]) — this is what ⌘N does.
///
/// Each window gets its own webview process, so a crash takes one project down rather than all of
/// them. The label must be unique; the caller owns that.
///
/// [Q16]: ../../docs/decisions.md
#[tauri::command]
pub fn open_window(app: AppHandle, label: String) -> Result<(), String> {
	crate::windows::open(&app, &label).map_err(|e| e.to_string())
}
