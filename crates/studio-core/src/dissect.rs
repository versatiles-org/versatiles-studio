//! One tile, taken apart (S14.4, A4, [Q72]).
//!
//! **Everything the tile dialog shows, in one answer**: the sizes, each layer with its byte split and
//! its attributes, each feature with its geometry as encoded, and the spec violations with a preview
//! of what the repair would do. One tile is cheap to take apart completely, so nothing here samples.
//!
//! **Geometry as encoded, not as decoded.** The decoder makes polygons out of rings - dropping an
//! orphan, reorienting a reversed one - which is the right thing for drawing a map and the wrong one
//! for looking at a tile, where a reversed ring is exactly what someone came to see. So the command
//! stream is read here into its parts as written, each ring with its signed area, and the dialog
//! draws those.
//!
//! **Capped**, because a dense tile at a high zoom carries a hundred thousand vertices and all of it
//! crosses IPC as JSON ([Q3]). The layers and attributes are counted over every feature; the features
//! themselves are kept under [`MAX_FEATURES`] and [`MAX_VERTICES`] by taking every n-th of each layer,
//! and the answer says which n. **Not the first so many**: a layer is often stored in order across
//! the tile - addresses west to east - so a tile cut off after its first five thousand features was
//! drawn two thirds wide, from one layer, and looked like a tile with nothing on its right.
//!
//! [Q72]: ../../../docs/decisions.md
//! [Q3]: ../../../docs/decisions.md

use anyhow::{Context, Result};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use versatiles_container::{TileSource, describe_issue_kind};
use versatiles_core::{TileCompression, TileCoord, TileFormat, TileSchema};
use versatiles_geometry::geo::GeoValue;
use versatiles_geometry::vector_tile::{
	GeoValuePBF, GeomType, VectorTile, VectorTileLayer, layer_stats, repair_tile, validate_tile, varint_len,
};
use versatiles_image::{DynamicImage, DynamicImageTraitConvert};

/// The most features a dissection carries geometry for.
pub const MAX_FEATURES: usize = 20_000;

/// The most vertices it carries, over all of those features.
pub const MAX_VERTICES: usize = 200_000;

/// One tile, taken apart.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Dissection {
	pub z: u8,
	pub x: u32,
	pub y: u32,
	/// `mvt`, `png`, … - a raster tile has sizes and nothing to take apart.
	pub format: String,
	/// How the source stores it: `gzip`, `br`, `none`.
	pub compression: String,
	/// Bytes as stored, which is what crosses the wire.
	pub stored_bytes: u32,
	/// Bytes decompressed, which is what the layers below add up to.
	pub raw_bytes: u32,
	pub layers: Vec<LayerDissection>,
	/// Every feature of every layer, in order - or every [`Self::every`]-th, past the caps.
	pub features: Vec<FeatureDissection>,
	/// Which features of each layer `features` holds: every one at 1, every n-th at n.
	pub every: u32,
	pub issues: Vec<TileIssue>,
	/// What `vector_repair` would make of it, when there is anything to repair.
	pub repair: Option<RepairPreview>,
	/// The pixels and what they add up to, for a raster tile. `None` for a vector one.
	pub raster: Option<RasterDissection>,
}

/// How many distinct colours a raster dissection counts before it stops: past this, "a photograph"
/// is the answer, and the exact number would only cost a set of millions.
pub const MAX_COLOURS: usize = 65_536;

/// A raster tile, taken apart: its pixels, and what they add up to.
///
/// **The pixels are sent, losslessly.** A JPEG or a WebP is decoded here and written again as a PNG,
/// so the dialog draws and reads exactly what the pipeline's own decoder sees - and the webview needs
/// to read nothing it might decode differently.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct RasterDissection {
	pub width: u32,
	pub height: u32,
	/// `grey`, `grey + alpha`, `RGB` or `RGBA`.
	pub channels: String,
	/// Whether the tile carries an alpha channel at all.
	pub alpha: bool,
	/// Pixels nothing shows through: alpha 0.
	pub transparent: u32,
	/// Pixels partly see-through: alpha neither 0 nor 255.
	pub translucent: u32,
	/// Distinct colours, alpha included - counted up to [`MAX_COLOURS`].
	pub colours: u32,
	/// Whether counting stopped at [`MAX_COLOURS`], so there are more.
	pub colours_capped: bool,
	/// The pixels as a PNG `data:` URL.
	pub image: String,
	/// What the source says its tiles are, such as `rgb` or `dem/terrarium`, if it says.
	pub schema: Option<String>,
	/// What is worth fixing about it, the most serious first.
	pub checks: Vec<RasterCheck>,
	/// The heights an elevation tile encodes - `None` for imagery, and for a DEM in an encoding
	/// nothing here can decode.
	pub elevation: Option<Elevation>,
}

/// What a DEM tile's colours say in metres.
///
/// **The formulas are upstream's**, from `versatiles_pipeline`'s DEM operations, which do not expose
/// them: `R * 65536 + G * 256 + B` is the raw value, then `raw * 0.1 - 10000` for Mapbox and
/// `raw / 256 - 32768` for Terrarium. `dem/versatiles` has no decoder there either.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Elevation {
	/// `mapbox` or `terrarium`.
	pub encoding: String,
	/// The lowest, highest and mean height, in metres, over the pixels that carry one - a fully
	/// transparent pixel is no data, not a height.
	// Always finite: there is no `Elevation` without a height to take them from. The override is the
	// one on every `f64` that crosses (see `store.rs`), so they are numbers rather than `number | null`.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub min: f64,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub max: f64,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub mean: f64,
}

