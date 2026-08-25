//! Left-pane layout (S2.2), and where the map is looking.
//!
//! Pane state is durable state, so it lives in the core like everything else ([Q16]) rather than in
//! the webview where a reload would lose it.
//!
//! **One live layout per project** ([S7.4](../../../docs/scope-release-3.md)). It reads as pane
//! state and is not: `view` is the camera and `background` is a map setting, so an application-wide
//! one meant panning in one window panned the other the next time either saved. What stays
//! application-wide is `layout.json`, demoted to the defaults the *next* window opens on.

use crate::state::AppState;
use studio_core::store::Layout;
use tauri::State;

/// This window's layout.
#[tauri::command]
#[specta::specta]
pub async fn layout(window: tauri::Window, state: State<'_, AppState>) -> Result<Layout, String> {
	let project = state.project(&window).await;
	let layout = project.lock().await.layout.clone();
	Ok(layout)
}

/// Records the layout after the user collapses a section or drags the pane edge.
///
/// A failed write is logged and swallowed, the same as recents: a pane width is not worth
/// interrupting someone's work over, and the next change will try again anyway.
#[tauri::command]
#[specta::specta]
pub async fn set_layout(window: tauri::Window, state: State<'_, AppState>, layout: Layout) -> Result<Layout, String> {
	let normalised = layout.normalised();

	let project = state.project(&window).await;
	project.lock().await.layout = normalised.clone();

	// **And written as the defaults for the next window**, which is what `layout.json` now means:
	// last write wins, because "the widths you have settled on" is one answer however many windows
	// are open, and a file per window would be a file per window label - an identity that means
	// nothing between two launches.
	{
		let mut defaults = state.layout.lock().await;
		*defaults = normalised.clone();
		if let Err(error) = defaults.save(&state.data_dir) {
			eprintln!("could not save layout: {error:#}");
		}
	}

	// Returns what was actually stored, not what was sent: the core clamps the width, and the
	// webview needs to see the clamped value or its slider fights the stored one.
	Ok(normalised)
}
