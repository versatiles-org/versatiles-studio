//! What a source's tiles weigh (S14.1, B1).
//!
//! **Studio's own walk, not `probe_report`'s** ([Q72]). Upstream's size scan keeps a total per level
//! and the ten biggest tiles; the Analysis pane wants percentiles as well, and a percentile needs the
//! distribution rather than the sum. Keeping every size would cost four bytes a tile - a gigabyte for
//! a planet at zoom 14 - so the distribution is a histogram on a log scale instead, sixteen buckets
//! to the doubling. A percentile read off it is within about 4% of the true one, which is closer than
//! anyone reads "38 kB".
//!
//! **Sizes as stored**, compressed if the container compresses. That is what crosses the wire and
//! what a tile budget is about; the byte breakdown is about the decoded tile and says so itself.
//!
//! **Over an index, or not at all, here.** A container answers `tile_size_stream` from its index
//! without reading a tile body, which is what makes a whole-pyramid walk a matter of seconds.
//! [`container_behind`] says when a graph is one: a chain that only reads a container is that
//! container. Anything that transforms tiles has no index - each size would be a tile produced.
//!
//! [Q72]: ../../../docs/decisions.md

use anyhow::{Context, Result};
use serde::Serialize;
use std::path::Path;
use versatiles_container::TileSource;
use versatiles_pipeline::VPLPipeline;

/// How many of the biggest tiles a walk keeps.
///
/// Twice upstream's ten: the list is where a person goes looking for the tile to open, and the
/// tenth-biggest of a large container is rarely the only one worth a look.
pub const BIGGEST: usize = 20;

/// Histogram buckets per doubling of size.
const STEPS: f64 = 16.0;

/// Buckets for every `u32`: one for an empty tile, then [`STEPS`] per bit.
const BUCKETS: usize = 32 * 16 + 1;

/// What a source's tiles weigh, overall and per zoom level.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Sizes {
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub tiles: u64,
	/// Every tile's stored bytes, added up.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub bytes: u64,
	pub p50: u32,
	pub p95: u32,
	pub max: u32,
	/// One entry per level that holds a tile, ascending.
	pub levels: Vec<LevelSizes>,
	/// The biggest tiles, biggest first - at most [`BIGGEST`].
	pub biggest: Vec<SizedTile>,
}

/// The same figures for one zoom level.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct LevelSizes {
	pub level: u8,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub tiles: u64,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub bytes: u64,
	pub p50: u32,
	pub p95: u32,
	pub max: u32,
}

/// One tile, and what it weighs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct SizedTile {
	pub z: u8,
	pub x: u32,
	pub y: u32,
	pub bytes: u32,
}

/// The container a pipeline is, when all it does is read one.
///
/// **Exactly one node, and it is `from_container`.** One transform after it and the sizes are the
/// transform's, which the index knows nothing about. The filename is resolved the way the pipeline
/// resolves it - against the project directory - unless it is absolute or a URL.
#[must_use]
pub fn container_behind(pipeline: &VPLPipeline, dir: &Path) -> Option<String> {
	let [node] = pipeline.pipeline.as_slice() else {
		return None;
	};
	if node.name != "from_container" || !node.sources.is_empty() {
		return None;
	}
	let filename = node.properties.get("filename")?.first()?;
	if filename.contains("://") || Path::new(filename).is_absolute() {
		return Some(filename.clone());
	}
	Some(dir.join(filename).to_string_lossy().into_owned())
}

