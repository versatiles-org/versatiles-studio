//! Analysis services - probe-derived statistics, cached in memory per container ([Q4]).
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
	/// How the user referred to it - a path or a URL.
	pub source: String,
	/// Container kind - just the name: `versatiles`, `mbtiles`, `pmtiles`, `tar`, `directory`.
	pub container: String,
	/// Tile format, e.g. `mvt`, `png`, `webp`.
	pub tile_format: String,
	/// Tile compression, e.g. `gzip`, `brotli`, `none`.
	pub tile_compression: String,
	/// The zoom levels that actually contain tiles - not what the metadata claims.
	pub min_zoom: u8,
	pub max_zoom: u8,
	/// `[west, south, east, north]`, if the pyramid is non-empty.
	#[cfg_attr(feature = "bindings", specta(type = Option<[specta_typescript::Number; 4]>))]
	pub bbox: Option<[f64; 4]>,
	/// What the container says its tiles *contain*, if it says - `shortbread@1.0`, `dem/mapbox`,
	/// `rgb`, and the rest of `TileSchema`'s spellings ([S6.1](../../docs/history.md)).
	///
	/// **Passed through as the container's own string rather than mirrored into an enum here.**
	/// `TileSchema` is upstream's and can gain a variant; a copy of its list in Studio would be one
	/// more thing to keep in step, and the failure mode of falling behind is silently misreading a
	/// container as something it is not. [`SourceKind`](crate::style::SourceKind) is Studio's
	/// vocabulary and is derived from this, which is a different question with a different answer.
	///
	/// `None` for every container written before the field existed, which is why nothing may depend
	/// on it being present.
	pub tile_schema: Option<String>,
	/// TileJSON as published by the container, for the inspector to show and edit (A6).
	///
	/// Arbitrary JSON, so it is declared opaque: specta refuses `serde_json::Value` because a
	/// `Number` can hold an `i64`, and there is no shape to describe beyond "an object".
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Any))]
	pub tile_json: serde_json::Value,
}

/// The container kind, without the diagnostics around it.
///
/// `SourceType`'s `Display` is written for error messages - a container renders as
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

	// The *real* zoom range and extent, derived from which levels actually hold tiles - container
	// metadata routinely overstates both, which is half of why A6 exists.
	Ok(ContainerInfo {
		source: label.to_string(),
		container: container_name(&reader.source_type()),
		tile_format: metadata.tile_format().to_string(),
		tile_compression: metadata.tile_compression().to_string(),
		min_zoom: pyramid.level_min().unwrap_or(0),
		max_zoom: pyramid.level_max().unwrap_or(0),
		bbox: pyramid.geo_bbox().map(|b| b.as_array()),
		tile_schema: reader.tilejson().tile_schema.map(|schema| schema.to_string()),
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
	/// Set `STUDIO_TESTDATA`, or keep a `versatiles-rs` checkout beside this one - the layout every
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

	/// A2 - remote over HTTPS with byte ranges. Ignored by default: it needs the network, and CI
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
			"opened in {:?}: z{}-{}",
			started.elapsed(),
			info.min_zoom,
			info.max_zoom
		);
		Ok(())
	}

	/// Web Mercator tile containing a point - enough to aim a test at real data.
	fn tile_for(lng: f64, lat: f64, z: u8) -> (u32, u32) {
		let n = f64::from(2u32.pow(u32::from(z)));
		let x = ((lng + 180.0) / 360.0 * n).floor();
		let rad = lat.to_radians();
		let y = ((1.0 - (rad.tan() + 1.0 / rad.cos()).ln() / std::f64::consts::PI) / 2.0 * n).floor();
		(x as u32, y as u32)
	}

	/// A4 - decode a real tile and account for its layers.
	#[tokio::test]
	async fn inspects_a_tile_layer_by_layer() -> Result<()> {
		let Some(path) = sample_container("berlin.versatiles") else {
			eprintln!("skipping: set STUDIO_TESTDATA to a directory of sample containers");
			return Ok(());
		};
		let runtime = versatiles::runtime::create_runtime();
		let (source, info) = open(&runtime, path.to_str().unwrap()).await?;

		// Aim at the middle of what the container actually covers. `min_zoom/0/0` is a valid
		// coordinate but an empty tile - the first version of this test asserted against that and
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
	/// What this layer is made of: `point`, `line`, `polygon`, or `unknown` (S4.4, D2).
	///
	/// **The commonest of its features, not all of them.** A layer may mix geometries and MapLibre
	/// draws one kind per layer, so a style deriving itself from this has to pick - and the majority
	/// is the pick that leaves the fewest features invisible. Free to compute: the type is a field on
	/// every feature, already read by the time the tile has decoded.
	pub geometry: String,
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
/// and cannot be imported ([Q12]). This is the reachable subset - encoded size per layer, without
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
	// uncompressed length is what a user means by "how big is this tile" - the number they can
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
			geometry: commonest_geometry(layer),
		})
		.collect();

	// Biggest first - the question this answers is always "what is costing me".
	layers.sort_by_key(|layer| std::cmp::Reverse(layer.encoded_bytes));

	Ok(Some(TileInspection {
		z,
		x,
		y,
		stored_bytes,
		layers,
	}))
}

