//! Saving and opening a project directory (G1, S5.1, [Q6]).
//!
//! A project is a folder, so sharing one means sending a folder — and every file in it is usable
//! without Studio: the `.vpl` files run under `versatiles convert`, the `style.json` loads in
//! MapLibre.
//!
//! [Q6]: ../../../docs/decisions.md

use crate::state::AppState;
use tauri::State;

/// Writes every graph, the style recipe, and the rendered style.
///
/// **The rendered style comes from the webview**, for the reason [Q36] gives: the generator is
/// `@versatiles/style` and the core holds the recipe rather than the 125 kB it produces. `None` when
/// there is nothing on the map yet, which is a project saved before it draws anything rather than an
/// error.
///
/// Saving also moves what relative paths resolve against, because they are now relative to this
/// directory — a `.vpl` reading `berlin.mbtiles` beside it must keep meaning that file.
///
/// [Q36]: ../../../docs/decisions.md
#[tauri::command]
#[specta::specta]
pub async fn save_project(state: State<'_, AppState>, dir: String, style: Option<String>) -> Result<(), String> {
	let dir = std::path::PathBuf::from(dir);

	let graphs: Vec<(String, String)> = state
		.graphs
		.lock()
		.await
		.iter()
		.map(|graph| (graph.name.clone(), graph.document.text().to_string()))
		.collect();
	if graphs.is_empty() {
		return Err("there is nothing to save yet".to_string());
	}

	let recipe = state.style.lock().await.clone();
	studio_core::project::save(&dir, &graphs, &recipe, style.as_deref()).map_err(|error| format!("{error:#}"))?;

	*state.project_dir.lock().await = dir;
	Ok(())
}

/// Opens a project directory, replacing everything currently open.
///
/// **Replacing, not merging.** A window is one project ([Q16]); opening a second one beside the
/// first would leave two sets of graphs sharing an undo stack and a style, which is not a project.
///
/// Returns the recipe, because the webview has to render the style again — the manifest carries what
/// it is made from, not the style itself.
///
/// [Q16]: ../../../docs/decisions.md
#[tauri::command]
#[specta::specta]
pub async fn open_project(state: State<'_, AppState>, dir: String) -> Result<studio_core::style::Recipe, String> {
	use studio_core::history::{EditKind, Target};

	let dir = std::path::PathBuf::from(dir);
	let loaded = studio_core::project::load(&dir).map_err(|error| format!("{error:#}"))?;

	// Parsed before anything is replaced: a project with one unreadable graph should leave the
	// window as it was rather than half-open.
	let mut documents = Vec::with_capacity(loaded.graphs.len());
	for (name, text) in &loaded.graphs {
		let document = studio_core::vpl::Document::parse(text.clone())
			.map_err(|error| format!("{name}.vpl does not parse: {}", error.message))?;
		documents.push((name.clone(), document, text.clone()));
	}

	let mut graphs = state.graphs.lock().await;
	let mut history = state.history.lock().await;
	*graphs = studio_core::graphs::Graphs::new();
	history.clear();

	for (name, document, text) in documents {
		let file = dir.join(format!("{name}.vpl"));
		let id = graphs.add(&name, document, Some((file, text.clone())));
		// The baseline every document needs, so undo has somewhere to step back to.
		history.push(Target::Graph(id), text, EditKind::Replaced);
	}

	*state.style.lock().await = loaded.manifest.style.clone();
	*state.project_dir.lock().await = dir;
	Ok(loaded.manifest.style)
}

/// Whether a directory holds a project — so the open dialog can say why one does not.
#[tauri::command]
#[specta::specta]
pub fn is_project(dir: String) -> bool {
	studio_core::project::is_project(std::path::Path::new(&dir))
}
