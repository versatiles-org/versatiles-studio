//! Writing a graph's output to a container file (S3.6, F2).

use crate::state::AppState;
use std::path::PathBuf;
use studio_core::estimate::Estimate;
use studio_core::export::Bounds;
use studio_core::graphs::{Graph, GraphId};
use studio_core::jobs::{JobId, Lane};
use tauri::State;

/// The container formats Studio can write.
///
/// Asked for rather than repeated in the webview: the list decides the file dialog's filters, the
/// modal's wording *and* whether a chosen path is refused, and three copies of it would disagree
/// the first time a format was added.
#[tauri::command]
#[specta::specta]
pub fn writable_formats() -> Vec<String> {
	studio_core::export::WRITABLE
		.iter()
		.map(|format| (*format).to_string())
		.collect()
}

/// Starts an export and returns the job running it.
///
/// **Returns the job rather than the result.** A conversion is the long operation the runner exists
/// for (E7) - minutes and gigabytes - so waiting for it here would hold a command open for the whole
/// write and leave the webview with nothing to show meanwhile. The job's progress, log and failure
/// all arrive on the event channel the bar is already listening to, which is where a user can watch
/// or cancel it.
///
/// **`Queued`, not `Latest`** ([Q27]): two conversions compete for the same disk and cores and
/// finish later than the same two in sequence, and a second export is a second thing you asked for
/// rather than a correction of the first - unlike a preview, which stops mattering the moment the
/// pipeline changes.
///
/// [Q27]: ../../../docs/decisions.md
#[tauri::command]
#[specta::specta]
pub async fn export_graph(
	window: tauri::Window,
	state: State<'_, AppState>,
	graph: GraphId,
	target: String,
	bounds: Bounds,
) -> Result<JobId, String> {
	// The pipeline and the directory it resolves against come out of the project together, under one
	// lock: they are two halves of one answer, and reading them separately would let an `open_project`
	// in between hand the export one project's graph and another's paths (S7.1).
	let project = state.project(&window).await;
	let (pipeline, dir) = {
		let project = project.lock().await;
		// **What runs is what the eyes say** ([Q49]), so the tiles written are the tiles that were
		// on the map. `None` is a graph switched off down to nothing, which there is no honest way
		// to write.
		let Some(pipeline) = project.graphs.get(graph).and_then(Graph::to_pipeline) else {
			return Err("that graph is no longer open, or has nothing switched on".to_string());
		};
		// Relative paths in the VPL resolve against the project directory, exactly as they do for a
		// preview - an export must not mean something different by `filename='berlin.mbtiles'`.
		(pipeline, project.dir.clone())
	};

	let target = PathBuf::from(target);

	// Checked here as well as inside `write`, and the duplication is the point: the same refusal is
	// a rejected command when it happens now and a failed job when it happens later, and "Studio
	// writes versatiles, mbtiles, pmtiles" belongs in the dialog you just used rather than in a job
	// log you would have to open. `write` keeps its own check because it is a library function that
	// has to be safe on its own.
	if !studio_core::export::is_writable(&target) {
		return Err(format!(
			"cannot write {}: Studio writes {}",
			target.display(),
			studio_core::export::WRITABLE.join(", ")
		));
	}

	// Same reasoning as the extension check: the form can be told what is wrong with the numbers it
	// just submitted, rather than a job appearing only to fail.
	bounds.check().map_err(|error| format!("{error:#}"))?;

	let name = target.file_name().map_or_else(
		|| target.display().to_string(),
		|name| name.to_string_lossy().into_owned(),
	);

	Ok(state.jobs.submit(
		format!("Writing {name}"),
		Lane::Queued,
		window.label(),
		move |handle| async move { studio_core::export::write(&handle, pipeline, &dir, &target, bounds).await },
	))
}

/// What an export would cost, before one is started (S3.7, C6).
///
/// **Awaited rather than run as a job**, unlike [`export_graph`]. A job is the right shape for
/// something you start and walk away from; this is something a dialog is waiting on, and it is
/// bounded by [`studio_core::estimate::BUDGET`] precisely so that waiting is reasonable. Putting a
/// two-second measurement in the status bar would also announce it to a window that is not asking -
/// the bar is for work the user started.
///
/// **The refusals are the same as the export's**, and arrive here first: an absurd pyramid and a
/// bounding box that is inside out are both things the dialog can say next to the field that causes
/// them, rather than after a filename has been chosen.
#[tauri::command]
#[specta::specta]
pub async fn estimate_export(
	window: tauri::Window,
	state: State<'_, AppState>,
	graph: GraphId,
	bounds: Bounds,
) -> Result<Estimate, String> {
	let project = state.project(&window).await;
	let (pipeline, dir) = {
		let project = project.lock().await;
		// The same pipeline the export will run, or the number would be about something else.
		let Some(pipeline) = project.graphs.get(graph).and_then(Graph::to_pipeline) else {
			return Err("that graph is no longer open, or has nothing switched on".to_string());
		};
		(pipeline, project.dir.clone())
	};

	bounds.check().map_err(|error| format!("{error:#}"))?;

	studio_core::estimate::estimate(pipeline, &dir, bounds)
		.await
		.map_err(|error| format!("{error:#}"))
}

/// Narrows what an export of this graph writes (F2, S5.2, S5.4).
///
/// **Kept on the graph rather than in the export dialog.** A crop is arrived at by looking at the
/// map - dragging a rectangle over the city you mean - and the dialog is a modal that covers it. It
/// is also worth keeping: it goes into the project manifest, so reopening a project tomorrow is
/// still about the same place.
///
/// The estimate and the write both narrow to it, so what the pane shows and what lands on disk
/// cannot be about different tiles.
#[tauri::command]
#[specta::specta]
pub async fn set_crop(
	window: tauri::Window,
	state: State<'_, AppState>,
	graph: GraphId,
	crop: Bounds,
) -> Result<(), String> {
	let project = state.project(&window).await;
	let mut project = project.lock().await;
	if !project
		.graphs
		.set_crop(graph, crop)
		.map_err(|error| format!("{error:#}"))?
	{
		return Err("that graph is no longer open".to_string());
	}
	Ok(())
}
