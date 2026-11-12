//! What a source's vector tiles are made of, layer by layer (S14.7, B2, [Q72]).
//!
//! **Sampled by default.** Sizes come from an index; contents come from decoding tiles, which is a
//! hundred times the work - a planet at zoom 14 is minutes of every core. So a scan reads windows of
//! tiles, the same windows upstream's `versatiles probe --sample` reads ([`build_scan_plan`]), sized
//! so the deepest level gives about [`BUDGET`] tiles; a full scan is the caller's to ask for. Every
//! level says how many it read of how many it holds, so a sampled answer never passes for a census.
//!
//! **Studio's own loop over upstream's pieces**, rather than `probe_report` at `TileContents` depth:
//! that one walks every tile's size first, which here is the Measure button's job, and it cannot be
//! told how far it has got in a way the job bar shows.
//!
//! **Bytes are decoded bytes**, which is what a layer's share means - compression works on the tile,
//! not per layer, so there is no stored size of a layer to report.
//!
//! **And checked, in the same pass** (S14.8): a tile decoded for its layers is a tile validated for
//! nothing more than the walk over its features - see [`checks`].
//!
//! [Q72]: ../../../docs/decisions.md

use crate::checks::{self, Checks, Tally};
use anyhow::{Context, Result};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use versatiles_container::{Tile, TileSource, sampling::build_scan_plan};
use versatiles_geometry::geo::GeoValue;
use versatiles_geometry::vector_tile::{LayerStats, ValidationIssue, layer_stats, validate_tile};

/// About how many tiles of the deepest level a sampled scan reads.
pub const BUDGET: u64 = 8192;

/// What a source's vector tiles hold.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Contents {
	/// Whether only some tiles were read.
	pub sampled: bool,
	/// Tiles read, over every level.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub read: u64,
	/// Tiles that would not decode as vector tiles.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub undecodable: u64,
	/// One entry per level that holds a tile, ascending.
	pub levels: Vec<LevelContents>,
	/// What the tiles read and the TileJSON get wrong (S14.8).
	pub checks: Checks,
	/// Each layer's properties over the tiles read, by layer name - what an expression can ask
	/// about, and the values it is likely to compare them with.
	pub properties: Vec<LayerProperties>,
}

/// One layer's properties, the commonest first.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct LayerProperties {
	pub layer: String,
	pub keys: Vec<PropertyValues>,
}

/// One property of one layer, and what it holds.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct PropertyValues {
	pub key: String,
	/// Features read that carry it.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub features: u64,
	/// Its commonest values, at most [`TOP_VALUES`], the commonest first.
	pub values: Vec<ValueCount>,
	/// Whether it holds values beyond those - more than [`TRACKED_VALUES`] different ones, so the
	/// list is the commonest of the first ones met rather than of all of them.
	pub more: bool,
}

/// One value and how many features hold it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct ValueCount {
	/// **As an expression writes it** - `'primary'`, `14`, `2.5`, `true` - so what is offered is
	/// what is inserted, and a string with a quote in it arrives escaped.
	pub literal: String,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub count: u64,
}

/// How many values of one property are reported.
pub const TOP_VALUES: usize = 20;

/// How many different values of one property are counted. A name or an id has as many values as
/// features, and counting all of them would hold a planet's names in memory to offer twenty.
pub const TRACKED_VALUES: usize = 256;

/// One property's values while the scan runs.
#[derive(Default)]
struct ValueTally {
	features: u64,
	values: HashMap<String, u64>,
	more: bool,
}

impl ValueTally {
	fn add(&mut self, literal: String, count: u64) {
		self.features += count;
		if let Some(seen) = self.values.get_mut(&literal) {
			*seen += count;
		} else if self.values.len() < TRACKED_VALUES {
			self.values.insert(literal, count);
		} else {
			self.more = true;
		}
	}

	fn finish(self, key: String) -> PropertyValues {
		let mut values: Vec<ValueCount> = self
			.values
			.into_iter()
			.map(|(literal, count)| ValueCount { literal, count })
			.collect();
		values.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.literal.cmp(&b.literal)));
		let more = self.more || values.len() > TOP_VALUES;
		values.truncate(TOP_VALUES);
		PropertyValues {
			key,
			features: self.features,
			values,
			more,
		}
	}
}