/// Something about a raster tile worth fixing - the raster counterpart of a [`TileIssue`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct RasterCheck {
	/// `lossy_dem`, `maybe_lossy_dem`, `unused_alpha`, `transparent` or `one_colour`.
	pub kind: String,
	/// What is wrong and why, in a sentence.
	pub label: String,
	/// Whether it changes the data, rather than only costing bytes.
	pub serious: bool,
}

/// Whether a format throws detail away: `Some(true)` for JPEG and lossy WebP, `Some(false)` for PNG
/// and lossless WebP, `None` for AVIF, which is either and does not say so in a way read cheaply.
fn lossy(format: TileFormat, stored: &[u8]) -> Option<bool> {
	match format {
		TileFormat::JPG => Some(true),
		TileFormat::PNG => Some(false),
		TileFormat::WEBP => webp_is_lossy(stored),
		_ => None,
	}
}

/// Whether a WebP file's image is lossy, from its first image chunk: `VP8 ` is lossy and `VP8L`
/// lossless. An extended file (`VP8X`) puts other chunks first, so they are walked past.
fn webp_is_lossy(bytes: &[u8]) -> Option<bool> {
	if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
		return None;
	}
	let mut at = 12;
	while at + 8 <= bytes.len() {
		let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().ok()?) as usize;
		match &bytes[at..at + 4] {
			b"VP8 " => return Some(true),
			b"VP8L" => return Some(false),
			// Chunks are padded to an even length.
			_ => at += 8 + size + (size & 1),
		}
	}
	None
}

/// What is worth fixing about a raster tile, the most serious first.
fn checks(raster: &RasterDissection, format: TileFormat, stored: &[u8]) -> Vec<RasterCheck> {
	let check = |kind: &str, label: &str, serious: bool| RasterCheck {
		kind: kind.to_string(),
		label: label.to_string(),
		serious,
	};
	let mut found = Vec::new();
	let pixels = raster.width * raster.height;

	// The one that is a data error rather than a cost: a DEM's colours are its heights, so a format
	// that changes colours changes the terrain.
	if raster
		.schema
		.as_deref()
		.is_some_and(|schema| schema.starts_with("dem/"))
	{
		match lossy(format, stored) {
			Some(true) => found.push(check(
				"lossy_dem",
				"Heights are stored lossy. In a DEM the colours are the heights, so a lossy format changes the terrain - use PNG or lossless WebP.",
				true,
			)),
			None => found.push(check(
				"maybe_lossy_dem",
				"Heights are stored as AVIF, which is usually lossy - and in a DEM the colours are the heights. Use PNG or lossless WebP to be sure.",
				true,
			)),
			Some(false) => {}
		}
	}
	if raster.alpha && raster.transparent == pixels {
		found.push(check(
			"transparent",
			"Every pixel is transparent, so the tile shows nothing and could be left out.",
			false,
		));
	} else if raster.alpha && raster.transparent == 0 && raster.translucent == 0 {
		found.push(check(
			"unused_alpha",
			"Every pixel is opaque, so the alpha channel only adds bytes - RGB would do.",
			false,
		));
	}
	if raster.colours == 1 && raster.transparent < pixels {
		found.push(check(
			"one_colour",
			"Every pixel is the same colour - often filler such as open sea or no data, which a smaller tile or none would show as well.",
			false,
		));
	}
	found
}

/// A DEM encoding's name, and how it turns a pixel's red, green and blue into metres.
type Decoder = (&'static str, fn([u8; 3]) -> f64);

/// How a DEM encoding turns a pixel into metres, or `None` for a schema that is not one we can read.
fn decoder(schema: Option<&TileSchema>) -> Option<Decoder> {
	fn raw([r, g, b]: [u8; 3]) -> f64 {
		f64::from((u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b))
	}
	match schema? {
		TileSchema::RasterDEMMapbox => Some(("mapbox", |rgb| raw(rgb) * 0.1 - 10_000.0)),
		TileSchema::RasterDEMTerrarium => Some(("terrarium", |rgb| raw(rgb) / 256.0 - 32_768.0)),
		_ => None,
	}
}

/// One layer: what it holds, and what its bytes are spent on.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct LayerDissection {
	pub name: String,
	/// `None` where the tile leaves it out, which the spec does not allow.
	pub extent: Option<u32>,
	pub version: Option<u32>,
	pub features: u32,
	pub vertices: u32,
	/// The layer's encoded size, and its parts - which add up to it with `other_bytes`.
	pub bytes: u32,
	pub geometry_bytes: u32,
	pub tag_bytes: u32,
	pub key_bytes: u32,
	pub value_bytes: u32,
	pub id_bytes: u32,
	pub other_bytes: u32,
	/// Its keys, the costliest first.
	pub attributes: Vec<AttributeDissection>,
}

/// One property key of a layer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct AttributeDissection {
	pub key: String,
	/// Features carrying it.
	pub features: u32,
	/// Distinct values it takes.
	pub distinct: u32,
	/// What it costs: the key, each feature's reference to it, and its distinct values. A value two
	/// keys share is counted under both - the table is a question about each key, not a partition.
	pub bytes: u32,
}

