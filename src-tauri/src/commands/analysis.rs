//! What a graph's tiles weigh, are made of, and whether they are valid (S14, [Q72]).
//!
//! [Q72]: ../../../docs/decisions.md

use crate::state::AppState;
use studio_core::graphs::GraphId;
use studio_core::jobs::Lane;
use studio_core::measure::{self, Sizes};
use tauri::State;

/// Walks every tile size of a graph's output (S14.1, B1).
///
/// **A job, and a queued one.** A walk over a large container is seconds of disk, and the job bar is
/// where a person watches it and stops it. `Queued` rather than `Latest`, because `Latest` supersedes
/// within a window - and the window's preview builds are `Latest` too, so measuring would cancel the
/// build the map is waiting on.
///
/// **Only a graph that is a container**, for now: see [`measure::container_behind`]. The container is
/// opened again rather than reached through the mounted pipeline, because `from_container` answers a
/// size by reading the tile body - the index is what makes this fast.
#[tauri::command]
#[specta::specta]
pub async fn measure_sizes(window: tauri::Window, state: State<'_, AppState>, graph: GraphId) -> Result<Sizes, String> {
	let (name, container) = {
		let held = state.project(&window).await;
		let project = held.lock().await;
		let Some(found) = project.graphs.get(graph) else {
			return Err("that source is no longer open".to_string());
		};
		let Some(pipeline) = found.drawn() else {
			return Err("this source is switched off, so it has no tiles to measure".to_string());
		};
		(found.name.clone(), measure::container_behind(&pipeline, &project.dir))
	};
	let Some(container) = container else {
		return Err(
			"this source transforms its tiles, so they have no index to read sizes from - only a source that reads a container unchanged can be measured yet"
				.to_string(),
		);
	};
	let runtime = state.server.lock().await.runtime().clone();

	let (tx, rx) = tokio::sync::oneshot::channel();
	state.jobs.submit(
		format!("Measuring {name}"),
		Lane::Queued,
		window.label(),
		move |handle| async move {
			let outcome = async {
				let source = runtime.reader_from_str(&container).await?;
				measure::walk(
					source.as_ref(),
					|done, total| handle.counted(done, total, "reading tile sizes"),
					|| handle.is_cancelled(),
				)
				.await
			}
			.await;
			let _ = tx.send(outcome.as_ref().map_err(|e| format!("{e:#}")).cloned());
			outcome.map(|_| ())
		},
	);

	rx.await
		.unwrap_or_else(|_| Err("the measurement was cancelled".to_string()))
}
