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
use studio_core::preview::SharedTileSource;
use tauri::State;

/// Why a graph has no index to read sizes from.
const TRANSFORMED: &str = "this source transforms its tiles, so they have no index to read sizes from - only a source that reads a container unchanged can be measured yet";

/// A graph that is a container: its name, its mount and the tiles the map draws for it.
struct Indexed {
	name: String,
	mount: String,
	source: SharedTileSource,
}

/// The drawn source of a graph that only reads a container, or why there is none (see
/// [`measure::reads_a_container`]).
///
/// **The source the map draws, not the container opened again.** Until versatiles-rs 5.10
/// `from_container` answered a size by reading the tile body, so this reopened the container by its
/// filename to reach the index - once per measurement, once per heat map and once per *hover* over
/// one, each a header and an index read, and a round trip for a remote container. 5.10 passes the
/// index's sizes through, and the pipeline around it passes them on; so this is the same index, read
/// through the copy that is already open, and it describes the build the map is showing.
async fn indexed(window: &tauri::Window, state: &AppState, graph: GraphId) -> Result<Indexed, String> {
	let (name, mount) = {
		let held = state.project(window).await;
		let project = held.lock().await;
		let Some(found) = project.graphs.get(graph) else {
			return Err("that source is no longer open".to_string());
		};
		if found.drawn().is_none() {
			return Err("this source is switched off, so it has no tiles to measure".to_string());
		}
		(found.name.clone(), project.mount(&found.name))
	};
	let (source, indexed) = state
		.previews
		.drawn_indexed(window.label(), graph)
		.ok_or_else(|| "this source has not been drawn yet".to_string())?;
	if !indexed {
		return Err(TRANSFORMED.to_string());
	}
	Ok(Indexed { name, mount, source })
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
	let Indexed { name, source, .. } = indexed(&window, &state, graph).await?;

	let (tx, rx) = tokio::sync::oneshot::channel();
	state.jobs.submit(
		format!("Measuring {name}"),
		Lane::Queued,
		window.label(),
		move |handle| async move {
			let outcome = measure::walk(
				source.as_ref(),
				|done, total| handle.counted(done, total, "reading tile sizes"),
				|| handle.is_cancelled(),
			)
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

/// Where a graph's heat map is served, and how deep it goes (S14.3).
#[derive(serde::Serialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HeatMount {
	pub tile_url: String,
	/// The deepest level its squares are; a heat tile at zoom `z` draws `min(z + LOOK, deepest)` - see `studio_core::heat::LOOK`.
	pub deepest: u8,
	/// The size at the white end of the ramp, in bytes.
	pub max: u32,
}

/// The name a graph's heat map is mounted under: beside its own mount, and taken down with it.
///
/// `~` because a graph's name is letters, digits and dashes, so no graph can be called this.
fn heat_mount(mount: &str) -> String {
	format!("{mount}~heat")
}

/// Mounts a heat map of a graph's tile sizes, squares no deeper than `deepest` (S14.3).
///
/// `colours` are the ramp's stops as `#rrggbb`, from the webview's tokens - the core draws the
/// pixels, but the colours are the theme's; `max` is the size at the last of them.
#[tauri::command]
#[specta::specta]
pub async fn mount_heat(
	window: tauri::Window,
	state: State<'_, AppState>,
	graph: GraphId,
	deepest: u8,
	colours: Vec<String>,
	max: u32,
) -> Result<HeatMount, String> {
	let Indexed { mount, source, .. } = indexed(&window, &state, graph).await?;
	let ramp = colours
		.iter()
		.map(|c| heat::parse_colour(c))
		.collect::<anyhow::Result<Vec<_>>>()
		.map_err(|e| format!("{e:#}"))?;

	let mut server = state.server.lock().await;
	let drawn = Heat::new(source, deepest, ramp, max)
		.await
		.map_err(|e| format!("{e:#}"))?;
	let name = heat_mount(&mount);
	server
		.mount(&name, Arc::new(drawn))
		.await
		.map_err(|e| format!("{e:#}"))?;
	Ok(HeatMount {
		tile_url: server.tile_url(&name),
		deepest,
		max,
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
	let Indexed { source, .. } = indexed(&window, &state, graph).await?;
	measure::tile_bytes(source.as_ref(), z, x, y)
		.await
		.map_err(|e| format!("{e:#}"))
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
