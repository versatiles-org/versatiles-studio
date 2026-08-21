//! The project's style, as the recipe it is rendered from (S4.2, [Q36]).
//!
//! Every command here changes the recipe and records it, so ⌘Z walks back through style edits and
//! pipeline edits in the order they happened ([S4.7](../../../docs/scope-release-1.md)). None of
//! them renders anything: the webview holds `@versatiles/style` and turns a recipe into a style
//! there.
//!
//! **Continuous edits commit once.** Dragging a colour or a slider changes the recipe sixty times a
//! second, and sixty undo entries for one gesture is the same bug as an editor that undoes one
//! character at a time. So the webview previews locally and calls these when the gesture *ends* —
//! which is why nothing here coalesces, unlike typing in the VPL editor.
//!
//! [Q36]: ../../../docs/decisions.md

use crate::state::AppState;
use studio_core::history::{EditKind, Target};
use studio_core::style::{LayerOverride, Preset, Recipe, Recolor};
use tauri::State;

/// The recipe as it stands.
#[tauri::command]
#[specta::specta]
pub async fn style(state: State<'_, AppState>) -> Result<Recipe, String> {
	Ok(state.style.lock().await.clone())
}

/// Records the recipe and returns it, so every mutation below is one line.
///
/// **The baseline is pushed here rather than at startup**, on the first edit: the entry it needs to
/// step back to is the state *before* this change, and taking it at the moment of the change is
/// what guarantees there is one. `History::push` ignores a state identical to the current one, so a
/// second edit adds a baseline for nothing.
async fn record(state: &State<'_, AppState>, recipe: Recipe) -> Recipe {
	let mut history = state.history.lock().await;
	if history.current_of(Target::Style).is_none() {
		history.push(Target::Style, state.style.lock().await.text(), EditKind::Replaced);
	}
	history.push(Target::Style, recipe.text(), EditKind::Structured);
	*state.style.lock().await = recipe.clone();
	recipe
}

/// Switches which style the project starts from (D1).
#[tauri::command]
#[specta::specta]
pub async fn set_style_preset(state: State<'_, AppState>, preset: Preset) -> Result<Recipe, String> {
	let mut recipe = state.style.lock().await.clone();
	recipe.preset = preset;
	Ok(record(&state, recipe).await)
}

/// Sets the global recolouring — hue, saturation, brightness, contrast and the rest (D1, D5).
///
/// Takes the whole of it rather than one field at a time. The controls move together, the webview
/// holds them together, and ten commands would let the two ends disagree about which of them the
/// recipe currently has.
#[tauri::command]
#[specta::specta]
pub async fn set_style_recolor(state: State<'_, AppState>, recolor: Recolor) -> Result<Recipe, String> {
	let mut recipe = state.style.lock().await.clone();
	recipe.recolor = recolor;
	Ok(record(&state, recipe).await)
}

/// Changes one layer, or resets it (D3).
///
/// An override that says nothing removes the layer from the recipe rather than storing an empty
/// patch, so "reset" and "never touched" are the same state — see `Recipe::set_override`.
#[tauri::command]
#[specta::specta]
pub async fn set_layer_override(
	state: State<'_, AppState>,
	layer: String,
	patch: LayerOverride,
) -> Result<Recipe, String> {
	let mut recipe = state.style.lock().await.clone();
	recipe.set_override(layer, patch);
	Ok(record(&state, recipe).await)
}