/// A value as a CEL literal: a string quoted and escaped, a whole double with its `.0` so it stays
/// a double - CEL does not compare `1` and `1.0` as equal without being told to.
fn literal(value: &GeoValue) -> String {
	let double = |v: f64| {
		if v.is_finite() && v.fract() == 0.0 && v.abs() < 1e15 {
			format!("{v:.1}")
		} else {
			format!("{v}")
		}
	};
	match value {
		GeoValue::String(text) => format!("'{}'", text.replace('\\', "\\\\").replace('\'', "\\'")),
		GeoValue::Bool(flag) => flag.to_string(),
		GeoValue::Int(number) => number.to_string(),
		GeoValue::UInt(number) => number.to_string(),
		GeoValue::Double(number) => double(*number),
		GeoValue::Float(number) => double(f64::from(*number)),
		GeoValue::Null => "null".to_string(),
	}
}

/// One tile's properties, per layer: each key and value as written, with how many features hold it.
type TileProperties = Vec<(String, Vec<(String, String, u64)>)>;

/// Counts a tile's properties by their indices first, so a value shared by every feature of a
/// layer is turned into text once rather than once per feature.
fn tile_properties(vector: &versatiles_geometry::vector_tile::VectorTile) -> TileProperties {
	vector
		.layers
		.iter()
		.map(|layer| {
			let mut pairs: HashMap<(u32, u32), u64> = HashMap::new();
			for feature in &layer.features {
				for [key, value] in feature.tag_ids.as_chunks::<2>().0 {
					*pairs.entry((*key, *value)).or_default() += 1;
				}
			}
			let manager = &layer.property_manager;
			let named = pairs
				.into_iter()
				.filter_map(|((key, value), count)| {
					let key = manager.key.get(key).ok()?.clone();
					let value = manager.val.get(value).ok()?;
					Some((key, literal(value), count))
				})
				.collect();
			(layer.name.clone(), named)
		})
		.collect()
}

/// One level's layers.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct LevelContents {
	pub level: u8,
	/// Tiles the level holds.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub tiles: u64,
	/// Tiles of it that were read.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub read: u64,
	/// Its layers, the heaviest first.
	pub layers: Vec<LayerContents>,
}

/// One layer's features and bytes, summed over the tiles read.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct LayerContents {
	pub name: String,
	/// Tiles read that carry it.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub tiles: u64,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub features: u64,
	/// Its encoded bytes, and their split: geometry, the key and value tables, each feature's tag
	/// references, ids, and the framing - which add up to `bytes`.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub bytes: u64,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub geometry_bytes: u64,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub property_bytes: u64,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub tag_bytes: u64,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub id_bytes: u64,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub other_bytes: u64,
}

impl LayerContents {
	fn from_stats(name: String, tiles: u64, stats: &LayerStats) -> Self {
		let wide = |n: usize| n as u64;
		Self {
			name,
			tiles,
			features: wide(stats.feature_count),
			bytes: wide(stats.encoded_bytes),
			geometry_bytes: wide(stats.geometry_bytes),
			property_bytes: wide(stats.property_bytes()),
			tag_bytes: wide(stats.tag_bytes),
			id_bytes: wide(stats.id_bytes),
			other_bytes: wide(stats.other_bytes()),
		}
	}
}

/// The fraction of the deepest level a sampled scan reads, or `None` to read everything.
fn fraction(full: bool, deepest: u64) -> Option<f64> {
	#[expect(
		clippy::cast_precision_loss,
		reason = "a ratio, where a lost unit in 2^53 does not matter"
	)]
	let share = BUDGET as f64 / deepest.max(1) as f64;
	(!full && share < 1.0).then_some(share)
}