/// The layers a source produces, probed from one representative tile (S3.3, E1).
///
/// This is how the parameter form learns what is actually in a file. `from_geo` accepts
/// `properties_include` and `properties_exclude` - lists of property names - and the person filling
/// them in has no way to know what those names are without opening the file in something else.
///
/// **Probed from the output rather than parsed from the input**, which is what makes one
/// implementation serve every format: a GeoJSON, a shapefile and a CSV all arrive here as vector
/// tiles with layers and property keys, and a format Studio has never heard of would too.
///
/// One tile, not a survey. The tile is the one covering the middle of the source's own bounds, at the
/// deepest zoom that decodes to anything.
///
/// **Deepest rather than shallowest**, which is the opposite of what this did. Taking the lowest zoom
/// is right for the small-to-middling files an import produces, where every feature is in the one
/// tile - and wrong for a container with a real pyramid, where the low zooms are generalised down to
/// almost nothing: `berlin.versatiles` answers with no layers at zoom 0, four at zoom 6 and fourteen
/// at zoom 14. Every full pyramid opened in Studio had an empty layers panel because of it.
///
/// Going down from the deepest rather than up from the shallowest also handles the sparse case: a
/// centre tile with nothing in it at zoom 14 is skipped for one that has something.
///
/// A property that appears only in a corner of a planet-sized extract will still be missed - this is
/// a list of suggestions, and the field it feeds still accepts anything typed into it.
///
/// Empty for raster sources, and for a pyramid with no tiles in it. Never an error: a probe that
/// fails should cost the caller its suggestions, not its import.
///
/// **A raster source is answered from its declared format, without reading a tile.** The loop below
/// learns "these are not vector tiles" by building one and failing to decode it - and since that
/// failure is the same at every level, it went on to do it again for every zoom in the pyramid. A
/// `raster_overview` chain over a GeoTIFF is z0-13, so fourteen GDAL reads were spent arriving at the
/// empty list `tile_format` gives for free - in front of the mount the map is waiting on, which is
/// what made changing a parameter on a raster node take seconds to show.
pub async fn probe_layers(source: &SharedTileSource, info: &ContainerInfo) -> Vec<LayerInspection> {
	use versatiles_core::TileCoord;

	if source.metadata().tile_format().is_raster() {
		return Vec::new();
	}

	let Some([west, south, east, north]) = info.bbox else {
		return Vec::new();
	};
	for level in (info.min_zoom..=info.max_zoom).rev() {
		let Ok(coord) = TileCoord::from_geo((west + east) / 2.0, (south + north) / 2.0, level) else {
			continue;
		};
		match inspect_tile(source, coord.level, coord.x, coord.y).await {
			Ok(Some(tile)) if !tile.layers.is_empty() => return tile.layers,
			// A raster tile does not decode as a vector, and that is not news - it is the answer, and
			// it will be the same answer at every other zoom.
			Ok(None) => return Vec::new(),
			Ok(Some(_)) | Err(_) => continue,
		}
	}
	Vec::new()
}

