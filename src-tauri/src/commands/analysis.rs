//! What a graph's tiles weigh, are made of, and whether they are valid (S14, [Q72]).
//!
//! [Q72]: ../../../docs/decisions.md

use crate::state::AppState;
use std::sync::Arc;
use studio_core::contents::{self, Contents};
use studio_core::dissect::{self, Dissection, TileSummary};
use studio_core::graphs::GraphId;
use studio_core::heat::{self, Heat};
use studio_core::jobs::Lane;
use studio_core::measure::{self, Sizes};
use tauri::State;

/// Why a graph has no index to read sizes from.
const TRANSFORMED: &str = "this source transforms its tiles, so they have no index to read sizes from - only a source that reads a container unchanged can be measured yet";

/// A graph that is a container: its name, its mount and the container it reads.
struct Indexed {
	name: String,
	mount: String,
	container: String,
}

/// The container behind a graph, or why there is none (see [`measure::container_behind`]).
///
/// **The container is opened again rather than reached through the mounted pipeline**, because
/// `from_container` answers a size by reading the tile body - the index is what makes all of this
/// fast.
async fn indexed(window: &tauri::Window, state: &AppState, graph: GraphId) -> Result<Indexed, String> {
	let held = state.project(window).await;
	let project = held.lock().await;
	let Some(found) = project.graphs.get(graph) else {
		return Err("that source is no longer open".to_string());
	};
	let Some(pipeline) = found.drawn() else {
		return Err("this source is switched off, so it has no tiles to measure".to_string());
	};
	let container = measure::container_behind(&pipeline, &project.dir).ok_or_else(|| TRANSFORMED.to_string())?;
	Ok(Indexed {
		name: found.name.clone(),
		mount: project.mount(&found.name),
		container,
	})
}

/// Walks every tile size of a graph's output (S14.1, B1).
///
/// **A job, and a queued one.** A walk over a large container is seconds of disk, and the job bar is
/// where a person watches it and stops it. `Queued` rather than `Latest`, because `Latest` supersedes
/// within a window - and the window's preview builds are `Latest` too, so measuring would cancel the
/// build the map is waiting on.
#[tauri::command]
#[specta::specta]
pub async fn measure_sizes(window: tauri::Window, state: State<'_, AppState>, graph: GraphId) -> Result<Sizes, String> {
	let Indexed { name, container, .. } = indexed(&window, &state, graph).await?;
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

/// Reads what a graph's vector tiles hold, layer by layer per level (S14.7, B2) - a sample, unless
/// `full`.
///
/// **The drawn tiles**, like the tile dialog: a transformed output has no index to measure, but its
/// tiles can be read, so this works for every source - sampled, and saying so. A job in the queued
/// lane for the reason [`measure_sizes`] is.
#[tauri::command]
#[specta::specta]
pub async fn scan_contents(
	window: tauri::Window,
	state: State<'_, AppState>,
	graph: GraphId,
	full: bool,
) -> Result<Contents, String> {
	let source = state
		.previews
		.drawn(window.label(), graph)
		.ok_or_else(|| "this source has not been drawn yet".to_string())?;
	let name = {
		let held = state.project(&window).await;
		let project = held.lock().await;
		project
			.graphs
			.get(graph)
			.map_or_else(|| "a source".to_string(), |found| found.name.clone())
	};

	let (tx, rx) = tokio::sync::oneshot::channel();
	state.jobs.submit(
		format!("Reading the layers of {name}"),
		Lane::Queued,
		window.label(),
		move |handle| async move {
			let outcome = contents::scan(source.as_ref(), full, |done, total| {
				handle.counted(done, total, "decoding tiles");
			})
			.await;
			let _ = tx.send(outcome.as_ref().map_err(|e| format!("{e:#}")).cloned());
			outcome.map(|_| ())
		},
	);

	rx.await.unwrap_or_else(|_| Err("the scan was cancelled".to_string()))
}

/// Where a graph's heat map is served, and over which levels (S14.3).
#[derive(serde::Serialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HeatMount {
	pub tile_url: String,
	/// The lowest level it is drawn at; above this, one heat tile would be a million sizes.
	pub min_zoom: u8,
	/// The detail level, which is also the deepest level it is drawn at.
	pub max_zoom: u8,
	/// Where the colour changes, in bytes - the legend's numbers.
	pub bands: Vec<u32>,
}

/// The name a graph's heat map is mounted under: beside its own mount, and taken down with it.
///
/// `~` because a graph's name is letters, digits and dashes, so no graph can be called this.
fn heat_mount(mount: &str) -> String {
	format!("{mount}~heat")
}