/// Reads `source`'s vector tiles - a sample, unless `full` - and sums what each layer holds per level.
///
/// `progress` hears tiles read against tiles planned. A raster source answers with no levels and
/// without reading anything.
pub async fn scan(source: &dyn TileSource, full: bool, progress: impl Fn(u64, u64)) -> Result<Contents> {
	let mut found = Contents {
		sampled: false,
		read: 0,
		undecodable: 0,
		levels: Vec::new(),
		checks: Checks::default(),
		properties: Vec::new(),
	};
	if !source.metadata().tile_format().is_vector() {
		found.checks = Tally::default().finish(checks::tilejson(source));
		return Ok(found);
	}

	let pyramid = source.tile_pyramid().await.context("reading the tile pyramid")?;
	let held: BTreeMap<u8, u64> = pyramid
		.iter()
		.filter(|cover| !cover.is_empty())
		.map(|cover| (cover.level(), cover.count_tiles()))
		.collect();
	let deepest = held.values().copied().max().unwrap_or(0);
	let sample = fraction(full, deepest);
	let plan = build_scan_plan(pyramid.to_iter_bboxes(), sample).context("planning the sample")?;
	let planned: u64 = plan.iter().map(versatiles_core::TileBBox::count_tiles).sum();
	found.sampled = sample.is_some() && planned < pyramid.count_tiles();

	let mut read: BTreeMap<u8, u64> = BTreeMap::new();
	let mut layers: HashMap<(u8, String), (u64, LayerStats)> = HashMap::new();
	let mut properties: BTreeMap<String, BTreeMap<String, ValueTally>> = BTreeMap::new();
	let mut tally = Tally::default();
	let mut done = 0u64;
	progress(0, planned);
	for bbox in plan {
		let mut stream = source
			.tile_stream(bbox)
			.await
			.with_context(|| format!("reading the tiles at zoom {}", bbox.level()))?
			.map_parallel(|_coord, tile| decode(tile));
		while let Some((coord, decoded)) = stream.next().await {
			done += 1;
			found.read += 1;
			*read.entry(coord.level).or_default() += 1;
			match decoded {
				Some((stats, issues, held)) => {
					tally.add(coord, &issues);
					for layer in stats {
						let entry = layers.entry((coord.level, layer.name.clone())).or_default();
						entry.0 += 1;
						entry.1.add(&layer);
					}
					for (layer, pairs) in held {
						let keys = properties.entry(layer).or_default();
						for (key, literal, count) in pairs {
							keys.entry(key).or_default().add(literal, count);
						}
					}
				}
				None => found.undecodable += 1,
			}
			if done.is_multiple_of(256) {
				progress(done, planned);
			}
		}
	}
	progress(done, planned);
	found.checks = tally.finish(checks::tilejson(source));
	found.properties = properties
		.into_iter()
		.map(|(layer, keys)| {
			let mut keys: Vec<PropertyValues> = keys.into_iter().map(|(key, values)| values.finish(key)).collect();
			keys.sort_by(|a, b| b.features.cmp(&a.features).then_with(|| a.key.cmp(&b.key)));
			LayerProperties { layer, keys }
		})
		.collect();

	let mut by_level: BTreeMap<u8, Vec<LayerContents>> = BTreeMap::new();
	for ((level, name), (tiles, stats)) in layers {
		by_level
			.entry(level)
			.or_default()
			.push(LayerContents::from_stats(name, tiles, &stats));
	}
	found.levels = held
		.into_iter()
		.map(|(level, tiles)| {
			let mut layers = by_level.remove(&level).unwrap_or_default();
			layers.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.name.cmp(&b.name)));
			LevelContents {
				level,
				tiles,
				read: read.get(&level).copied().unwrap_or(0),
				layers,
			}
		})
		.collect();
	Ok(found)
}

