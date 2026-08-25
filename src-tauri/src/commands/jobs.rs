//! The job runner, as the webview sees it (S3.1, E7).
//!
//! Thin, like the rest of the control plane: the queue, the lanes and the cancellation all live in
//! `studio_core::jobs`, and this is where they meet a Channel and a `#[tauri::command]`.

use crate::{events::channel_sink, state::AppState};
use studio_core::jobs::{Job, JobEvent, JobId};
use tauri::{State, ipc::Channel};

/// Points the runner's events at this window, and returns what it has missed.
///
/// **Called once, at startup, and again after every reload.** The channel belongs to a webview, and
/// a reload gets a new one; jobs started before it keep running, which is the whole reason a
/// conversion is not tied to the window that asked for it. Returning the list in the same call is
/// what closes the gap — subscribing and then listing separately leaves a window where an event
/// lands between the two and is counted twice, or lands before the list is taken and is missed.
///
/// **This window's work, not the machine's** ([S7.3](../../../docs/scope-release-3.md)): one runner
/// still, but a list per project, so an export started next door does not appear in this bar.
#[tauri::command]
#[specta::specta]
pub async fn subscribe_jobs(
	window: tauri::Window,
	state: State<'_, AppState>,
	channel: Channel<JobEvent>,
) -> Result<Vec<Job>, String> {
	state.jobs.set_sink(window.label(), channel_sink(channel));
	Ok(state.jobs.list(window.label()))
}

/// One job's log, oldest line first. Fetched when a row is expanded, not streamed on connect.
#[tauri::command]
#[specta::specta]
pub async fn job_log(state: State<'_, AppState>, id: JobId) -> Result<Vec<String>, String> {
	Ok(state.jobs.log(id))
}

/// Asks a job to stop. Idempotent — a job that has already ended stays ended.
#[tauri::command]
#[specta::specta]
pub async fn cancel_job(state: State<'_, AppState>, id: JobId) -> Result<(), String> {
	state.jobs.cancel(id);
	Ok(())
}
