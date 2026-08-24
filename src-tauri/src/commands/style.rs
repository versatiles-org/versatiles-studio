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
use studio_core::graphs::GraphId;
use studio_core::history::{EditKind, Target};
use studio_core::style::{Appearance, LayerOverride, Preset, RasterAdjust, Recipe, Recolor, SourceKind};
use tauri::{AppHandle, State};

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
/// The graph's name, which is what the recipe files a source's style under.
///
/// **Id in, name out.** The application refers to a graph by id, because a rename must not
/// invalidate a reference held mid-edit (`graphs.rs`); the recipe stores by name, because that is
/// what a MapLibre style calls a source and what `project.yaml` already lists. This is the one
/// place the two meet, and `Recipe::rename_source` is the other.
async fn source_name(state: &State<'_, AppState>, graph: GraphId) -> Result<String, String> {
	state
		.graphs
		.lock()
		.await
		.get(graph)
		.map(|found| found.name.clone())
		.ok_or_else(|| format!("no graph {graph}"))
}

/// Edits one source's style, creating its entry the first time it is touched.
///
/// `kind` seeds a new entry so a raster source does not start life holding a preset it cannot use.
/// It is ignored for an entry that already exists — the stored answer wins over a fresh reading, or
/// a re-probe could quietly rewrite a choice someone made.
async fn edit(
	state: &State<'_, AppState>,
	graph: GraphId,
	kind: Option<SourceKind>,
	change: impl FnOnce(&mut studio_core::style::SourceStyle),
) -> Result<Recipe, String> {
	let name = source_name(state, graph).await?;
	let mut recipe = state.style.lock().await.clone();
	change(recipe.source_mut(&name, kind));
	Ok(record(state, recipe).await)
}

async fn record(state: &State<'_, AppState>, recipe: Recipe) -> Recipe {
	let mut history = state.history.lock().await;
	if history.current_of(Target::Style).is_none() {
		history.push(Target::Style, state.style.lock().await.text(), EditKind::Replaced);
	}
	history.push(Target::Style, recipe.text(), EditKind::Structured);
	*state.style.lock().await = recipe.clone();
	recipe
}

/// Switches which style a source starts from (D1).
#[tauri::command]
#[specta::specta]
pub async fn set_style_preset(state: State<'_, AppState>, graph: GraphId, preset: Preset) -> Result<Recipe, String> {
	edit(&state, graph, None, |style| {
		// A preset only means something on a vector appearance. Choosing one on a source currently
		// drawn as raster says the person wants it drawn as vector, so the appearance follows —
		// rather than the click being silently ignored.
		match &mut style.appearance {
			Appearance::Vector { preset: current, .. } => *current = preset,
			other => {
				*other = Appearance::Vector {
					preset,
					recolor: Recolor::default(),
					overrides: Default::default(),
				};
			}
		}
	})
	.await
}

/// Sets the raster adjustment — the imagery equivalent of `set_style_recolor` (S6.3, D11).
///
/// Whole-struct for the same reason that one is: the controls move together, and one command per
/// field would let the two ends disagree about which of them the recipe currently has. Called when
/// a gesture ends, so a drag is one undo entry rather than sixty.
#[tauri::command]
#[specta::specta]
pub async fn set_style_raster(
	state: State<'_, AppState>,
	graph: GraphId,
	raster: RasterAdjust,
) -> Result<Recipe, String> {
	edit(&state, graph, Some(SourceKind::RasterImage), |style| {
		style.appearance = Appearance::Raster { adjust: raster };
	})
	.await
}

/// Corrects what a source's tiles are being read as (S6.1).
///
/// `None` hands the question back to the webview's own reading. Changing the kind across the
/// vector/raster line replaces the appearance, because the old one describes something this source
/// is no longer being drawn as — and keeping it would mean a recipe carrying two answers again,
/// which is what S6.4 removed.
#[tauri::command]
#[specta::specta]
pub async fn set_style_kind(
	state: State<'_, AppState>,
	graph: GraphId,
	kind: Option<SourceKind>,
) -> Result<Recipe, String> {
	edit(&state, graph, kind, |style| {
		let wants_vector = !matches!(kind, Some(SourceKind::RasterImage | SourceKind::RasterDem));
		if wants_vector != style.appearance.is_vector() {
			style.appearance = Appearance::for_kind(kind);
		}
		style.kind = kind;
	})
	.await
}