#[cfg(test)]
mod probe_tests {
	use super::*;

	fn testdata() -> Option<std::path::PathBuf> {
		let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../versatiles-rs/testdata");
		dir.exists().then_some(dir)
	}

	/// E1's "map columns": the form can only offer property names if something has read them, and
	/// this is that something. Checked against a file whose properties are known, so a probe that
	/// silently returned nothing would not pass.
	#[tokio::test]
	async fn a_vector_source_reports_its_layers_and_property_keys() -> Result<()> {
		let Some(dir) = testdata() else {
			eprintln!("skipping: set STUDIO_TESTDATA to a directory of sample containers");
			return Ok(());
		};
		let runtime = versatiles::runtime::create_runtime();

		for file in ["places.geojson", "borders.geojson", "admin.shp"] {
			let vpl = crate::vpl::read_node("from_geo", &dir.join(file).to_string_lossy());
			let document = crate::vpl::Document::parse(&vpl)?;
			let source = crate::preview::build(&runtime, document.to_pipeline(), &dir).await?;
			let info = describe(&source, "preview").await?;

			let layers = probe_layers(&source, &info).await;
			assert_eq!(layers.len(), 1, "{file} should produce one layer, got {layers:?}");
			assert_eq!(
				layers[0].name,
				file.split('.').next().unwrap(),
				"the layer is named after the file unless `layer_name` says otherwise"
			);
			assert!(
				layers[0].property_keys.contains(&"name".to_string()),
				"{file} lost its properties: {:?}",
				layers[0].property_keys
			);
			assert!(layers[0].feature_count > 0);
		}
		Ok(())
	}

	/// A probe that fails costs the caller its suggestions, not its import - so a raster source is
	/// an empty list rather than an error.
	#[tokio::test]
	async fn a_raster_source_has_no_layers_and_does_not_fail() -> Result<()> {
		let runtime = versatiles::runtime::create_runtime();
		let document = crate::vpl::Document::parse("from_debug format=png")?;
		let source = crate::preview::build(&runtime, document.to_pipeline(), std::path::Path::new(".")).await?;
		let info = describe(&source, "preview").await?;

		assert_eq!(info.tile_format, "png");
		assert!(probe_layers(&source, &info).await.is_empty());
		Ok(())
	}

	/// Counts what its inner source is asked for, so a probe that reads nothing can be asserted on.
	///
	/// Only `tile` is counted, and only the methods the probe uses are forwarded - a wrapper that
	/// implemented the rest by hand would be a second source with its own opinions, which is not what
	/// is being measured here.
	#[derive(Debug)]
	struct Counting {
		inner: SharedTileSource,
		tiles: std::sync::atomic::AtomicUsize,
	}

	#[async_trait::async_trait]
	impl versatiles_container::TileSource for Counting {
		async fn tile(&self, coord: &versatiles_core::TileCoord) -> Result<Option<versatiles_container::Tile>> {
			self.tiles.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
			self.inner.tile(coord).await
		}

		fn source_type(&self) -> std::sync::Arc<SourceType> {
			self.inner.source_type()
		}

		fn metadata(&self) -> &versatiles_container::TileSourceMetadata {
			self.inner.metadata()
		}

		fn tilejson(&self) -> &versatiles_core::TileJSON {
			self.inner.tilejson()
		}

		async fn tile_pyramid(&self) -> Result<std::sync::Arc<versatiles_core::TilePyramid>> {
			self.inner.tile_pyramid().await
		}