/// One feature, with its geometry as it was encoded.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct FeatureDissection {
	/// Which layer, by position in `layers`.
	pub layer: u32,
	/// Its position within that layer - what an issue's `feature` refers to.
	pub index: u32,
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
	pub id: Option<u64>,
	/// `point`, `line`, `polygon` or `unknown`, as declared.
	pub kind: String,
	pub vertices: u32,
	pub geometry_bytes: u32,
	/// Opaque JSON: whatever the tile holds.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Any))]
	pub properties: serde_json::Value,
	/// The command stream's parts: a point, a line, or a ring each.
	pub parts: Vec<Part>,
	/// Whether the command stream stopped making sense before it ended.
	pub malformed: bool,
}

/// One part of a feature's geometry, in tile coordinates.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Part {
	pub points: Vec<[i32; 2]>,
	/// Whether it ended with ClosePath - a ring.
	pub closed: bool,
	/// A ring's signed area in tile coordinates, y down: positive for an outer ring, negative for a
	/// hole, nought for one that encloses nothing. Nought for a part that is not a ring.
	pub area: f64,
}

/// A spec violation in this tile.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct TileIssue {
	pub layer: String,
	/// The feature it is about, by position in its layer; `None` for a layer-wide one.
	pub feature: Option<u32>,
	/// Upstream's name for it, as the Analysis pane's checks carry it.
	pub kind: String,
	/// The same in a sentence.
	pub label: String,
}

/// What a repair would leave.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct RepairPreview {
	/// The repaired tile's decompressed size.
	pub raw_bytes: u32,
	/// Violations left after it - the ones only dropping the offending feature would fix.
	pub issues_left: u32,
}

/// Takes the tile at `z/x/y` of `source` apart, or `None` where the source has no tile.
pub async fn dissect(source: &dyn TileSource, z: u8, x: u32, y: u32) -> Result<Option<Dissection>> {
	let coord = TileCoord::new(z, x, y).context("building the tile coordinate")?;
	let Some(mut tile) = source.tile(&coord).await.context("reading the tile")? else {
		return Ok(None);
	};
	let compression = *source.metadata().tile_compression();
	let format = *source.metadata().tile_format();
	let stored_bytes = clamp(tile.as_blob(&compression).context("reading the stored tile")?.len());
	let raw_bytes = clamp(
		tile
			.as_blob(&TileCompression::Uncompressed)
			.context("decompressing the tile")?
			.len(),
	);

	let mut found = Dissection {
		z,
		x,
		y,
		format: format.to_string(),
		compression: compression.to_string(),
		stored_bytes,
		raw_bytes,
		layers: Vec::new(),
		features: Vec::new(),
		every: 1,
		issues: Vec::new(),
		repair: None,
		raster: None,
	};
	if !format.is_vector() {
		let schema = source.tilejson().tile_schema.clone();
		let stored = tile.as_blob(&TileCompression::Uncompressed)?.as_slice().to_vec();
		let mut pixels = raster(tile.as_image().context("decoding the image")?, schema.as_ref())?;
		pixels.checks = checks(&pixels, format, &stored);
		found.raster = Some(pixels);
		return Ok(Some(found));
	}

	let vector = tile.as_vector().context("decoding the vector tile")?.clone();
	found.layers = layers(&vector)?;
	(found.features, found.every) = features(&vector);
	found.issues = validate_tile(&vector)
		.into_iter()
		.map(|issue| TileIssue {
			layer: issue.layer,
			feature: issue.feature_index.map(clamp),
			kind: describe_issue_kind(&issue.kind),
			label: crate::checks::label(&issue.kind),
		})
		.collect();
	if !found.issues.is_empty() {
		let repaired = repair_tile(vector, false).context("repairing the tile")?;
		found.repair = Some(RepairPreview {
			raw_bytes: clamp(repaired.to_blob().context("encoding the repaired tile")?.len()),
			issues_left: clamp(validate_tile(&repaired).len()),
		});
	}
	Ok(Some(found))
}

/// What a decoded raster tile holds, and what it says in metres if `schema` is a DEM we can read.
fn raster(image: &DynamicImage, schema: Option<&TileSchema>) -> Result<RasterDissection> {
	let color = image.color();
	let alpha = color.has_alpha();
	let channels = match (color.channel_count(), alpha) {
		(1, _) => "grey",
		(2, _) => "grey + alpha",
		(3, _) => "RGB",
		_ => "RGBA",
	};

	let mut transparent = 0u32;
	let mut translucent = 0u32;
	let mut colours: HashSet<u32> = HashSet::new();
	let decode = decoder(schema).filter(|_| color.channel_count() >= 3);
	let (mut low, mut high, mut sum, mut heights) = (f64::INFINITY, f64::NEG_INFINITY, 0.0, 0u32);
	for pixel in image.iter_pixels() {
		if let Some((_, decode)) = decode
			&& !(alpha && pixel[3] == 0)
		{
			let metres = decode([pixel[0], pixel[1], pixel[2]]);
			(low, high, sum, heights) = (low.min(metres), high.max(metres), sum + metres, heights + 1);
		}
		if alpha {
			match pixel.last().copied().unwrap_or(255) {
				0 => transparent += 1,
				255 => {}
				_ => translucent += 1,
			}
		}
		if colours.len() < MAX_COLOURS {
			// Packed into one number: four channels at most, a byte each.
			colours.insert(
				pixel
					.iter()
					.fold(0u32, |packed, &channel| (packed << 8) | u32::from(channel)),
			);
		}
	}

	let png = image
		.to_blob(TileFormat::PNG, None, None)
		.context("encoding the pixels as PNG")?;
	Ok(RasterDissection {
		width: image.width(),
		height: image.height(),
		channels: channels.to_string(),
		alpha,
		transparent,
		translucent,
		colours: clamp(colours.len()),
		colours_capped: colours.len() >= MAX_COLOURS,
		image: format!("data:image/png;base64,{}", STANDARD.encode(png.as_slice())),
		schema: schema.map(|schema| schema.as_str().to_string()),
		checks: Vec::new(),
		elevation: decode.filter(|_| heights > 0).map(|(encoding, _)| Elevation {
			encoding: encoding.to_string(),
			min: low,
			max: high,
			mean: sum / f64::from(heights),
		}),
	})
}

