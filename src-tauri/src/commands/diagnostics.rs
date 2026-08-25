//! The session's problems, and what a bug report needs around them (S6.8).
//!
//! Thin, like the rest of the control plane: the ring, the folding and the panic hook live in
//! `studio_core::diagnostics`, and this is where they meet a `#[tauri::command]`.
//!
//! **Fetched when the panel is opened, never streamed.** The same rule as the job log, for the same
//! reason - a container of `bin` tiles reports one failure per tile, and pushing each of those to
//! the webview would cost a thousand messages to draw a number nobody is looking at.

use crate::state::AppState;
use anyhow::{Context, Result};
use studio_core::diagnostics::{NewProblem, Problem};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

/// Everything that has gone wrong this session, oldest first.
#[tauri::command]
#[specta::specta]
pub async fn diagnostics(state: State<'_, AppState>) -> Result<Vec<Problem>, String> {
	Ok(state.diagnostics.list())
}

/// What the run before this one left behind - the half a crash does not get to erase.
///
/// **Read from the file, not from memory**, because there is no memory left: the session this
/// describes is the one that was killed, ran out of memory, or aborted on a panic. Read on demand
/// rather than at startup, since most launches follow an ordinary one and nobody opens the tab.
///
/// Empty is the ordinary answer - a first launch, or a log directory that could not be written.
#[tauri::command]
#[specta::specta]
pub async fn previous_problems(state: State<'_, AppState>) -> Result<Vec<Problem>, String> {
	Ok(studio_core::diagnostics::previous(&state.log_dir))
}

/// Records a problem the webview saw, and answers how many there now are.
///
/// **The count comes back** so the bar's badge is a fact rather than a tally the window keeps: a
/// reload, a second window and the core's own entries all have to agree on one number, and only the
/// core can see all three.
#[tauri::command]
#[specta::specta]
pub async fn log_diagnostic(state: State<'_, AppState>, report: NewProblem) -> Result<u32, String> {
	Ok(state.diagnostics.record(report))
}

/// Forgets them all - for reproducing a problem cleanly before copying the report.
#[tauri::command]
#[specta::specta]
pub async fn clear_diagnostics(state: State<'_, AppState>) -> Result<(), String> {
	state.diagnostics.clear();
	Ok(())
}

/// Writes a problem report where the user asked for it.
///
/// **The webview composes the text**, for the same reason `export_style` takes its contents: what a
/// report says is a presentation decision, and the half of it that only the window can answer -
/// the engine, the GPU - never crosses into the core at all.
///
/// The path came from a native save dialog, which is the whole of the trust story.
#[tauri::command]
#[specta::specta]
pub async fn save_report(path: String, text: String) -> Result<(), String> {
	studio_core::project::write_atomically(std::path::Path::new(&path), &text).map_err(|error| format!("{error:#}"))
}

/// Shows the problem log in the file manager, selected.
///
/// **The path is this side's, never the caller's.** Revealing an arbitrary path is a capability
/// worth thinking hard about; revealing *the log file* is not, because there is exactly one and the
/// application knows where it put it. That is also why this goes through the plugin's Rust API
/// rather than its command: the scope that would otherwise have to be widened is replaced by there
/// being nothing to scope.
pub fn reveal_log(app: &AppHandle) -> Result<()> {
	let path = studio_core::diagnostics::log_path(&app.state::<AppState>().log_dir);
	// A log directory that could not be written leaves nothing to show, and the failure to write it
	// was already recorded at startup - so this says the plain thing rather than repeating that one.
	if !path.exists() {
		anyhow::bail!("there is no log file at {}", path.display());
	}
	app.opener()
		.reveal_item_in_dir(&path)
		.with_context(|| format!("revealing {}", path.display()))
}

/// The same, for the panel's footer - the path is written there, and a path you can open is better.
#[tauri::command]
#[specta::specta]
pub async fn show_log(app: AppHandle) -> Result<(), String> {
	reveal_log(&app).map_err(|error| format!("{error:#}"))
}

/// What is running this, for the header of a copied report.
///
/// **Half of it can only be answered here.** The webview knows its own engine and its GPU; the
/// build number, the platform and where home is are the process's to say. `home` is not shown
/// anywhere - it is what the report redacts out of file paths before anybody pastes them into a
/// public issue.
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
	pub app_version: String,
	/// `macos`, `windows`, `linux` - `std::env::consts`, so it is the target this was built for.
	pub os: String,
	pub arch: String,
	/// The system webview's version, or `None` where it will not say.
	pub webview: Option<String>,
	/// The user's home directory, for redaction. `None` when the platform has no answer.
	pub home: Option<String>,
	/// The file this session is being written to, for the panel to name.
	///
	/// **Worth naming rather than hiding.** Someone whose window will not open at all cannot reach
	/// the panel, and a path they can be told over a chat is the difference between a report and a
	/// shrug.
	pub log: String,
}

#[tauri::command]
#[specta::specta]
pub async fn environment(app: AppHandle, state: State<'_, AppState>) -> Result<Environment, String> {
	Ok(Environment {
		log: studio_core::diagnostics::log_path(&state.log_dir)
			.to_string_lossy()
			.into_owned(),
		app_version: env!("CARGO_PKG_VERSION").to_string(),
		os: std::env::consts::OS.to_string(),
		arch: std::env::consts::ARCH.to_string(),
		webview: tauri::webview_version().ok(),
		home: tauri::Manager::path(&app)
			.home_dir()
			.ok()
			.map(|path| path.to_string_lossy().into_owned()),
	})
}
