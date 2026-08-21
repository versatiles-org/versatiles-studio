//! Installing and removing font families (G7, S4.1).
//!
//! The bundled tier covers Latin and ships in the binary (S0.6); everything else is 8–48 MB that
//! most projects never need, so it is fetched when someone asks for it and can be removed again.

use crate::state::AppState;
use studio_core::assets::Family;
use studio_core::jobs::{JobId, Lane};
use tauri::{AppHandle, State};

/// Every family this build offers, and whether it is installed.
#[tauri::command]
#[specta::specta]
pub async fn font_families(state: State<'_, AppState>) -> Result<Vec<Family>, String> {
	studio_core::assets::families(&state.asset_dir).map_err(|error| format!("{error:#}"))
}

/// Downloads a family and mounts it, as a job.
///
/// **`Queued`, like an export** ([Q27]): 48 MB is minutes on a slow line, it is something you start
/// and walk away from, and two at once would only make both slower. Returning the job rather than
/// the result is what lets the bar show progress and offer to cancel.
///
/// The mount happens here rather than at the next start, because a font someone just installed and
/// cannot use until they restart is a font they will think failed to install.
///
/// [Q27]: ../../../docs/decisions.md
#[tauri::command]
#[specta::specta]
pub async fn install_font(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<JobId, String> {
	let dir = state.asset_dir.clone();
	Ok(state
		.jobs
		.submit(format!("Installing {id}"), Lane::Queued, move |handle| async move {
			let archive = studio_core::assets::install(&handle, &id, &dir).await?;
			let state = tauri::Manager::state::<AppState>(&app);
			let mut server = state.server.lock().await;
			server.mount_static(&archive, "/assets/glyphs").await?;
			handle.log(format!("{id} is ready to use"));
			Ok(())
		}))
}

/// Removes a family. Reports whether one was there.
///
/// **The mount is not removed**, and cannot be: the server takes static sources and never gives them
/// back. Until it does, a family removed mid-session keeps serving until the next start — which is
/// the harmless direction for this to be wrong in, and is said here rather than left to be noticed.
#[tauri::command]
#[specta::specta]
pub async fn remove_font(state: State<'_, AppState>, id: String) -> Result<bool, String> {
	studio_core::assets::remove(&state.asset_dir, &id).map_err(|error| format!("{error:#}"))
}