/// One tile in brief: what the map's popup says about the tile under a click (S14.6, A8).
///
/// The dialog's answer without the geometry, which is most of its weight - a popup that names the
/// tile and its heaviest layers has no use for five thousand features as JSON.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct TileSummary {
	pub z: u8,
	pub x: u32,
	pub y: u32,
	/// Bytes as stored, which is what crosses the wire.
	pub stored_bytes: u32,
	/// Bytes decompressed - the same as stored for a tile that is not compressed.
	pub raw_bytes: u32,
	/// Its layers, the heaviest first; none for a raster tile.
	pub layers: Vec<LayerSummary>,
}

/// One layer of a [`TileSummary`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct LayerSummary {
	pub name: String,
	pub features: u32,
	/// The layer's encoded size, uncompressed.
	pub bytes: u32,
}

/// The tile at `z/x/y` of `source` in brief, or `None` where the source has no tile.
pub async fn summarise(source: &dyn TileSource, z: u8, x: u32, y: u32) -> Result<Option<TileSummary>> {
	let coord = TileCoord::new(z, x, y).context("building the tile coordinate")?;
	let Some(mut tile) = source.tile(&coord).await.context("reading the tile")? else {
		return Ok(None);
	};
	let compression = *source.metadata().tile_compression();
	let stored_bytes = clamp(tile.as_blob(&compression).context("reading the stored tile")?.len());
	let raw_bytes = clamp(
		tile
			.as_blob(&TileCompression::Uncompressed)
			.context("decompressing the tile")?
			.len(),
	);
	let mut layers = Vec::new();
	if source.metadata().tile_format().is_vector() {
		let vector = tile.as_vector().context("decoding the vector tile")?;
		let stats = layer_stats(vector).context("measuring the layers")?;
		layers = vector
			.layers
			.iter()
			.zip(stats)
			.map(|(layer, stats)| LayerSummary {
				name: layer.name.clone(),
				features: clamp(stats.feature_count),
				bytes: clamp(stats.encoded_bytes),
			})
			.collect();
		layers.sort_by_key(|layer| std::cmp::Reverse(layer.bytes));
	}
	Ok(Some(TileSummary {
		z,
		x,
		y,
		stored_bytes,
		raw_bytes,
		layers,
	}))
}

/// Each layer's byte split, from upstream's own measurement, and its attributes.
///
/// Measured as MVT whatever the tile is stored as: upstream decodes MLT through MVT, and has no split
/// of MLT's own columns to report. For an MLT tile these are what the layers would cost as MVT, so
/// they compare with each other rather than adding up to `raw_bytes`.
fn layers(vector: &VectorTile) -> Result<Vec<LayerDissection>> {
	let stats = layer_stats(vector).context("measuring the layers")?;
	Ok(vector
		.layers
		.iter()
		.zip(stats)
		.map(|(layer, stats)| LayerDissection {
			name: layer.name.clone(),
			extent: layer.extent,
			version: layer.version,
			features: clamp(stats.feature_count),
			vertices: clamp(stats.vertex_count),
			bytes: clamp(stats.encoded_bytes),
			geometry_bytes: clamp(stats.geometry_bytes),
			tag_bytes: clamp(stats.tag_bytes),
			key_bytes: clamp(stats.key_bytes),
			value_bytes: clamp(stats.value_bytes),
			id_bytes: clamp(stats.id_bytes),
			other_bytes: clamp(stats.other_bytes()),
			attributes: attributes(layer),
		})
		.collect())
}

/// What each key of a layer costs.
fn attributes(layer: &VectorTileLayer) -> Vec<AttributeDissection> {
	#[derive(Default)]
	struct Tally {
		features: u32,
		values: HashSet<u32>,
		tag_bytes: usize,
	}
	let mut by_key: HashMap<u32, Tally> = HashMap::new();
	for feature in &layer.features {
		for [key, value] in feature.tag_ids.as_chunks::<2>().0 {
			let tally = by_key.entry(*key).or_default();
			tally.features += 1;
			tally.values.insert(*value);
			tally.tag_bytes += varint_len(u64::from(*key)) + varint_len(u64::from(*value));
		}
	}
	let mut found: Vec<AttributeDissection> = by_key
		.into_iter()
		.filter_map(|(key, tally)| {
			let name = layer.property_manager.key.get(key).ok()?.clone();
			let values: usize = tally
				.values
				.iter()
				.filter_map(|value| layer.property_manager.val.get(*value).ok())
				.map(|value| GeoValuePBF::to_blob(value).map_or(0, |blob| blob.len() as usize))
				.sum();
			Some(AttributeDissection {
				bytes: clamp(name.len() + tally.tag_bytes + values),
				key: name,
				features: tally.features,
				distinct: clamp(tally.values.len()),
			})
		})
		.collect();
	found.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.key.cmp(&b.key)));
	found
}

