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
//! [Q72]: ../../../docs/decisions.md

use anyhow::{Context, Result};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use versatiles_container::{Tile, TileSource, sampling::build_scan_plan};
use versatiles_geometry::vector_tile::{LayerStats, layer_stats};

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
	};
	if !source.metadata().tile_format().is_vector() {
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
				Some(stats) => {
					for layer in stats {
						let entry = layers.entry((coord.level, layer.name.clone())).or_default();
						entry.0 += 1;
						entry.1.add(&layer);
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

/// One tile's layers measured, or `None` when it is not a vector tile.
fn decode(mut tile: Tile) -> Option<Vec<LayerStats>> {
	let vector = tile.as_vector().ok()?;
	layer_stats(vector).ok()
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
		Ok(())
	}
}