/// Walks every tile's size, level by level.
///
/// `progress` hears how many tiles are done out of how many there are, every few thousand tiles and
/// at the end; `cancelled` is asked as often, and a walk that is told to stop returns an error rather
/// than a partial answer that would read as a whole one.
pub async fn walk(source: &dyn TileSource, progress: impl Fn(u64, u64), cancelled: impl Fn() -> bool) -> Result<Sizes> {
	let pyramid = source.tile_pyramid().await.context("reading the tile pyramid")?;
	let total = pyramid.count_tiles();
	let mut all = Tally::default();
	let mut levels = Vec::new();
	let mut biggest: Vec<SizedTile> = Vec::with_capacity(BIGGEST + 1);
	let mut done = 0u64;
	progress(0, total);

	for bbox in pyramid.to_iter_bboxes().filter(|bbox| !bbox.is_empty()) {
		let mut level = Tally::default();
		let mut stream = source
			.tile_size_stream(bbox)
			.await
			.with_context(|| format!("reading the sizes at zoom {}", bbox.level()))?;
		while let Some((coord, bytes)) = stream.next().await {
			level.add(bytes);
			all.add(bytes);
			keep_if_biggest(
				&mut biggest,
				SizedTile {
					z: coord.level,
					x: coord.x,
					y: coord.y,
					bytes,
				},
			);
			done += 1;
			if done.is_multiple_of(4096) {
				anyhow::ensure!(!cancelled(), "the measurement was cancelled");
				progress(done, total);
			}
		}
		if level.tiles > 0 {
			levels.push(level.finish(bbox.level()));
		}
	}
	progress(done, total);

	let overall = all.finish(0);
	Ok(Sizes {
		tiles: overall.tiles,
		bytes: overall.bytes,
		p50: overall.p50,
		p95: overall.p95,
		max: overall.max,
		levels,
		biggest,
	})
}

/// One tile's stored size, read from the index - `None` where there is no tile (S14.3).
///
/// For the heat map's hover, which names the tile under the pointer: one entry of the index, so it
/// can be asked on every pause of the pointer.
pub async fn tile_bytes(source: &dyn TileSource, z: u8, x: u32, y: u32) -> Result<Option<u32>> {
	let coord = versatiles_core::TileCoord::new(z, x, y)?;
	let mut stream = source
		.tile_size_stream(versatiles_core::TileBBox::from_min_and_max(z, x, y, x, y)?)
		.await?;
	Ok(stream
		.next()
		.await
		.filter(|(at, _)| *at == coord)
		.map(|(_, bytes)| bytes))
}

/// Inserts a tile into the list of the biggest if it belongs there, keeping the list sorted and short.
///
/// Ties keep the tile seen first, so the same container lists the same tiles every time.
fn keep_if_biggest(biggest: &mut Vec<SizedTile>, tile: SizedTile) {
	if biggest.len() == BIGGEST && biggest.last().is_some_and(|last| last.bytes >= tile.bytes) {
		return;
	}
	let at = biggest.partition_point(|kept| kept.bytes >= tile.bytes);
	biggest.insert(at, tile);
	biggest.truncate(BIGGEST);
}

/// Running figures for a set of tiles.
struct Tally {
	tiles: u64,
	bytes: u64,
	max: u32,
	histogram: Box<[u64; BUCKETS]>,
}

impl Default for Tally {
	fn default() -> Self {
		Self {
			tiles: 0,
			bytes: 0,
			max: 0,
			histogram: Box::new([0; BUCKETS]),
		}
	}
}

impl Tally {
	fn add(&mut self, bytes: u32) {
		self.tiles += 1;
		self.bytes += u64::from(bytes);
		self.max = self.max.max(bytes);
		self.histogram[bucket(bytes)] += 1;
	}

	fn finish(&self, level: u8) -> LevelSizes {
		LevelSizes {
			level,
			tiles: self.tiles,
			bytes: self.bytes,
			p50: self.percentile(0.5),
			p95: self.percentile(0.95),
			max: self.max,
		}
	}

	/// The size below which `share` of the tiles fall, read off the histogram.
	///
	/// **Never above the largest tile actually seen**: a bucket's middle can be, and a p95 bigger
	/// than the maximum beside it would be a number nobody could believe.
	fn percentile(&self, share: f64) -> u32 {
		if self.tiles == 0 {
			return 0;
		}
		// The rank of the tile the percentile names, counting from one.
		#[expect(
			clippy::cast_possible_truncation,
			clippy::cast_sign_loss,
			clippy::cast_precision_loss,
			reason = "a tile count fits an f64 to far better than a bucket's width, and the rank is non-negative"
		)]
		let rank = ((self.tiles as f64) * share).ceil().max(1.0) as u64;
		let mut seen = 0;
		for (index, count) in self.histogram.iter().enumerate() {
			seen += count;
			if seen >= rank {
				return middle(index).min(self.max);
			}
		}
		self.max
	}
}

/// Which bucket a size falls in: `0` for an empty tile, then sixteen to each doubling.
fn bucket(bytes: u32) -> usize {
	if bytes == 0 {
		return 0;
	}
	#[expect(
		clippy::cast_possible_truncation,
		clippy::cast_sign_loss,
		reason = "log2 of a u32 is under 32, so the product is under 512 and non-negative"
	)]
	let step = (f64::from(bytes).log2() * STEPS).floor() as usize;
	(step + 1).min(BUCKETS - 1)
}