/// Sets the global recolouring — hue, saturation, brightness, contrast and the rest (D1, D5).
///
/// Takes the whole of it rather than one field at a time. The controls move together, the webview
/// holds them together, and ten commands would let the two ends disagree about which of them the
/// recipe currently has.
#[tauri::command]
#[specta::specta]
pub async fn set_style_recolor(state: State<'_, AppState>, graph: GraphId, recolor: Recolor) -> Result<Recipe, String> {
	edit(&state, graph, None, |style| {
		if let Appearance::Vector { recolor: current, .. } = &mut style.appearance {
			*current = recolor;
		}
	})
	.await
}

/// Changes one layer of a vector source (D3, S4.5).
#[tauri::command]
#[specta::specta]
pub async fn set_layer_override(
	state: State<'_, AppState>,
	graph: GraphId,
	layer: String,
	patch: LayerOverride,
) -> Result<Recipe, String> {
	let name = source_name(&state, graph).await?;
	let mut recipe = state.style.lock().await.clone();
	recipe.set_override(&name, layer, patch);
	Ok(record(&state, recipe).await)
}

/// What Studio can write a style as/// What Studio can write a style as — the file dialog's filters come from here.
#[tauri::command]
#[specta::specta]
pub fn style_formats() -> Vec<String> {
	studio_core::style::EXPORTABLE
		.iter()
		.map(|f| (*f).to_string())
		.collect()
}

/// Writes a style someone chose a destination for (S4.6, D8).
///
/// **The webview supplies the text.** A style is rendered by `@versatiles/style`, which is a
/// JavaScript library, and the recipe exists precisely so that the core never has to hold the 125 kB
/// it produces ([Q36]). So this command is about the destination rather than the contents: it checks
/// the extension and writes atomically, the way a `.vpl` is saved.
///
/// The path came from a native save dialog, which is the whole of the trust story — see
/// [architecture.md](../../../docs/architecture.md)'s note on paths across the control plane.
#[tauri::command]
#[specta::specta]
pub async fn export_style(path: String, contents: String) -> Result<(), String> {
	let path = std::path::PathBuf::from(path);
	if !studio_core::style::is_exportable(&path) {
		return Err(format!(
			"cannot write {}: a style is written as .{}",
			path.display(),
			studio_core::style::EXPORTABLE.join(" or .")
		));
	}
	studio_core::project::write_atomically(&path, &contents).map_err(|error| format!("{error:#}"))
}

/// Writes a style bundle: the style, the glyphs it names and the sprite sheet (D8, S4.6).
///
/// **The webview supplies the style text and the font list**, for the same reason `export_style`
/// above takes its contents: `@versatiles/style` renders in JavaScript, and the fonts a style uses
/// are read out of what it rendered to.
///
/// The archives come from here, because only the app knows where a bundled resource lives — beside
/// the binary when packaged, in the source tree in dev — and where installed families were put.
/// Installed families are searched *after* the bundled tier, mirroring the mount order: the Latin
/// subset answers first, and anything else is found in whichever family archive has it.
///
/// Returns the fonts nothing had, which the pane says out loud rather than swallowing.
///
/// **On a blocking thread**: this reads two tar archives and writes a few hundred files.
#[tauri::command]
#[specta::specta]
pub async fn export_style_bundle(
	app: AppHandle,
	state: State<'_, AppState>,
	target: String,
	zip: bool,
	contents: String,
	fonts: Vec<String>,
) -> Result<Vec<String>, String> {
	let resources = crate::assets::resource_dir(&app).map_err(|error| format!("{error:#}"))?;
	let mut glyphs = vec![resources.join("glyphs.tar.gz")];
	glyphs.extend(studio_core::assets::installed(&state.asset_dir));
	let sprites = resources.join("sprites.tar.gz");

	tauri::async_runtime::spawn_blocking(move || {
		studio_core::style::bundle::write(std::path::Path::new(&target), zip, &contents, &fonts, &glyphs, &sprites)
	})
	.await
	.map_err(|error| format!("{error}"))?
	.map_err(|error| format!("{error:#}"))
}
