//! Writing a graph's output to a container file (S3.6, F2).

use crate::state::AppState;
use std::path::PathBuf;
use studio_core::export::Bounds;
use studio_core::graphs::GraphId;
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
/// for (E7) — minutes and gigabytes — so waiting for it here would hold a command open for the whole
/// write and leave the webview with nothing to show meanwhile. The job's progress, log and failure
/// all arrive on the event channel the bar is already listening to, which is where a user can watch
/// or cancel it.
///
/// **`Queued`, not `Latest`** ([Q27]): two conversions compete for the same disk and cores and
/// finish later than the same two in sequence, and a second export is a second thing you asked for
/// rather than a correction of the first — unlike a preview, which stops mattering the moment the
/// pipeline changes.
///
/// [Q27]: ../../../docs/decisions.md
#[tauri::command]
#[specta::specta]
pub async fn export_graph(
	state: State<'_, AppState>,
	graph: GraphId,
	target: String,
	bounds: Bounds,
) -> Result<JobId, String> {
	let Some(pipeline) = state
		.graphs
		.lock()
		.await
		.get(graph)
		.map(|graph| graph.document.to_pipeline())
	else {
		return Err("that graph is no longer open".to_string());
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

	// Relative paths in the VPL resolve against the project directory, exactly as they do for a
	// preview — an export must not mean something different by `filename='berlin.mbtiles'`.
	let dir = state.project_dir.lock().await.clone();

	let name = target.file_name().map_or_else(
		|| target.display().to_string(),
		|name| name.to_string_lossy().into_owned(),
	);

	Ok(state
		.jobs
		.submit(format!("Writing {name}"), Lane::Queued, move |handle| async move {
			studio_core::export::write(&handle, pipeline, &dir, &target, bounds).await
		}))
}