/// The size a bucket stands for: its geometric middle.
fn middle(index: usize) -> u32 {
	if index == 0 {
		return 0;
	}
	#[expect(
		clippy::cast_possible_truncation,
		clippy::cast_sign_loss,
		clippy::cast_precision_loss,
		reason = "the bucket index is under 513, and the size it names fits a u32 by construction"
	)]
	let size = 2f64.powf(((index - 1) as f64 + 0.5) / STEPS).round() as u32;
	size
}

#[cfg(test)]
mod tests {
	use super::*;
	use async_trait::async_trait;
	use std::str::FromStr;
	use std::sync::Arc;
	use versatiles_container::{SourceType, Tile, TileSourceMetadata, Traversal};
	use versatiles_core::{TileBBox, TileCompression, TileCoord, TileFormat, TileJSON, TilePyramid, TileStream};

	/// A source that is nothing but an index: a size for each tile, and no tile bodies at all.
	#[derive(Debug)]
	struct Index {
		sizes: Vec<(TileCoord, u32)>,
		metadata: TileSourceMetadata,
		tilejson: TileJSON,
	}

	impl Index {
		fn new(sizes: Vec<(TileCoord, u32)>) -> Self {
			let pyramid = TilePyramid::from_tile_coords(sizes.iter().map(|(coord, _)| *coord));
			Self {
				sizes,
				metadata: TileSourceMetadata::new(
					TileFormat::MVT,
					TileCompression::Uncompressed,
					Traversal::ANY,
					Some(pyramid),
				),
				tilejson: TileJSON::default(),
			}
		}
	}

