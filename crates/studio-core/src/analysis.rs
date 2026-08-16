//! Analysis services — probe-derived statistics, cached in memory per container ([Q4]).
//!
//! Only the cheapest tier exists so far: container metadata and the real zoom range, which is
//! effectively free because `tile_pyramid()` reads the block index and is memoised. Tile sizes
//! (index-only) and tile contents (expensive, sampled) come after release 1 with cluster B.
//!
//! [Q4]: ../../../docs/decisions.md

use anyhow::{Context, Result};
use serde::Serialize;
use versatiles_container::{SharedTileSource, TilesRuntime};

/// What Studio knows about a container without reading a single tile body.
///
/// Serialisable so the control plane can hand it to the inspector (A6) verbatim.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerInfo {
	/// How the user referred to it — a path or a URL.
	pub source: String,
	/// Container kind, e.g. `versatiles`, `mbtiles`, `pmtiles`.
	pub container: String,
	/// Tile format, e.g. `mvt`, `png`, `webp`.
	pub tile_format: String,
	/// Tile compression, e.g. `gzip`, `brotli`, `none`.
	pub tile_compression: String,
	/// The zoom levels that actually contain tiles — not what the metadata claims.
	pub min_zoom: u8,
	pub max_zoom: u8,
	/// `[west, south, east, north]`, if the pyramid is non-empty.
	pub bbox: Option<[f64; 4]>,
	/// TileJSON as published by the container, for the inspector to show and edit (A6).
	pub tile_json: serde_json::Value,
}

/// Opens a container and reads everything cheap about it.
///
/// Returns the source too, so the caller can mount it on the embedded server without opening the
/// file twice.
pub async fn open(runtime: &TilesRuntime, source: &str) -> Result<(SharedTileSource, ContainerInfo)> {
	let reader = runtime
		.reader_from_str(source)
		.await
		.with_context(|| format!("opening {source:?}"))?;

	let metadata = reader.metadata();
	let pyramid = reader.tile_pyramid().await.context("reading the tile pyramid")?;

	// The *real* zoom range and extent, derived from which levels actually hold tiles — container
	// metadata routinely overstates both, which is half of why A6 exists.
	let min_zoom = pyramid.level_min().unwrap_or(0);
	let max_zoom = pyramid.level_max().unwrap_or(0);
	let bbox = pyramid.geo_bbox().map(|b| b.as_array());

	let info = ContainerInfo {
		source: source.to_string(),
		container: reader.source_type().to_string(),
		tile_format: metadata.tile_format().to_string(),
		tile_compression: metadata.tile_compression().to_string(),
		min_zoom,
		max_zoom,
		bbox,
		// versatiles has its own JSON value type; round-tripping through the wire format is the
		// cheapest honest conversion, and this runs once per open, not per tile.
		tile_json: serde_json::from_str(&reader.tilejson().stringify()).context("parsing TileJSON")?,
	};

	Ok((reader, info))
}

#[cfg(test)]
pub(crate) mod tests {
	use super::*;
	use std::path::PathBuf;

	/// Where the sample containers live.
	///
	/// They are not vendored: `berlin.versatiles` alone is 25 MB, and binaries in git age badly.
	/// Set `STUDIO_TESTDATA`, or keep a `versatiles-rs` checkout beside this one — the layout every
	/// contributor already has. Absent both, the format tests skip rather than fail.
	fn testdata_dir() -> Option<PathBuf> {
		if let Ok(dir) = std::env::var("STUDIO_TESTDATA") {
			let path = PathBuf::from(dir);
			return path.is_dir().then_some(path);
		}
		let sibling = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../versatiles-rs/testdata");
		sibling.is_dir().then_some(sibling)
	}

	/// A sample container, if this machine has one.
	pub(crate) fn sample_container(name: &str) -> Option<PathBuf> {
		let path = testdata_dir()?.join(name);
		path.exists().then_some(path)
	}

	/// All three container formats A1 promises, read through one code path.
	#[tokio::test]
	async fn reads_every_container_format() -> Result<()> {
		let Some(dir) = testdata_dir() else {
			eprintln!("skipping: set STUDIO_TESTDATA to a directory of sample containers");
			return Ok(());
		};
		let runtime = versatiles::runtime::create_runtime();

		for name in ["berlin.versatiles", "berlin.mbtiles", "berlin.pmtiles"] {
			let path = dir.join(name);
			if !path.exists() {
				continue;
			}
			let (_source, info) = open(&runtime, path.to_str().unwrap()).await?;

			assert_eq!(info.tile_format, "mvt", "{name} should be vector tiles");
			assert!(info.max_zoom >= info.min_zoom, "{name} zoom range must be ordered");

			let bbox = info.bbox.unwrap_or_else(|| panic!("{name} should report an extent"));
			assert!(
				bbox[0] > 13.0 && bbox[2] < 14.0,
				"{name} should be around Berlin, got {bbox:?}"
			);
			assert!(info.tile_json.is_object(), "{name} should publish TileJSON");
		}
		Ok(())
	}

	#[tokio::test]
	async fn a_missing_file_reports_which_one() {
		let runtime = versatiles::runtime::create_runtime();
		let error = open(&runtime, "/nope/absent.versatiles").await.unwrap_err();
		assert!(
			format!("{error:?}").contains("absent.versatiles"),
			"the error should name the file the user asked for"
		);
	}
}