/// One tile's layers measured, its violations found and its properties counted, or `None` when
/// it is not a vector tile.
fn decode(mut tile: Tile) -> Option<(Vec<LayerStats>, Vec<ValidationIssue>, TileProperties)> {
	let vector = tile.as_vector().ok()?;
	Some((
		layer_stats(vector).ok()?,
		validate_tile(vector),
		tile_properties(vector),
	))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn samples_a_big_pyramid_and_reads_a_small_one_whole() {
		assert_eq!(fraction(false, 1000), None);
		assert_eq!(fraction(true, 1 << 28), None);
		let share = fraction(false, 1 << 28).expect("a planet at zoom 14 is sampled");
		assert!((share * f64::from(1u32 << 28) - BUDGET as f64).abs() < 1.0);
	}

	/// The real thing, when this machine has the sample containers.
	#[tokio::test]
	async fn scans_a_real_container() -> Result<()> {
		let Some(path) = crate::analysis::tests::sample_container("berlin.mbtiles") else {
			eprintln!("skipping: no sample containers here");
			return Ok(());
		};
		let runtime = versatiles::runtime::create_runtime();
		let source = runtime.reader_from_str(&path.to_string_lossy()).await?;
		let heard = std::sync::Mutex::new(Vec::new());
		let found = scan(source.as_ref(), false, |done, total| {
			heard.lock().unwrap().push((done, total))
		})
		.await?;

		assert!(!found.sampled, "berlin is small enough to read whole");
		assert_eq!(found.undecodable, 0);
		let total: u64 = found.levels.iter().map(|level| level.tiles).sum();
		assert_eq!(found.read, total);
		assert_eq!(heard.lock().unwrap().last(), Some(&(total, total)));

		let deepest = found.levels.last().expect("levels");
		assert!(
			deepest.layers.windows(2).all(|w| w[0].bytes >= w[1].bytes),
			"the heaviest first"
		);
		for layer in &deepest.layers {
			let parts = layer.geometry_bytes + layer.property_bytes + layer.tag_bytes + layer.id_bytes + layer.other_bytes;
			assert_eq!(parts, layer.bytes, "{} adds up", layer.name);
		}

		// Shortbread's streets have a `kind`, and the commonest kinds are among its values.
		let streets = found
			.properties
			.iter()
			.find(|layer| layer.layer == "streets")
			.expect("berlin has streets");
		let kind = streets
			.keys
			.iter()
			.find(|key| key.key == "kind")
			.expect("streets have a kind");
		assert!(kind.features > 0);
		assert!(kind.values.len() <= TOP_VALUES);
		assert!(
			kind.values.windows(2).all(|w| w[0].count >= w[1].count),
			"the commonest first"
		);
		assert!(
			kind.values.iter().all(|value| value.literal.starts_with('\'')),
			"a kind is a string, written as one: {:?}",
			kind.values
		);
		Ok(())
	}

	/// What an expression writes: quoted and escaped strings, doubles that stay doubles.
	#[test]
	fn writes_each_value_as_an_expression_would() {
		assert_eq!(literal(&GeoValue::String("primary".into())), "'primary'");
		assert_eq!(
			literal(&GeoValue::String("O'Brien \\ Co".into())),
			"'O\\'Brien \\\\ Co'"
		);
		assert_eq!(literal(&GeoValue::Int(-3)), "-3");
		assert_eq!(literal(&GeoValue::UInt(14)), "14");
		assert_eq!(literal(&GeoValue::Double(2.0)), "2.0");
		assert_eq!(literal(&GeoValue::Double(2.5)), "2.5");
		assert_eq!(literal(&GeoValue::Bool(true)), "true");
		assert_eq!(literal(&GeoValue::Null), "null");
	}

	/// A name has as many values as features: the tally stops taking new ones, and says so.
	#[test]
	fn counts_a_property_s_values_up_to_a_bound() {
		let mut tally = ValueTally::default();
		for index in 0..(TRACKED_VALUES + 10) {
			tally.add(format!("'{index}'"), 1);
		}
		tally.add("'0'".to_string(), 5);
		let found = tally.finish("name".to_string());

		assert_eq!(found.features, (TRACKED_VALUES + 15) as u64);
		assert!(found.more);
		assert_eq!(found.values.len(), TOP_VALUES);
		assert_eq!(
			found.values[0],
			ValueCount {
				literal: "'0'".to_string(),
				count: 6
			}
		);
	}
	/// The repair the Checks group offers mends what it says it mends.
	#[tokio::test]
	async fn a_repaired_chain_has_nothing_left_to_repair() -> Result<()> {
		let Some(path) = crate::analysis::tests::sample_container("berlin.mbtiles") else {
			return Ok(());
		};
		let runtime = versatiles::runtime::create_runtime();
		let text = format!("from_container filename=\"{}\" | vector_repair", path.display());
		let pipeline = crate::vpl::Document::parse(text)?.to_pipeline();
		let source = crate::preview::build(&runtime, pipeline, std::path::Path::new(".")).await?;
		let found = scan(source.as_ref(), false, |_, _| {}).await?;
		let left: Vec<_> = found
			.checks
			.issues
			.iter()
			.map(|check| (&check.kind, check.count))
			.collect();
		assert!(left.is_empty(), "left after vector_repair: {left:?}");
		Ok(())
	}
}