	#[async_trait]
	impl TileSource for Index {
		fn source_type(&self) -> Arc<SourceType> {
			SourceType::new_container("index", "test")
		}
		fn metadata(&self) -> &TileSourceMetadata {
			&self.metadata
		}
		fn tilejson(&self) -> &TileJSON {
			&self.tilejson
		}
		async fn tile_stream(&self, _bbox: TileBBox) -> Result<TileStream<'static, Tile>> {
			anyhow::bail!("a size walk must not read a tile body")
		}
		async fn tile_size_stream(&self, bbox: TileBBox) -> Result<TileStream<'static, u32>> {
			let inside = self
				.sizes
				.iter()
				.filter(|(coord, _)| coord.level == bbox.level() && bbox.includes_coord(coord))
				.copied()
				.collect();
			Ok(TileStream::from_vec(inside))
		}
	}

	fn at(z: u8, x: u32, y: u32, bytes: u32) -> (TileCoord, u32) {
		(TileCoord::new(z, x, y).unwrap(), bytes)
	}

	#[tokio::test]
	async fn adds_up_per_level_and_overall() -> Result<()> {
		let source = Index::new(vec![
			at(0, 0, 0, 1000),
			at(1, 0, 0, 200),
			at(1, 1, 0, 400),
			at(1, 1, 1, 0),
		]);
		let sizes = walk(&source, |_, _| {}, || false).await?;
		assert_eq!((sizes.tiles, sizes.bytes, sizes.max), (4, 1600, 1000));
		let levels: Vec<_> = sizes
			.levels
			.iter()
			.map(|l| (l.level, l.tiles, l.bytes, l.max))
			.collect();
		assert_eq!(levels, [(0, 1, 1000, 1000), (1, 3, 600, 400)]);
		Ok(())
	}

	#[tokio::test]
	async fn lists_the_biggest_first_and_no_more_than_it_keeps() -> Result<()> {
		let sizes: Vec<_> = (0..64u32).map(|i| at(6, i, 0, 100 + i)).collect();
		let found = walk(&Index::new(sizes), |_, _| {}, || false).await?;
		assert_eq!(found.biggest.len(), BIGGEST);
		assert_eq!(
			found.biggest[0],
			SizedTile {
				z: 6,
				x: 63,
				y: 0,
				bytes: 163
			}
		);
		assert!(found.biggest.windows(2).all(|pair| pair[0].bytes >= pair[1].bytes));
		Ok(())
	}

	/// A percentile off the histogram is close to the real one, and never above the maximum.
	#[tokio::test]
	async fn reads_percentiles_within_a_bucket() -> Result<()> {
		// 1 000 tiles of 1..=1000 kB: the true p50 is 500 kB and the true p95 is 950 kB.
		let sizes: Vec<_> = (0..1000u32).map(|i| at(10, i, 0, (i + 1) * 1000)).collect();
		let found = walk(&Index::new(sizes), |_, _| {}, || false).await?;
		let near = |value: u32, truth: f64| (f64::from(value) / truth - 1.0).abs() < 0.03;
		assert!(near(found.p50, 500_000.0), "p50 was {}", found.p50);
		assert!(near(found.p95, 950_000.0), "p95 was {}", found.p95);
		assert!(found.p95 <= found.max);
		Ok(())
	}

	#[tokio::test]
	async fn an_empty_tile_is_counted_as_nothing() -> Result<()> {
		let found = walk(&Index::new(vec![at(3, 0, 0, 0)]), |_, _| {}, || false).await?;
		assert_eq!((found.tiles, found.p50, found.p95, found.max), (1, 0, 0, 0));
		Ok(())
	}

	#[tokio::test]
	async fn reads_one_tile_or_says_there_is_none() -> Result<()> {
		let source = Index::new(vec![at(5, 3, 4, 1234)]);
		assert_eq!(tile_bytes(&source, 5, 3, 4).await?, Some(1234));
		assert_eq!(tile_bytes(&source, 5, 3, 5).await?, None);
		Ok(())
	}

	#[tokio::test]
	async fn stops_when_told_to() {
		let sizes: Vec<_> = (0..5000u32).map(|i| at(13, i, 0, 10)).collect();
		let error = walk(&Index::new(sizes), |_, _| {}, || true).await.unwrap_err();
		assert!(format!("{error}").contains("cancelled"));
	}

	#[tokio::test]
	async fn reports_progress_up_to_the_total() -> Result<()> {
		let seen = std::sync::Mutex::new(Vec::new());
		let sizes: Vec<_> = (0..10u32).map(|i| at(4, i, 0, 10)).collect();
		walk(
			&Index::new(sizes),
			|done, total| seen.lock().unwrap().push((done, total)),
			|| false,
		)
		.await?;
		let seen = seen.into_inner().unwrap();
		assert_eq!(seen.first(), Some(&(0, 10)));
		assert_eq!(seen.last(), Some(&(10, 10)));
		Ok(())
	}

	fn pipeline(text: &str) -> VPLPipeline {
		VPLPipeline::from_str(text).unwrap()
	}

	#[test]
	fn a_chain_that_only_reads_a_container_is_that_container() {
		let dir = Path::new("/project");
		assert_eq!(
			container_behind(&pipeline("from_container filename='data/a.versatiles'"), dir),
			Some("/project/data/a.versatiles".to_string())
		);
		assert_eq!(
			container_behind(&pipeline("from_container filename='/abs/a.mbtiles'"), dir),
			Some("/abs/a.mbtiles".to_string())
		);
		assert_eq!(
			container_behind(&pipeline("from_container filename='https://x.org/a.pmtiles'"), dir),
			Some("https://x.org/a.pmtiles".to_string())
		);
	}

	#[test]
	fn a_transform_or_another_reader_is_not() {
		let dir = Path::new("/project");
		assert_eq!(
			container_behind(&pipeline("from_container filename='a.versatiles' | vector_repair"), dir),
			None
		);
		assert_eq!(container_behind(&pipeline("from_debug format=pbf"), dir), None);
	}

	/// The real thing, when this machine has the sample containers: every tile counted once.
	#[tokio::test]
	async fn walks_a_real_container() -> Result<()> {
		let Some(path) = crate::analysis::tests::sample_container("berlin.mbtiles") else {
			eprintln!("skipping: no sample containers here");
			return Ok(());
		};
		let runtime = versatiles::runtime::create_runtime();
		let source = runtime.reader_from_str(&path.to_string_lossy()).await?;
		let found = walk(source.as_ref(), |_, _| {}, || false).await?;
		let pyramid = source.tile_pyramid().await?;
		assert_eq!(found.tiles, pyramid.count_tiles());
		assert_eq!(found.levels.iter().map(|level| level.tiles).sum::<u64>(), found.tiles);
		assert!(found.p50 <= found.p95 && found.p95 <= found.max);
		Ok(())
	}
}