/// The features with their geometry - every one, or every n-th of each layer when all of them would
/// pass a cap - and that n.
fn features(vector: &VectorTile) -> (Vec<FeatureDissection>, u32) {
	let read: Vec<Vec<(Vec<Part>, bool)>> = vector
		.layers
		.iter()
		.map(|layer| {
			layer
				.features
				.iter()
				.map(|feature| read_parts(feature.geom_data.as_slice()))
				.collect()
		})
		.collect();
	let count = |parts: &[Part]| -> usize { parts.iter().map(|part| part.points.len()).sum() };
	let features: usize = read.iter().map(Vec::len).sum();
	let vertices: usize = read.iter().flatten().map(|(parts, _)| count(parts)).sum();
	let every = features
		.div_ceil(MAX_FEATURES)
		.max(vertices.div_ceil(MAX_VERTICES))
		.max(1);

	let mut found = Vec::new();
	for (layer_index, (layer, parts)) in vector.layers.iter().zip(read).enumerate() {
		for (index, (feature, (parts, malformed))) in layer.features.iter().zip(parts).enumerate() {
			if index % every != 0 {
				continue;
			}
			found.push(FeatureDissection {
				layer: clamp(layer_index),
				index: clamp(index),
				id: feature.id,
				kind: kind_of(&feature.geom_type).to_string(),
				vertices: clamp(count(&parts)),
				geometry_bytes: clamp(feature.geom_data.len()),
				properties: properties(layer, &feature.tag_ids),
				parts,
				malformed,
			});
		}
	}
	(found, clamp(every))
}

fn kind_of(kind: &GeomType) -> &'static str {
	match kind {
		GeomType::Unknown => "unknown",
		GeomType::MultiPoint => "point",
		GeomType::MultiLineString => "line",
		GeomType::MultiPolygon => "polygon",
	}
}

/// A feature's properties as JSON, or an empty object when they will not decode.
fn properties(layer: &VectorTileLayer, tag_ids: &[u32]) -> serde_json::Value {
	let Ok(decoded) = layer.decode_tag_ids(tag_ids) else {
		return serde_json::Value::Object(serde_json::Map::new());
	};
	decoded
		.0
		.into_iter()
		.map(|(key, value)| (key, json_of(value)))
		.collect::<serde_json::Map<_, _>>()
		.into()
}

fn json_of(value: GeoValue) -> serde_json::Value {
	match value {
		GeoValue::Bool(b) => b.into(),
		GeoValue::Double(n) => n.into(),
		GeoValue::Float(n) => f64::from(n).into(),
		GeoValue::Int(n) => n.into(),
		GeoValue::UInt(n) => n.into(),
		GeoValue::Null => serde_json::Value::Null,
		GeoValue::String(s) => s.into(),
	}
}

/// Reads an MVT command stream into its parts, as written (MVT 2.1 §4.3).
///
/// Returns what it read and whether it had to stop early: a malformed stream is something to show,
/// not a reason to show nothing.
fn read_parts(bytes: &[u8]) -> (Vec<Part>, bool) {
	let mut reader = Varints { bytes, at: 0 };
	let mut parts: Vec<Part> = Vec::new();
	let (mut x, mut y) = (0i64, 0i64);
	let mut step = |reader: &mut Varints<'_>| -> Option<[i32; 2]> {
		x += zigzag(reader.next()?);
		y += zigzag(reader.next()?);
		Some([i32::try_from(x).ok()?, i32::try_from(y).ok()?])
	};
	while reader.at < bytes.len() {
		let Some(command) = reader.next() else {
			return (parts, true);
		};
		let (id, count) = (command & 7, command >> 3);
		match id {
			1 => {
				for _ in 0..count {
					let Some(point) = step(&mut reader) else {
						return (parts, true);
					};
					parts.push(Part {
						points: vec![point],
						closed: false,
						area: 0.0,
					});
				}
			}
			2 => {
				let Some(part) = parts.last_mut() else {
					return (parts, true);
				};
				for _ in 0..count {
					let Some(point) = step(&mut reader) else {
						return (parts, true);
					};
					part.points.push(point);
				}
			}
			7 => {
				let Some(part) = parts.last_mut() else {
					return (parts, true);
				};
				part.closed = true;
				part.area = signed_area(&part.points);
			}
			_ => return (parts, true),
		}
	}
	(parts, false)
}

/// The shoelace formula in tile coordinates, where y points down - so an outer ring, clockwise on
/// screen, comes out positive, as MVT 2.1 §4.3.4.4 defines it.
fn signed_area(points: &[[i32; 2]]) -> f64 {
	let twice: i64 = points
		.iter()
		.zip(points.iter().cycle().skip(1))
		.map(|(a, b)| i64::from(a[0]) * i64::from(b[1]) - i64::from(b[0]) * i64::from(a[1]))
		.sum();
	#[expect(
		clippy::cast_precision_loss,
		reason = "a ring's area within one tile fits an f64 exactly"
	)]
	let area = twice as f64 / 2.0;
	area
}

fn zigzag(n: u64) -> i64 {
	#[expect(clippy::cast_possible_wrap, reason = "zigzag decoding is defined on the bit pattern")]
	let value = (n >> 1) as i64 ^ -((n & 1) as i64);
	value
}

/// Protobuf varints, one after another.
struct Varints<'a> {
	bytes: &'a [u8],
	at: usize,
}

impl Varints<'_> {
	fn next(&mut self) -> Option<u64> {
		let mut value = 0u64;
		for shift in (0..64).step_by(7) {
			let byte = *self.bytes.get(self.at)?;
			self.at += 1;
			value |= u64::from(byte & 0x7f) << shift;
			if byte & 0x80 == 0 {
				return Some(value);
			}
		}
		None
	}
}

