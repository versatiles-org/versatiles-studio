//! Left-pane layout (S2.2).
//!
//! Pane state is durable state, so it lives in the core like everything else ([Q16]) rather than in
//! the webview where a reload would lose it.

use crate::state::AppState;
use studio_core::store::Layout;
use tauri::State;

/// The remembered pane layout, or the default one.
#[tauri::command]
#[specta::specta]
pub async fn layout(state: State<'_, AppState>) -> Result<Layout, String> {
	Ok(state.layout.lock().await.clone())
}

/// Records the layout after the user collapses a section or drags the pane edge.
///
/// A failed write is logged and swallowed, the same as recents: a pane width is not worth
/// interrupting someone's work over, and the next change will try again anyway.
#[tauri::command]
#[specta::specta]
pub async fn set_layout(state: State<'_, AppState>, layout: Layout) -> Result<Layout, String> {
	let mut current = state.layout.lock().await;
	*current = layout.normalised();
	if let Err(error) = current.save(&state.data_dir) {
		eprintln!("could not save layout: {error:#}");
	}
	// Returns what was actually stored, not what was sent: the core clamps the width, and the
	// webview needs to see the clamped value or its slider fights the stored one.
	Ok(current.clone())
}