/// Mounts a heat map of a graph's tile sizes at `detail` (S14.3).
///
/// `colours` are the four band colours as `#rrggbb`, from the webview's tokens - the core draws the
/// pixels, but the palette is the theme's.
#[tauri::command]
#[specta::specta]
pub async fn mount_heat(
	window: tauri::Window,
	state: State<'_, AppState>,
	graph: GraphId,
	detail: u8,
	colours: Vec<String>,
) -> Result<HeatMount, String> {
	let Indexed { mount, container, .. } = indexed(&window, &state, graph).await?;
	let palette: heat::Palette = match colours
		.iter()
		.map(|c| heat::parse_colour(c))
		.collect::<anyhow::Result<Vec<_>>>()
	{
		Ok(parsed) => parsed
			.try_into()
			.map_err(|_| "the heat map takes exactly four colours".to_string())?,
		Err(error) => return Err(format!("{error:#}")),
	};

	let mut server = state.server.lock().await;
	let source = server
		.runtime()
		.reader_from_str(&container)
		.await
		.map_err(|e| format!("{e:#}"))?;
	let drawn = Heat::new(source, detail, palette).await.map_err(|e| format!("{e:#}"))?;
	let min_zoom = drawn.min_zoom();
	let name = heat_mount(&mount);
	server
		.mount(&name, Arc::new(drawn))
		.await
		.map_err(|e| format!("{e:#}"))?;
	Ok(HeatMount {
		tile_url: server.tile_url(&name),
		min_zoom,
		max_zoom: detail,
		bands: heat::BANDS.to_vec(),
	})
}

/// Takes a graph's heat map down. Nothing to do when there is none.
#[tauri::command]
#[specta::specta]
pub async fn unmount_heat(window: tauri::Window, state: State<'_, AppState>, graph: GraphId) -> Result<(), String> {
	let mount = {
		let held = state.project(&window).await;
		let project = held.lock().await;
		let Some(found) = project.graphs.get(graph) else {
			return Ok(());
		};
		project.mount(&found.name)
	};
	state
		.server
		.lock()
		.await
		.unmount(&heat_mount(&mount))
		.map(|_| ())
		.map_err(|e| format!("{e:#}"))
}

/// One tile's stored size, for the heat map's hover - `None` where there is no tile.
#[tauri::command]
#[specta::specta]
pub async fn tile_bytes(
	window: tauri::Window,
	state: State<'_, AppState>,
	graph: GraphId,
	z: u8,
	x: u32,
	y: u32,
) -> Result<Option<u32>, String> {
	let Indexed { container, .. } = indexed(&window, &state, graph).await?;
	let runtime = state.server.lock().await.runtime().clone();
	let found = async {
		let source = runtime.reader_from_str(&container).await?;
		measure::tile_bytes(source.as_ref(), z, x, y).await
	}
	.await;
	found.map_err(|e| format!("{e:#}"))
}

/// Takes apart the tile the map draws for a graph at `z/x/y` (S14.4, A4) - `None` where it has none.
///
/// **The drawn tile, not the container's**: the preview's own source, so a filter, an overzoom or a
/// repair upstream shows here as it shows on the map - which is what someone clicking a tile on the
/// map is asking about.
#[tauri::command]
#[specta::specta]
pub async fn dissect_tile(
	window: tauri::Window,
	state: State<'_, AppState>,
	graph: GraphId,
	z: u8,
	x: u32,
	y: u32,
) -> Result<Option<Dissection>, String> {
	let source = state
		.previews
		.drawn(window.label(), graph)
		.ok_or_else(|| "this source has not been drawn yet".to_string())?;
	dissect::dissect(source.as_ref(), z, x, y)
		.await
		.map_err(|e| format!("{e:#}"))
}

/// The drawn tile at `z/x/y` in brief, for the map's popup (S14.6, A8) - `None` where it has none.
///
/// Read from the source the map draws, like [`dissect_tile`], so the popup and the map agree - and
/// nothing is opened per click.
#[tauri::command]
#[specta::specta]
pub async fn summarise_tile(
	window: tauri::Window,
	state: State<'_, AppState>,
	graph: GraphId,
	z: u8,
	x: u32,
	y: u32,
) -> Result<Option<TileSummary>, String> {
	let source = state
		.previews
		.drawn(window.label(), graph)
		.ok_or_else(|| "this source has not been drawn yet".to_string())?;
	dissect::summarise(source.as_ref(), z, x, y)
		.await
		.map_err(|e| format!("{e:#}"))
}