		async fn tile_stream(
			&self,
			bbox: versatiles_core::TileBBox,
		) -> Result<versatiles_core::TileStream<'static, versatiles_container::Tile>> {
			self.inner.tile_stream(bbox).await
		}
	}

	/// **The raster answer costs nothing to give**, which is the whole of why this test exists.
	///
	/// The empty list above was arrived at by building a tile at *every* zoom and failing to decode
	/// each one as a vector - fourteen GDAL reads for a `raster_overview` chain, in front of the mount
	/// the map is waiting on. Asserted as "no tile was read" rather than as a duration, because a
	/// timing threshold is the kind of test that fails on a loaded machine and passes on a fast one.
	#[tokio::test]
	async fn a_raster_source_is_answered_without_reading_a_tile() -> Result<()> {
		let runtime = versatiles::runtime::create_runtime();
		// A pyramid rather than a single level: the loop this replaces cost one read per zoom, so a
		// source with one level would not tell a fix from the bug.
		let document = crate::vpl::Document::parse("from_debug format=png | filter level_min=0 level_max=8")?;
		let built = crate::preview::build(&runtime, document.to_pipeline(), std::path::Path::new(".")).await?;

		let counted = std::sync::Arc::new(Counting {
			inner: built,
			tiles: std::sync::atomic::AtomicUsize::new(0),
		});
		let source: SharedTileSource = counted.clone();
		let info = describe(&source, "preview").await?;
		assert!(info.max_zoom > info.min_zoom, "the fixture needs more than one level");

		assert!(probe_layers(&source, &info).await.is_empty());
		assert_eq!(
			counted.tiles.load(std::sync::atomic::Ordering::Relaxed),
			0,
			"a raster source's layers are known from its format; no tile should have been built"
		);
		Ok(())
	}

	/// The counterpart: a vector source is still probed, so the check above cannot have turned the
	/// probe off for everything.
	#[tokio::test]
	async fn a_vector_source_is_still_probed() -> Result<()> {
		let runtime = versatiles::runtime::create_runtime();
		let document = crate::vpl::Document::parse("from_debug format=pbf | filter level_min=0 level_max=8")?;
		let built = crate::preview::build(&runtime, document.to_pipeline(), std::path::Path::new(".")).await?;

		let counted = std::sync::Arc::new(Counting {
			inner: built,
			tiles: std::sync::atomic::AtomicUsize::new(0),
		});
		let source: SharedTileSource = counted.clone();
		let info = describe(&source, "preview").await?;

		assert!(!probe_layers(&source, &info).await.is_empty());
		assert!(
			counted.tiles.load(std::sync::atomic::Ordering::Relaxed) > 0,
			"a vector source's layers can only come from a tile"
		);
		Ok(())
	}
}

/// The geometry most of a layer's features are.
///
/// Ties go to the more specific: a layer split evenly between lines and polygons is drawn as
/// polygons, because a polygon drawn as a line still shows its outline while a line drawn as a
/// polygon shows nothing at all.
fn commonest_geometry(layer: &versatiles_geometry::vector_tile::VectorTileLayer) -> String {
	use versatiles_geometry::vector_tile::GeomType;

	let mut counts = [0usize; 4];
	for feature in &layer.features {
		counts[feature.geom_type as usize] += 1;
	}
	// Descending specificity, so the first maximum found is the more specific one.
	[
		(GeomType::MultiPolygon, "polygon"),
		(GeomType::MultiLineString, "line"),
		(GeomType::MultiPoint, "point"),
	]
	.into_iter()
	.max_by_key(|(kind, _)| counts[*kind as usize])
	.filter(|(kind, _)| counts[*kind as usize] > 0)
	.map_or_else(|| "unknown".to_string(), |(_, name)| name.to_string())
}

