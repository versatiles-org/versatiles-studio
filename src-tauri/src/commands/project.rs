//! Saving and opening a project directory (G1, S5.1, [Q6]).
//!
//! A project is a folder, so sharing one means sending a folder — and every file in it is usable
//! without Studio: the `.vpl` files run under `versatiles convert`, the `style.json` loads in
//! MapLibre.
//!
//! [Q6]: ../../../docs/decisions.md

use crate::state::{AppState, Project};
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
pub async fn save_project(
	window: tauri::Window,
	state: State<'_, AppState>,
	dir: String,
	style: Option<String>,
) -> Result<(), String> {
	let dir = std::path::PathBuf::from(dir);
	let held = state.project(&window).await;

	// Read under one lock and released before the write: what goes to disk is one project as it
	// stood at one instant, and holding the lock across the write would block this window's own
	// edits for as long as the disk takes.
	let (graphs, recipe) = {
		let project = held.lock().await;
		let graphs: Vec<studio_core::project::SavedGraph> = project
			.graphs
			.iter()
			.map(|graph| studio_core::project::SavedGraph {
				name: graph.name.clone(),
				vpl: graph.document.text().to_string(),
				crop: graph.crop,
			})
			.collect();
		(graphs, project.style.clone())
	};
	if graphs.is_empty() {
		return Err("there is nothing to save yet".to_string());
	}

	studio_core::project::save(&dir, &graphs, &recipe, style.as_deref()).map_err(|error| format!("{error:#}"))?;

	let mut project = held.lock().await;
	project.dir = dir.clone();
	project.root = Some(dir);
	Ok(())
}

