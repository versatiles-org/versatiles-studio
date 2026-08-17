//! Analysis services — probe-derived statistics, cached in memory per container ([Q4]).
//!
//! Only the cheapest tier exists so far: container metadata and the real zoom range, which is
//! effectively free because `tile_pyramid()` reads the block index and is memoised. Tile sizes
//! (index-only) and tile contents (expensive, sampled) come after release 1 with cluster B.
//!
//! [Q4]: ../../../docs/decisions.md

use anyhow::{Context, Result};
use serde::Serialize;
use versatiles_container::{SharedTileSource, SourceType, TilesRuntime};

/// What Studio knows about a container without reading a single tile body.
///
/// Serialisable so the control plane can hand it to the inspector (A6) verbatim.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct ContainerInfo {
	/// How the user referred to it — a path or a URL.
	pub source: String,
	/// Container kind — just the name: `versatiles`, `mbtiles`, `pmtiles`, `tar`, `directory`.
	pub container: String,
	/// Tile format, e.g. `mvt`, `png`, `webp`.
	pub tile_format: String,
	/// Tile compression, e.g. `gzip`, `brotli`, `none`.
	pub tile_compression: String,
	/// The zoom levels that actually contain tiles — not what the metadata claims.
	pub min_zoom: u8,
	pub max_zoom: u8,
	/// `[west, south, east, north]`, if the pyramid is non-empty.
	#[cfg_attr(feature = "bindings", specta(type = Option<[specta_typescript::Number; 4]>))]
	pub bbox: Option<[f64; 4]>,
	/// TileJSON as published by the container, for the inspector to show and edit (A6).
	///
	/// Arbitrary JSON, so it is declared opaque: specta refuses `serde_json::Value` because a
	/// `Number` can hold an `i64`, and there is no shape to describe beyond "an object".
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Any))]
	pub tile_json: serde_json::Value,
}

/// The container kind, without the diagnostics around it.
///
/// `SourceType`'s `Display` is written for error messages — a container renders as
/// `container 'mbtiles' ('/path/to/file')`, which is useful in a log and wrong in a label. Studio
/// showed that whole string, path and all, wherever it named a format.
fn container_name(source_type: &SourceType) -> String {
	match source_type {
		SourceType::Container { name, .. } | SourceType::Processor { name, .. } | SourceType::Composite { name, .. } => {
			name.clone()
		}
	}
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
	let info = describe(&reader, source).await?;
	Ok((reader, info))
}