/// A count as the webview's `number` takes it. No tile has four billion of anything.
fn clamp<T: TryInto<u32>>(value: T) -> u32 {
	value.try_into().unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
	use super::*;
	use geo_types::{Geometry, LineString, Polygon, coord};
	use versatiles_container::Tile;
	use versatiles_core::TileFormat;
	use versatiles_geometry::geo::GeoFeature;

	fn feature(id: u64, geometry: Geometry<f64>, props: &[(&str, GeoValue)]) -> GeoFeature {
		GeoFeature {
			id: Some(GeoValue::from(id)),
			geometry,
			properties: props.iter().map(|(k, v)| ((*k).to_string(), v.clone())).collect(),
		}
	}

	fn square(at: f64, size: f64) -> Geometry<f64> {
		Geometry::Polygon(Polygon::new(
			LineString::from(vec![
				(at, at),
				(at + size, at),
				(at + size, at + size),
				(at, at + size),
				(at, at),
			]),
			vec![],
		))
	}

	#[test]
	fn reads_a_command_stream_into_its_parts() {
		// MoveTo(2,2) LineTo(+3,0)(0,+3) ClosePath - a triangle, wound clockwise on screen.
		let stream = [9, 4, 4, 18, 6, 0, 0, 6, 15];
		let (parts, malformed) = read_parts(&stream);
		assert!(!malformed);
		assert_eq!(parts.len(), 1);
		assert_eq!(parts[0].points, [[2, 2], [5, 2], [5, 5]]);
		assert!(parts[0].closed);
		assert!(parts[0].area > 0.0, "clockwise on screen is an outer ring");
	}

	#[test]
	fn keeps_what_it_read_of_a_broken_stream() {
		// MoveTo(1,1), then a LineTo of two points with only one there.
		let (parts, malformed) = read_parts(&[9, 2, 2, 18, 2, 2]);
		assert!(malformed);
		assert_eq!(parts[0].points, [[1, 1], [2, 2]]);
	}

	#[test]
	fn a_ring_wound_the_other_way_has_a_negative_area() {
		assert!(signed_area(&[[0, 0], [0, 4], [4, 4], [4, 0]]) < 0.0);
		assert_eq!(signed_area(&[[0, 0], [2, 2], [4, 4]]), 0.0);
	}

	#[test]
	fn costs_each_key_by_what_it_takes() -> Result<()> {
		let layer = VectorTileLayer::from_features(
			"poi".to_string(),
			vec![
				feature(
					1,
					square(0.0, 10.0),
					&[("name", GeoValue::from("a long name")), ("kind", GeoValue::from("x"))],
				),
				feature(2, square(20.0, 10.0), &[("kind", GeoValue::from("x"))]),
			],
			4096,
			2,
		)?;
		let found = attributes(&layer);
		let kind = found.iter().find(|a| a.key == "kind").unwrap();
		assert_eq!((kind.features, kind.distinct), (2, 1));
		assert_eq!(found[0].key, "name", "the costliest first");
		Ok(())
	}

	#[test]
	fn lists_every_feature_with_where_it_sits() -> Result<()> {
		let a = VectorTileLayer::from_features("a".to_string(), vec![feature(7, square(0.0, 10.0), &[])], 4096, 2)?;
		let b = VectorTileLayer::from_features(
			"b".to_string(),
			vec![feature(
				8,
				Geometry::LineString(LineString::new(vec![
					coord! { x: 0.0, y: 0.0 },
					coord! { x: 5.0, y: 5.0 },
				])),
				&[],
			)],
			4096,
			2,
		)?;
		let (found, every) = features(&VectorTile::new(vec![a, b]));
		assert_eq!(every, 1);
		let summary: Vec<_> = found
			.iter()
			.map(|f| (f.layer, f.index, f.id, f.kind.as_str()))
			.collect();
		assert_eq!(summary, [(0, 0, Some(7), "polygon"), (1, 0, Some(8), "line")]);
		Ok(())
	}

	/// Past the cap, every n-th of each layer: a layer stored west to east is still drawn across the
	/// whole tile, and the layers after it are still drawn at all. Cutting off after the first so
	/// many drew one layer, two thirds wide.
	#[test]
	fn past_the_cap_takes_every_nth_of_every_layer() -> Result<()> {
		let span = 4095.0 / MAX_FEATURES as f64;
		let west_to_east: Vec<_> = (0..MAX_FEATURES as u64)
			.map(|i| feature(i, Geometry::Point(geo_types::Point::new(i as f64 * span, 1.0)), &[]))
			.collect();
		let later: Vec<_> = (0..10).map(|i| feature(i, square(10.0, 5.0), &[])).collect();
		let tile = VectorTile::new(vec![
			VectorTileLayer::from_features("addresses".to_string(), west_to_east, 4096, 2)?,
			VectorTileLayer::from_features("buildings".to_string(), later, 4096, 2)?,
		]);
		let (found, every) = features(&tile);
		assert_eq!(every, 2);
		assert!(found.len() <= MAX_FEATURES);
		let east = found
			.iter()
			.filter(|f| f.layer == 0)
			.flat_map(|f| f.parts.iter().map(|part| part.points[0][0]))
			.max();
		assert!(east > Some(4000), "drawn as far east as {east:?}");
		assert_eq!(found.iter().filter(|f| f.layer == 1).count(), 5);
		Ok(())
	}

	/// **An MLT tile comes apart like any other**, because upstream decodes it into the same model.
	#[test]
	fn takes_an_mlt_tile_apart() -> Result<()> {
		let layer = VectorTileLayer::from_features(
			"buildings".to_string(),
			vec![feature(7, square(0.0, 10.0), &[])],
			4096,
			2,
		)?;
		let blob = VectorTile::new(vec![layer]).to_mlt_blob()?;
		let mut tile = Tile::from_blob(blob, TileCompression::Uncompressed, TileFormat::MLT);

		let vector = tile.as_vector()?;
		assert_eq!(layers(vector)?[0].name, "buildings");
		assert_eq!(features(vector).0.len(), 1);
		Ok(())
	}

	/// The real thing, when this machine has the sample containers.
	#[tokio::test]
	async fn takes_a_real_tile_apart() -> Result<()> {
		let Some(path) = crate::analysis::tests::sample_container("berlin.mbtiles") else {
			eprintln!("skipping: no sample containers here");
			return Ok(());
		};
		let runtime = versatiles::runtime::create_runtime();
		let source = runtime.reader_from_str(&path.to_string_lossy()).await?;
		let found = dissect(source.as_ref(), 14, 8800, 5373)
			.await?
			.expect("a tile in the middle of Berlin");
		assert_eq!(found.format, "mvt");
		assert!(found.stored_bytes > 0 && found.raw_bytes >= found.stored_bytes);
		assert!(!found.layers.is_empty());
		let total: u32 = found.layers.iter().map(|layer| layer.features).sum();
		assert!(found.every > 1 || found.features.len() as u32 == total);
		assert!(dissect(source.as_ref(), 14, 0, 0).await?.is_none());

		let brief = summarise(source.as_ref(), 14, 8800, 5373)
			.await?
			.expect("the same tile");
		assert_eq!(
			(brief.stored_bytes, brief.raw_bytes),
			(found.stored_bytes, found.raw_bytes)
		);
		assert!(brief.raw_bytes > brief.stored_bytes, "berlin's tiles are compressed");
		assert!(
			brief.layers.windows(2).all(|w| w[0].bytes >= w[1].bytes),
			"the heaviest first"
		);
		Ok(())
	}

	/// What a raster tile's pixels add up to: transparency counted per kind, colours with alpha.
	#[test]
	fn counts_what_a_raster_tile_holds() -> Result<()> {
		// Opaque red, nothing, half-transparent red, opaque red again.
		let pixels = vec![255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 128, 255, 0, 0, 255];
		let found = raster(&DynamicImage::from_raw(2, 2, pixels)?, None)?;
		assert_eq!((found.width, found.height), (2, 2));
		assert_eq!((found.channels.as_str(), found.alpha), ("RGBA", true));
		assert_eq!((found.transparent, found.translucent), (1, 1));
		assert_eq!((found.colours, found.colours_capped), (3, false));

		let opaque = raster(&DynamicImage::from_raw(1, 2, vec![10, 20, 30, 10, 20, 30])?, None)?;
		assert_eq!((opaque.channels.as_str(), opaque.alpha), ("RGB", false));
		assert_eq!((opaque.transparent, opaque.translucent, opaque.colours), (0, 0, 1));
		Ok(())
	}

	/// A DEM tile's heights, by upstream's formulas: Terrarium's (128, 0, 0) is 0 m and
	/// (131, 232, 0) is 1000 m; Mapbox's (1, 134, 160) is 0 m.
	#[test]
	fn reads_the_heights_a_dem_tile_encodes() -> Result<()> {
		let terrarium = DynamicImage::from_raw(2, 1, vec![128, 0, 0, 131, 232, 0])?;
		let found = raster(&terrarium, Some(&TileSchema::RasterDEMTerrarium))?
			.elevation
			.expect("a Terrarium tile has heights");
		assert_eq!(found.encoding, "terrarium");
		assert_eq!((found.min, found.max, found.mean), (0.0, 1000.0, 500.0));

		let mapbox = DynamicImage::from_raw(1, 1, vec![1, 134, 160])?;
		let found = raster(&mapbox, Some(&TileSchema::RasterDEMMapbox))?.elevation.unwrap();
		assert_eq!((found.encoding.as_str(), found.min), ("mapbox", 0.0));
		Ok(())
	}

	/// A fully transparent pixel is no data: its colour says nothing about the height there.
	#[test]
	fn leaves_no_data_out_of_the_heights() -> Result<()> {
		let pixels = vec![128, 0, 0, 255, 255, 255, 255, 0];
		let image = DynamicImage::from_raw(2, 1, pixels)?;
		let found = raster(&image, Some(&TileSchema::RasterDEMTerrarium))?
			.elevation
			.unwrap();
		assert_eq!((found.min, found.max), (0.0, 0.0));

		let nothing = DynamicImage::from_raw(1, 1, vec![0, 0, 0, 0])?;
		assert!(
			raster(&nothing, Some(&TileSchema::RasterDEMTerrarium))?
				.elevation
				.is_none()
		);
		Ok(())
	}

	/// Imagery has no heights, and `dem/versatiles` none that anything here can read - but both
	/// say what they are.
	#[test]
	fn reads_heights_only_from_an_encoding_it_knows() -> Result<()> {
		let image = DynamicImage::from_raw(1, 1, vec![128, 0, 0])?;
		let imagery = raster(&image, Some(&TileSchema::RasterRGB))?;
		assert_eq!(
			(imagery.schema.as_deref(), imagery.elevation.is_none()),
			(Some("rgb"), true)
		);
		let own = raster(&image, Some(&TileSchema::RasterDEMVersatiles))?;
		assert_eq!(
			(own.schema.as_deref(), own.elevation.is_none()),
			(Some("dem/versatiles"), true)
		);
		assert!(raster(&image, None)?.schema.is_none());
		Ok(())
	}

	/// A WebP file's first image chunk says which it is; an extended file has others before it.
	#[test]
	fn tells_lossy_webp_from_lossless() -> Result<()> {
		let file = |chunks: &[u8]| [b"RIFF".as_slice(), &[0; 4], b"WEBP", chunks].concat();
		assert_eq!(webp_is_lossy(&file(b"VP8 \x00\x00\x00\x00")), Some(true));
		assert_eq!(webp_is_lossy(&file(b"VP8L\x00\x00\x00\x00")), Some(false));
		// VP8X (10 bytes), then ALPH of 3 bytes padded to 4, then the image.
		let extended = [
			b"VP8X\x0a\x00\x00\x00".as_slice(),
			&[0; 10],
			b"ALPH\x03\x00\x00\x00",
			&[0; 4],
			b"VP8 \x00\x00\x00\x00",
		]
		.concat();
		assert_eq!(webp_is_lossy(&file(&extended)), Some(true));
		assert_eq!(webp_is_lossy(b"not a webp file"), None);

		// And a real one, from upstream's own encoder at a lossy quality.
		let image = DynamicImage::from_raw(8, 8, vec![90; 8 * 8 * 3])?;
		let lossy = image.to_blob(TileFormat::WEBP, Some(80), None)?;
		assert_eq!(webp_is_lossy(lossy.as_slice()), Some(true));
		Ok(())
	}

	fn checked(pixels: Vec<u8>, width: u32, schema: Option<TileSchema>, format: TileFormat) -> Result<Vec<String>> {
		let image = DynamicImage::from_raw(width as usize, 1, pixels)?;
		let found = raster(&image, schema.as_ref())?;
		let stored = image.to_blob(format, Some(80), None)?;
		Ok(checks(&found, format, stored.as_slice())
			.into_iter()
			.map(|check| check.kind)
			.collect())
	}

	/// The one that is a data error: a DEM in a lossy format has had its terrain changed.
	#[test]
	fn says_when_heights_are_stored_lossy() -> Result<()> {
		let dem = Some(TileSchema::RasterDEMTerrarium);
		let heights = vec![128, 0, 0, 131, 232, 0];
		assert_eq!(
			checked(heights.clone(), 2, dem.clone(), TileFormat::JPG)?,
			["lossy_dem"]
		);
		assert_eq!(
			checked(heights.clone(), 2, dem.clone(), TileFormat::WEBP)?,
			["lossy_dem"]
		);
		assert!(checked(heights.clone(), 2, dem, TileFormat::PNG)?.is_empty());
		// Imagery may well be JPEG: that is a choice, not a mistake.
		assert!(checked(heights, 2, Some(TileSchema::RasterRGB), TileFormat::JPG)?.is_empty());
		Ok(())
	}

	#[test]
	fn says_what_only_costs_bytes() -> Result<()> {
		// Opaque everywhere, but stored with alpha.
		let opaque = vec![10, 20, 30, 255, 40, 50, 60, 255];
		assert_eq!(checked(opaque, 2, None, TileFormat::PNG)?, ["unused_alpha"]);
		// Nothing to see at all - and not also "one colour", which would say the same twice.
		let empty = vec![0, 0, 0, 0, 0, 0, 0, 0];
		assert_eq!(checked(empty, 2, None, TileFormat::PNG)?, ["transparent"]);
		// One colour, opaque, without alpha.
		assert_eq!(
			checked(vec![7, 7, 7, 7, 7, 7], 2, None, TileFormat::PNG)?,
			["one_colour"]
		);
		// Two colours and part transparent: nothing to say.
		assert!(checked(vec![10, 20, 30, 255, 0, 0, 0, 0], 2, None, TileFormat::PNG)?.is_empty());
		Ok(())
	}

	/// The dialog draws and reads the pixels it is sent, so they have to be the tile's, exactly.
	#[test]
	fn sends_the_pixels_losslessly() -> Result<()> {
		let pixels: Vec<u8> = (0..16u8 * 4).map(|i| i.wrapping_mul(37)).collect();
		let image = DynamicImage::from_raw(4, 4, pixels.clone())?;
		let url = raster(&image, None)?.image;
		let encoded = url.strip_prefix("data:image/png;base64,").expect("a PNG data URL");
		let blob = versatiles_core::Blob::from(STANDARD.decode(encoded)?);
		let back = DynamicImage::from_blob(&blob, TileFormat::PNG)?;
		assert_eq!(back.iter_pixels().flatten().copied().collect::<Vec<u8>>(), pixels);
		Ok(())
	}

	/// A raster pipeline's tile, end to end: sizes as before, and now the pixels too.
	#[tokio::test]
	async fn takes_a_raster_tile_apart() -> Result<()> {
		let runtime = versatiles::runtime::create_test_runtime();
		let pipeline = crate::vpl::Document::parse("from_debug format=png")?.to_pipeline();
		let source = crate::preview::build(&runtime, pipeline, std::path::Path::new(".")).await?;
		let found = dissect(source.as_ref(), 3, 2, 5).await?.expect("a debug tile");
		assert!(found.layers.is_empty() && found.features.is_empty());
		let raster = found.raster.expect("a raster tile has its pixels taken apart");
		assert!(raster.width > 0 && raster.width == raster.height);
		assert!(raster.image.starts_with("data:image/png;base64,"));
		Ok(())
	}
}
