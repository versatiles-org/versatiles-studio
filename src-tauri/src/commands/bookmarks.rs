//! Named view bookmarks (A7, S1.8).
//!
//! Application-wide rather than project-scoped ([Q21]) — a bookmark is a place you want to come
//! back to, whether or not a project exists.
//!
//! [Q21]: ../../docs/decisions.md

use crate::state::AppState;
use studio_core::store::Bookmark;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn list_bookmarks(state: State<'_, AppState>) -> Result<Vec<Bookmark>, String> {
	Ok(state.bookmarks.lock().await.entries().to_vec())
}

/// Saves a bookmark, replacing any with the same name.
#[tauri::command]
#[specta::specta]
pub async fn save_bookmark(state: State<'_, AppState>, bookmark: Bookmark) -> Result<(), String> {
	let mut bookmarks = state.bookmarks.lock().await;
	bookmarks.add(bookmark);
	// Unlike recents, a failed write is reported: this is the user's own work.
	bookmarks.save(&state.data_dir).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
#[specta::specta]
pub async fn delete_bookmark(state: State<'_, AppState>, name: String) -> Result<bool, String> {
	let mut bookmarks = state.bookmarks.lock().await;
	let removed = bookmarks.remove(&name);
	bookmarks.save(&state.data_dir).map_err(|e| format!("{e:#}"))?;
	Ok(removed)
}