/// Whether one transform can be appended to what a node produces (S2.14).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Fit {
	/// The operation's tag, as it would be written in VPL.
	pub name: String,
	/// Why it does not fit, in upstream's words - or `None` when nothing rules it out.
	///
	/// The reason is the whole point of reporting the misfits at all: a picker that silently
	/// dropped `raster_flatten` from a vector chain would leave someone looking for an operation
	/// they know exists.
	pub reason: Option<String>,
}

/// Which transforms can be appended to `source`, and why the rest cannot (S2.14).
///
/// **Upstream's answer, not ours.** Studio asked for this as
/// [vt#235](https://github.com/versatiles-org/versatiles-rs/issues/235) rather than reimplementing
/// every operation's requirements here, because the operation is the thing that knows them - the
/// reverse test in [architecture.md](../../docs/architecture.md): when the knowledge lives
/// upstream, so does the question.
///
/// Cheap enough to run on every preview: each check is a comparison against the source's declared
/// tile type, so nothing here reads a tile.
pub async fn fitting(source: &SharedTileSource) -> Vec<Fit> {
	versatiles_pipeline::compatible_transforms(source.as_ref())
		.await
		.into_iter()
		.map(|(meta, compatibility)| Fit {
			name: meta.tag_name,
			reason: match compatibility {
				versatiles_pipeline::Compatibility::Fits => None,
				versatiles_pipeline::Compatibility::Wrong(reason) => Some(reason),
				// `Compatibility` is `#[non_exhaustive]`, so a later version can add a verdict this
				// build has never heard of. Offering it is the safe direction: a picker that hid an
				// operation would have no reason to show, and "no reason to show" is exactly the
				// state this feature exists to remove.
				_ => None,
			},
		})
		.collect()
}

#[cfg(test)]
mod fit_tests {
	use super::*;

	/// The whole point: a vector chain and a raster chain must not be offered the same operations.
	///
	/// Asserted as a *difference* rather than against a fixed list - the operation set grows with
	/// every upstream release, and a test that named them would fail on the good news.
	#[tokio::test]
	async fn what_fits_depends_on_what_the_tiles_are() {
		let vector = fits_for("from_debug format=pbf").await;
		let raster = fits_for("from_debug format=png").await;

		assert!(!vector.is_empty() && !raster.is_empty(), "no transforms at all");
		assert_ne!(
			offered(&vector),
			offered(&raster),
			"vector and raster tiles were offered exactly the same operations"
		);

		// A refusal has to say why; that reason is what the picker shows.
		for fit in vector.iter().chain(&raster) {
			if let Some(reason) = &fit.reason {
				assert!(!reason.trim().is_empty(), "{} was refused without a reason", fit.name);
			}
		}
	}

	/// A raster-only operation is refused for vector tiles and offered for raster ones - the
	/// concrete case from the issue that asked for this upstream.
	#[tokio::test]
	async fn a_raster_operation_is_not_offered_for_vector_tiles() {
		let vector = fits_for("from_debug format=pbf").await;
		let raster = fits_for("from_debug format=png").await;

		let Some(refused) = vector.iter().find(|fit| fit.name.starts_with("raster_")) else {
			panic!("this build has no raster_* transform to check");
		};
		assert!(
			refused.reason.is_some(),
			"{} was offered for vector tiles",
			refused.name
		);
		let same = raster.iter().find(|fit| fit.name == refused.name).unwrap();
		assert_eq!(same.reason, None, "{} was refused for raster tiles too", same.name);
	}

	async fn fits_for(vpl: &str) -> Vec<Fit> {
		let runtime = versatiles::runtime::create_runtime_builder()
			.silent_progress(true)
			.build();
		let document = crate::vpl::Document::parse(vpl).unwrap();
		let source = crate::preview::build(&runtime, document.to_pipeline(), std::path::Path::new("."))
			.await
			.unwrap();
		fitting(&source).await
	}

	fn offered(fits: &[Fit]) -> Vec<&str> {
		fits
			.iter()
			.filter(|fit| fit.reason.is_none())
			.map(|fit| fit.name.as_str())
			.collect()
	}
}