/// Where this project lives, or `None` if it has never been saved or opened.
///
/// What tells "Save Project" from "Save Project As…": with an answer here the first writes without
/// asking, and without one there is nothing to write to yet and it has to ask like the second.
#[tauri::command]
#[specta::specta]
pub async fn project_path(window: tauri::Window, state: State<'_, AppState>) -> Result<Option<String>, String> {
	let project = state.project(&window).await;
	let root = project
		.lock()
		.await
		.root
		.as_ref()
		.map(|dir| dir.to_string_lossy().into_owned());
	Ok(root)
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
pub async fn open_project(
	window: tauri::Window,
	state: State<'_, AppState>,
	dir: String,
) -> Result<studio_core::style::Recipe, String> {
	use studio_core::history::{EditKind, Target};

	let dir = std::path::PathBuf::from(dir);
	let loaded = studio_core::project::load(&dir).map_err(|error| format!("{error:#}"))?;

	// Parsed before anything is replaced: a project with one unreadable graph should leave the
	// window as it was rather than half-open.
	let mut documents = Vec::with_capacity(loaded.graphs.len());
	for graph in &loaded.graphs {
		let document = studio_core::vpl::Document::parse(graph.vpl.clone())
			.map_err(|error| format!("{}.vpl does not parse: {}", graph.name, error.message))?;
		documents.push((graph.clone(), document));
	}

	// **This window's project, replaced whole.** Another window's is untouched — which is the
	// difference S7.1 makes: opening a project used to replace the one the entire application had.
	let held = state.project(&window).await;
	let mut project = held.lock().await;
	project.graphs = studio_core::graphs::Graphs::new();
	project.history.clear();

	for (saved, document) in documents {
		let file = dir.join(format!("{}.vpl", saved.name));
		let id = project
			.graphs
			.add(&saved.name, document, Some((file, saved.vpl.clone())));
		// Restored with the graph rather than set afterwards: a crop is part of what the project is.
		project
			.graphs
			.set_crop(id, saved.crop)
			.map_err(|error| format!("{error:#}"))?;
		// The baseline every document needs, so undo has somewhere to step back to.
		project.history.push(Target::Graph(id), saved.vpl, EditKind::Replaced);
	}

	project.style = loaded.manifest.style.clone();
	project.dir = dir.clone();
	project.root = Some(dir);
	Ok(loaded.manifest.style)
}

/// Whether a directory holds a project — so the open dialog can say why one does not.
#[tauri::command]
#[specta::specta]
pub fn is_project(dir: String) -> bool {
	studio_core::project::is_project(std::path::Path::new(&dir))
}

// ---------------------------------------------------------------------------------------------
// A copy that works somewhere else
// ---------------------------------------------------------------------------------------------

/// What a copy of this project would carry (S5.1).
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CopyPlan {
	/// The files that would come along, each once however many pipelines name it.
	pub carry: Vec<studio_core::bundle::Carried>,
	/// References naming a file that is not there — shown, because a copy missing one of these is
	/// still worth making and the person making it should know.
	pub missing: Vec<studio_core::bundle::Reference>,
}

/// The graphs as [`studio_core::bundle`] wants them: text, and what their relative names point at.
///
/// A graph's own `.vpl` directory, because that is what the pipeline resolves against when it runs.
/// A graph never saved has none, and falls back to `project_dir` — the same thing every other
/// relative path in this window resolves against, so a copy and a run agree about what a bare
/// `berlin.mbtiles` means.
type Owned = (String, String, Option<std::path::PathBuf>, studio_core::export::Bounds);

fn sources(project: &Project) -> Vec<Owned> {
	let project_dir = &project.dir;
	project
		.graphs
		.iter()
		.map(|graph| {
			let dir = graph
				.file
				.as_ref()
				.and_then(|(path, _)| path.parent().map(std::path::Path::to_path_buf))
				.unwrap_or_else(|| project_dir.clone());
			(
				graph.name.clone(),
				graph.document.text().to_string(),
				Some(dir),
				graph.crop,
			)
		})
		.collect()
}

fn plan_of(owned: &[Owned]) -> Result<studio_core::bundle::Plan, String> {
	let sources: Vec<studio_core::bundle::Source> = owned
		.iter()
		.map(|(name, text, dir, crop)| studio_core::bundle::Source {
			name,
			text,
			dir: dir.as_deref(),
			crop: *crop,
		})
		.collect();
	studio_core::bundle::plan(&sources).map_err(|error| format!("{error:#}"))
}

/// What copying this project elsewhere would carry, without writing anything.
///
/// Asked before the destination is chosen, so the dialog can say what it costs — the same
/// plan-then-write split `estimate` and `export` use.
#[tauri::command]
#[specta::specta]
pub async fn copy_plan(window: tauri::Window, state: State<'_, AppState>) -> Result<CopyPlan, String> {
	let project = state.project(&window).await;
	let owned = sources(&*project.lock().await);
	let plan = plan_of(&owned)?;
	Ok(CopyPlan {
		carry: plan.carry.clone(),
		missing: plan.missing().into_iter().cloned().collect(),
	})
}

/// Writes a self-contained copy — a directory, or one `.zip`.
///
/// **Planned again here rather than carried over from [`copy_plan`].** The plan is a few `stat`
/// calls, and recomputing it means what is written describes the project as it is now rather than as
/// it was when a dialog opened.
///
/// **On a blocking thread**, because this copies tile containers: `std::fs::copy` of twenty
/// gigabytes must not be sitting on the async runtime. There is no progress to report — neither
/// `fs::copy` nor the zip writer offers any — so the status bar says it is working and that is all
/// it can honestly say.
#[tauri::command]
#[specta::specta]
pub async fn save_project_copy(
	window: tauri::Window,
	state: State<'_, AppState>,
	target: String,
	zip: bool,
	style: Option<String>,
) -> Result<(), String> {
	let held = state.project(&window).await;
	let (owned, recipe) = {
		let project = held.lock().await;
		(sources(&project), project.style.clone())
	};
	if owned.is_empty() {
		return Err("there is nothing to copy yet".to_string());
	}
	let plan = plan_of(&owned)?;

	tauri::async_runtime::spawn_blocking(move || {
		let target = std::path::Path::new(&target);
		if zip {
			studio_core::bundle::write_zip(target, &plan, &recipe, style.as_deref())
		} else {
			studio_core::bundle::write_directory(target, &plan, &recipe, style.as_deref())
		}
	})
	.await
	.map_err(|error| format!("{error}"))?
	.map_err(|error| format!("{error:#}"))
}
