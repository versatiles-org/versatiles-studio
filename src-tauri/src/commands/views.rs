//! Named views (A7, S1.8).
//!
//! Application-wide rather than project-scoped ([Q21]) - a view is a place you want to come back
//! to, whether or not a project exists. Called bookmarks until [Q38], which also moved them out of
//! the inspector and onto the map.
//!
//! [Q21]: ../../docs/decisions.md
//! [Q38]: ../../docs/decisions.md

use crate::state::AppState;
use studio_core::store::View;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn list_views(state: State<'_, AppState>) -> Result<Vec<View>, String> {
	Ok(state.views.lock().await.entries().to_vec())
}

/// Saves a view, replacing any of the same name.
#[tauri::command]
#[specta::specta]
pub async fn save_view(state: State<'_, AppState>, view: View) -> Result<(), String> {
	let mut views = state.views.lock().await;
	views.add(view);
	// Unlike recents, a failed write is reported: this is the user's own work.
	views.save(&state.data_dir).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
#[specta::specta]
pub async fn delete_view(state: State<'_, AppState>, name: String) -> Result<bool, String> {
	let mut views = state.views.lock().await;
	let removed = views.remove(&name);
	views.save(&state.data_dir).map_err(|e| format!("{e:#}"))?;
	Ok(removed)
}

/// Puts the views in the order given, and returns what that came to.
///
/// Returns the list rather than nothing because the core has the last word on it - a name the
/// caller does not hold is ignored, and one it left out keeps its place - so the webview renders
/// what was actually stored instead of what it hoped had been.
#[tauri::command]
#[specta::specta]
pub async fn reorder_views(state: State<'_, AppState>, order: Vec<String>) -> Result<Vec<View>, String> {
	let mut views = state.views.lock().await;
	views.reorder(&order);
	views.save(&state.data_dir).map_err(|e| format!("{e:#}"))?;
	Ok(views.entries().to_vec())
}