/// Everything cheap to know about a source, whatever it came from.
///
/// Split out because a pipeline's output needs describing exactly like a file does (S2.7): the map
/// wants a format, a real zoom range and an extent, and none of that cares whether the tiles come
/// off a disk or out of six chained operations.
pub async fn describe(reader: &SharedTileSource, label: &str) -> Result<ContainerInfo> {
	let metadata = reader.metadata();
	let pyramid = reader.tile_pyramid().await.context("reading the tile pyramid")?;

	// The *real* zoom range and extent, derived from which levels actually hold tiles — container
	// metadata routinely overstates both, which is half of why A6 exists.
	Ok(ContainerInfo {
		source: label.to_string(),
		container: container_name(&reader.source_type()),
		tile_format: metadata.tile_format().to_string(),
		tile_compression: metadata.tile_compression().to_string(),
		min_zoom: pyramid.level_min().unwrap_or(0),
		max_zoom: pyramid.level_max().unwrap_or(0),
		bbox: pyramid.geo_bbox().map(|b| b.as_array()),
		// versatiles has its own JSON value type; round-tripping through the wire format is the
		// cheapest honest conversion, and this runs once per open, not per tile.
		tile_json: serde_json::from_str(&reader.tilejson().stringify()).context("parsing TileJSON")?,
	})
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
			// The container kind alone. `SourceType`'s Display would put the whole file path in
			// here, and this string is shown in the UI.
			let kind = name.rsplit('.').next().unwrap();
			assert_eq!(info.container, kind, "{name} should report its kind as {kind:?}");
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

	/// A2 — remote over HTTPS with byte ranges. Ignored by default: it needs the network, and CI
	/// should not depend on a third party being up. Run with `cargo test -- --ignored`.
	#[tokio::test]
	#[ignore = "requires network"]
	async fn opens_a_remote_container_without_downloading_it() -> Result<()> {
		let runtime = versatiles::runtime::create_runtime();
		let started = std::time::Instant::now();

		let (_source, info) = open(&runtime, "https://download.versatiles.org/osm.versatiles").await?;

		// The point of byte-range reads: a planet file opens from its header, not its bulk.
		assert!(
			started.elapsed() < std::time::Duration::from_secs(30),
			"opening a planet file should read the index, not the body"
		);
		assert_eq!(info.tile_format, "mvt");
		assert!(
			info.max_zoom >= 14,
			"planet osm should reach z14, got {}",
			info.max_zoom
		);
		eprintln!(
			"opened in {:?}: z{}–{}",
			started.elapsed(),
			info.min_zoom,
			info.max_zoom
		);
		Ok(())
	}

	/// Web Mercator tile containing a point — enough to aim a test at real data.
	fn tile_for(lng: f64, lat: f64, z: u8) -> (u32, u32) {
		let n = f64::from(2u32.pow(u32::from(z)));
		let x = ((lng + 180.0) / 360.0 * n).floor();
		let rad = lat.to_radians();
		let y = ((1.0 - (rad.tan() + 1.0 / rad.cos()).ln() / std::f64::consts::PI) / 2.0 * n).floor();
		(x as u32, y as u32)
	}

	/// A4 — decode a real tile and account for its layers.
	#[tokio::test]
	async fn inspects_a_tile_layer_by_layer() -> Result<()> {
		let Some(path) = sample_container("berlin.versatiles") else {
			eprintln!("skipping: set STUDIO_TESTDATA to a directory of sample containers");
			return Ok(());
		};
		let runtime = versatiles::runtime::create_runtime();
		let (source, info) = open(&runtime, path.to_str().unwrap()).await?;

		// Aim at the middle of what the container actually covers. `min_zoom/0/0` is a valid
		// coordinate but an empty tile — the first version of this test asserted against that and
		// failed, which is exactly the confusion A4 exists to remove.
		let bbox = info.bbox.expect("berlin should report an extent");
		let (lng, lat) = ((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0);
		let (x, y) = tile_for(lng, lat, info.max_zoom);

		let Some(tile) = inspect_tile(&source, info.max_zoom, x, y).await? else {
			panic!(
				"expected a tile at {}/{x}/{y}, the centre of the container's own bbox",
				info.max_zoom
			);
		};

		assert!(tile.stored_bytes > 0, "a populated tile should have a size");
		assert!(!tile.layers.is_empty(), "berlin should have vector layers");

		// Sorted biggest-first, because "what is costing me" is the question this answers.
		let sizes: Vec<_> = tile.layers.iter().map(|l| l.encoded_bytes).collect();
		assert!(
			sizes.windows(2).all(|w| w[0] >= w[1]),
			"layers must be ordered by size: {sizes:?}"
		);

		// Layers cannot outweigh the tile that contains them.
		let total: usize = sizes.iter().sum();
		assert!(
			total <= tile.stored_bytes,
			"layers ({total}) cannot exceed the tile ({})",
			tile.stored_bytes
		);
		Ok(())
	}

	#[tokio::test]
	async fn inspecting_an_absent_tile_returns_none() -> Result<()> {
		let Some(path) = sample_container("berlin.versatiles") else {
			return Ok(());
		};
		let runtime = versatiles::runtime::create_runtime();
		let (source, _) = open(&runtime, path.to_str().unwrap()).await?;

		// A valid coordinate on the far side of the world from Berlin.
		assert!(inspect_tile(&source, 14, 0, 0).await?.is_none());
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

/// One layer of a decoded vector tile (A4).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct LayerInspection {
	pub name: String,
	#[cfg_attr(feature = "bindings", specta(type = u32))]
	pub feature_count: usize,
	/// Exact encoded size of this layer, so "which layer is eating my tile" has an answer.
	#[cfg_attr(feature = "bindings", specta(type = u32))]
	pub encoded_bytes: usize,
	/// Property keys present, for a first look at what is styleable.
	pub property_keys: Vec<String>,
}

/// A decoded tile, layer by layer (A4).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct TileInspection {
	pub z: u8,
	pub x: u32,
	pub y: u32,
	/// Bytes as stored in the container, before decompression.
	#[cfg_attr(feature = "bindings", specta(type = u32))]
	pub stored_bytes: usize,
	pub layers: Vec<LayerInspection>,
}

/// Decodes one tile and reports its layers with byte sizes.
///
/// The per-layer size is computed here rather than reused: `layer_stats()` in versatiles-rs does
/// exactly this, but `tools` is declared in `main.rs` rather than `lib.rs`, so it is binary-only
/// and cannot be imported ([Q12]). This is the reachable subset — encoded size per layer, without
/// the geometry/tag/property split that B2 will want.
///
/// [Q12]: ../../../docs/decisions.md
pub async fn inspect_tile(source: &SharedTileSource, z: u8, x: u32, y: u32) -> Result<Option<TileInspection>> {
	use versatiles_core::{TileCompression, TileCoord};

	let coord = TileCoord::new(z, x, y).context("building the tile coordinate")?;
	let Some(mut tile) = source.tile(&coord).await.context("reading the tile")? else {
		return Ok(None);
	};

	// `Tile` is lazy: ask for the blob and it encodes, ask for the vector and it decodes. The
	// uncompressed length is what a user means by "how big is this tile" — the number they can
	// actually shrink.
	let stored_bytes = tile
		.as_blob(&TileCompression::Uncompressed)
		.context("reading the tile blob")?
		.len() as usize;

	let vector = tile.as_vector().context("decoding the vector tile")?;

	let mut layers: Vec<LayerInspection> = vector
		.layers
		.iter()
		.map(|layer| LayerInspection {
			name: layer.name.clone(),
			feature_count: layer.features.len(),
			encoded_bytes: layer.to_blob().map(|b| b.len() as usize).unwrap_or(0),
			property_keys: layer.property_manager.iter_key().cloned().collect(),
		})
		.collect();

	// Biggest first — the question this answers is always "what is costing me".
	layers.sort_by_key(|layer| std::cmp::Reverse(layer.encoded_bytes));

	Ok(Some(TileInspection {
		z,
		x,
		y,
		stored_bytes,
		layers,
	}))
}
