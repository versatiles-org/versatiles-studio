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
//! themselves stop at [`MAX_FEATURES`] or [`MAX_VERTICES`], and the answer says it stopped.
//!
//! [Q72]: ../../../docs/decisions.md
//! [Q3]: ../../../docs/decisions.md

use anyhow::{Context, Result};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use versatiles_container::{TileSource, describe_issue_kind};
use versatiles_core::{TileCompression, TileCoord};
use versatiles_geometry::geo::GeoValue;
use versatiles_geometry::vector_tile::{
	GeoValuePBF, GeomType, VectorTile, VectorTileLayer, layer_stats, repair_tile, validate_tile, varint_len,
};

/// The most features a dissection carries geometry for.
pub const MAX_FEATURES: usize = 5_000;

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
	/// Every feature of every layer, in order - up to the cap.
	pub features: Vec<FeatureDissection>,
	/// Whether `features` stopped short of the tile.
	pub truncated: bool,
	pub issues: Vec<TileIssue>,
	/// What `vector_repair` would make of it, when there is anything to repair.
	pub repair: Option<RepairPreview>,
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
	pub kind: String,
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
		truncated: false,
		issues: Vec::new(),
		repair: None,
	};
	if !format.is_vector() {
		return Ok(Some(found));
	}

	let vector = tile.as_vector().context("decoding the vector tile")?.clone();
	found.layers = layers(&vector)?;
	(found.features, found.truncated) = features(&vector);
	found.issues = validate_tile(&vector)
		.into_iter()
		.map(|issue| TileIssue {
			layer: issue.layer,
			feature: issue.feature_index.map(clamp),
			kind: describe_issue_kind(&issue.kind),
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

/// Every feature with its geometry, until the caps; and whether a cap was reached.
fn features(vector: &VectorTile) -> (Vec<FeatureDissection>, bool) {
	let mut found = Vec::new();
	let mut vertices = 0;
	for (layer_index, layer) in vector.layers.iter().enumerate() {
		for (index, feature) in layer.features.iter().enumerate() {
			let (parts, malformed) = read_parts(feature.geom_data.as_slice());
			let count: usize = parts.iter().map(|part| part.points.len()).sum();
			if found.len() == MAX_FEATURES || vertices + count > MAX_VERTICES {
				return (found, true);
			}
			vertices += count;
			found.push(FeatureDissection {
				layer: clamp(layer_index),
				index: clamp(index),
				id: feature.id,
				kind: kind_of(&feature.geom_type).to_string(),
				vertices: clamp(count),
				geometry_bytes: clamp(feature.geom_data.len() as usize),
				properties: properties(layer, &feature.tag_ids),
				parts,
				malformed,
			});
		}
	}
	(found, false)
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
		let (found, truncated) = features(&VectorTile::new(vec![a, b]));
		assert!(!truncated);
		let summary: Vec<_> = found
			.iter()
			.map(|f| (f.layer, f.index, f.id, f.kind.as_str()))
			.collect();
		assert_eq!(summary, [(0, 0, Some(7), "polygon"), (1, 0, Some(8), "line")]);
		Ok(())
	}

	#[test]
	fn stops_at_the_cap_and_says_so() -> Result<()> {
		let many: Vec<_> = (0..(MAX_FEATURES as u64 + 1))
			.map(|i| feature(i, Geometry::Point(geo_types::Point::new(1.0, 1.0)), &[]))
			.collect();
		let layer = VectorTileLayer::from_features("p".to_string(), many, 4096, 2)?;
		let (found, truncated) = features(&VectorTile::new(vec![layer]));
		assert!(truncated);
		assert_eq!(found.len(), MAX_FEATURES);
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
		assert!(found.truncated || found.features.len() as u32 == total);
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
}
