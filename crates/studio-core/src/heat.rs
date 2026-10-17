//! The heat map: tile sizes as squares, a few levels deeper than the map shows (S14.3, B1).
//!
//! **Not the tiles on screen.** A map shows four to ten tiles of the level it requests, so colouring
//! those says nothing. Each heat tile draws the tiles [`LOOK`] levels below it instead, one pixel
//! each - 64 a side - and MapLibre draws the pixels as squares ([Q72]).
//!
//! **The squares follow the zoom.** A heat tile at level `z` draws level `z + LOOK`, up to the
//! deepest level asked for: at zoom 1 a square is a tile of zoom 7, from zoom 8 on it is one of
//! zoom 14. So the heat map draws at every zoom, each heat tile reads at most 4096 sizes, and the
//! legend says which level a square is. A fixed detail level drawn from far above it would mean a
//! million sizes per heat tile, or nothing.
//!
//! **A tile source of its own**, served beside the graph's mount, so the map reads it like any other
//! raster and the core does the work where the index is. Each heat tile is one `tile_size_stream`
//! over the tiles it covers - an index read, no tile body.
//!
//! **A ramp, not bands** - black for nothing, white for the maximum and above - and the maximum is
//! the caller's: 500 kB is the budget a vector tile is held to, but a landcover layer that will be
//! merged into something bigger wants its 50 kB to span the whole ramp.
//!
//! [Q72]: ../../../docs/decisions.md

use anyhow::{Context, Result, ensure};
use async_trait::async_trait;
use std::sync::Arc;
use versatiles_container::{SharedTileSource, SourceType, Tile, TileSource, TileSourceMetadata, Traversal};
use versatiles_core::{TileBBox, TileCompression, TileCoord, TileFormat, TileJSON, TilePyramid, TileStream};
use versatiles_image::{DynamicImage, DynamicImageTraitConvert};

/// How many levels below a heat tile its squares are: 64 a side.
pub const LOOK: u8 = 6;

/// The colours a size runs through, as RGBA, from nothing to the maximum and above.
pub type Ramp = Vec<[u8; 4]>;

/// The colour of `bytes` on `ramp`, which spans nought to `max` evenly; past `max`, the last colour.
#[must_use]
pub fn colour(ramp: &[[u8; 4]], bytes: u32, max: u32) -> [u8; 4] {
	let Some(&last) = ramp.last() else {
		return [0; 4];
	};
	if ramp.len() < 2 || bytes >= max {
		return last;
	}
	let at = f64::from(bytes) / f64::from(max.max(1)) * (ramp.len() - 1) as f64;
	#[expect(
		clippy::cast_possible_truncation,
		clippy::cast_sign_loss,
		reason = "`at` is within 0..len-1"
	)]
	let below = at.floor() as usize;
	let along = at - below as f64;
	let (a, b) = (ramp[below], ramp[(below + 1).min(ramp.len() - 1)]);
	let mut mixed = [0u8; 4];
	for channel in 0..4 {
		#[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "between two u8s")]
		let value = (f64::from(a[channel]) + (f64::from(b[channel]) - f64::from(a[channel])) * along).round() as u8;
		mixed[channel] = value;
	}
	mixed
}

/// Reads a `#rrggbb` or `#rgb` colour, as the webview hands its tokens over - a minified stylesheet
/// writes black as `#000`.
pub fn parse_colour(text: &str) -> Result<[u8; 4]> {
	let hex = text.trim().trim_start_matches('#');
	let long: String = match hex.len() {
		6 => hex.to_string(),
		3 => hex.chars().flat_map(|c| [c, c]).collect(),
		_ => anyhow::bail!("a colour has to be #rrggbb or #rgb, not {text:?}"),
	};
	let channel = |at: usize| u8::from_str_radix(&long[at..at + 2], 16).with_context(|| format!("reading {text:?}"));
	Ok([channel(0)?, channel(2)?, channel(4)?, 255])
}

/// The heat map of one source, down to one level.
#[derive(Debug)]
pub struct Heat {
	sizes: SharedTileSource,
	deepest: u8,
	ramp: Ramp,
	max: u32,
	metadata: TileSourceMetadata,
	tilejson: TileJSON,
}

impl Heat {
	/// A heat map of `sizes` whose squares go no deeper than `deepest`, which must be a level the
	/// source has tiles at; `max` is the size at the end of `ramp`.
	pub async fn new(sizes: SharedTileSource, deepest: u8, ramp: Ramp, max: u32) -> Result<Self> {
		ensure!(ramp.len() >= 2, "a ramp needs two colours at least");
		ensure!(max > 0, "the maximum has to be above nought");
		let pyramid = sizes.tile_pyramid().await.context("reading the tile pyramid")?;
		let base = pyramid.level_bbox(deepest);
		ensure!(!base.is_empty(), "there are no tiles at zoom {deepest}");

		let mut drawn = TilePyramid::new_empty();
		for level in 0..=deepest {
			drawn.set_level_bbox(at_level(&base, level)?);
		}
		let metadata = TileSourceMetadata::new(
			TileFormat::PNG,
			TileCompression::Uncompressed,
			Traversal::ANY,
			Some(drawn),
		);
		let mut tilejson = TileJSON::default();
		metadata.update_tilejson(&mut tilejson);
		Ok(Self {
			sizes,
			deepest,
			ramp,
			max,
			metadata,
			tilejson,
		})
	}

	/// The level a heat tile at `level` draws as squares.
	#[must_use]
	pub fn detail_at(&self, level: u8) -> u8 {
		level.saturating_add(LOOK).min(self.deepest)
	}

	/// The heat tile at `coord`: a pixel per tile of [`Self::detail_at`], `None` where there are none.
	async fn draw(&self, coord: &TileCoord) -> Result<Option<Tile>> {
		if coord.level > self.deepest {
			return Ok(None);
		}
		let detail = self.detail_at(coord.level);
		let depth = detail - coord.level;
		let side = 1u32 << depth;
		let (x0, y0) = (coord.x << depth, coord.y << depth);
		let bbox = TileBBox::from_min_and_max(detail, x0, y0, x0 + side - 1, y0 + side - 1)?;

		let mut cells: Vec<Option<u32>> = vec![None; (side * side) as usize];
		let mut stream = self.sizes.tile_size_stream(bbox).await?;
		while let Some((at, bytes)) = stream.next().await {
			cells[((at.y - y0) * side + (at.x - x0)) as usize] = Some(bytes);
		}
		if cells.iter().all(Option::is_none) {
			return Ok(None);
		}

		let pixels: Vec<u8> = cells
			.iter()
			.flat_map(|cell| cell.map_or([0; 4], |bytes| colour(&self.ramp, bytes, self.max)))
			.collect();
		let image = DynamicImage::from_raw(side as usize, side as usize, pixels)?;
		Ok(Some(Tile::from_image(image, TileFormat::PNG)?))
	}
}

/// The tiles of `base` as seen from `level`, which is at or above it.
fn at_level(base: &TileBBox, level: u8) -> Result<TileBBox> {
	let shift = base.level() - level;
	let [x_min, y_min, x_max, y_max] = base.to_array()?;
	TileBBox::from_min_and_max(level, x_min >> shift, y_min >> shift, x_max >> shift, y_max >> shift)
}

#[async_trait]
impl TileSource for Heat {
	fn source_type(&self) -> Arc<SourceType> {
		SourceType::new_container("heat map", "heat")
	}

	fn metadata(&self) -> &TileSourceMetadata {
		&self.metadata
	}

	fn tilejson(&self) -> &TileJSON {
		&self.tilejson
	}

	async fn tile(&self, coord: &TileCoord) -> Result<Option<Tile>> {
		self.draw(coord).await
	}

	/// One tile after another. The map asks for tiles one at a time; nothing walks a heat map whole.
	async fn tile_stream(&self, bbox: TileBBox) -> Result<TileStream<'static, Tile>> {
		let mut tiles = Vec::new();
		// Collected first: the iterator is not `Send`, and it would be held across the await.
		let coords: Vec<TileCoord> = bbox.iter_coords().collect();
		for coord in coords {
			if let Some(tile) = self.draw(&coord).await? {
				tiles.push((coord, tile));
			}
		}
		Ok(TileStream::from_vec(tiles))
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use versatiles_core::TileStream;
	use versatiles_image::GenericImageView;

	/// Sizes and nothing else, like `measure`'s - a heat map must never read a tile body.
	#[derive(Debug)]
	struct Index {
		sizes: Vec<(TileCoord, u32)>,
		metadata: TileSourceMetadata,
		tilejson: TileJSON,
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
			anyhow::bail!("a heat map must not read a tile body")
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

	fn index(sizes: Vec<(u8, u32, u32, u32)>) -> SharedTileSource {
		let sizes: Vec<_> = sizes
			.into_iter()
			.map(|(z, x, y, bytes)| (TileCoord::new(z, x, y).unwrap(), bytes))
			.collect();
		let pyramid = TilePyramid::from_tile_coords(sizes.iter().map(|(coord, _)| *coord));
		Arc::new(Index {
			sizes,
			metadata: TileSourceMetadata::new(
				TileFormat::MVT,
				TileCompression::Uncompressed,
				Traversal::ANY,
				Some(pyramid),
			),
			tilejson: TileJSON::default(),
		})
	}

	/// Black to white through grey, so a pixel's value says where on the ramp it sits.
	fn ramp() -> Ramp {
		vec![[0, 0, 0, 255], [255, 255, 255, 255]]
	}

	async fn image(heat: &Heat, z: u8, x: u32, y: u32) -> Option<DynamicImage> {
		let tile = heat.tile(&TileCoord::new(z, x, y).unwrap()).await.unwrap()?;
		let blob = tile.into_blob(&TileCompression::Uncompressed).unwrap();
		Some(DynamicImage::from_blob(&blob, TileFormat::PNG).unwrap())
	}

	#[test]
	fn runs_from_black_at_nought_to_white_at_the_maximum_and_past_it() {
		let ramp = ramp();
		assert_eq!(colour(&ramp, 0, 500_000), [0, 0, 0, 255]);
		assert_eq!(colour(&ramp, 250_000, 500_000), [128, 128, 128, 255]);
		assert_eq!(colour(&ramp, 500_000, 500_000), [255, 255, 255, 255]);
		assert_eq!(colour(&ramp, 900_000, 500_000), [255, 255, 255, 255]);
		// Between stops of a longer ramp: halfway from the second to the third.
		let three = vec![[0, 0, 0, 255], [0, 0, 200, 255], [200, 0, 0, 255]];
		assert_eq!(colour(&three, 75, 100), [100, 0, 100, 255]);
	}

	#[test]
	fn reads_a_token_colour() {
		assert_eq!(parse_colour("#0e7c7b").unwrap(), [14, 124, 123, 255]);
		assert_eq!(parse_colour("#fff").unwrap(), [255, 255, 255, 255]);
		assert!(parse_colour("rgb(1, 2, 3)").is_err());
	}

	/// The heart of it: at zoom 0, the four tiles of zoom 1 are four pixels, each its own shade,
	/// and the one that is missing is transparent rather than "small".
	#[tokio::test]
	async fn draws_each_tile_below_as_a_pixel() -> Result<()> {
		let heat = Heat::new(
			index(vec![(1, 0, 0, 0), (1, 1, 0, 600_000), (1, 0, 1, 250_000)]),
			1,
			ramp(),
			500_000,
		)
		.await?;
		let drawn = image(&heat, 0, 0, 0).await.expect("a heat tile");
		assert_eq!(drawn.dimensions(), (2, 2));
		let pixel = |x, y| drawn.get_pixel(x, y).0;
		assert_eq!(pixel(0, 0), [0, 0, 0, 255]);
		assert_eq!(pixel(1, 0), [255, 255, 255, 255], "over the maximum is the maximum");
		assert_eq!(pixel(0, 1), [128, 128, 128, 255]);
		assert_eq!(pixel(1, 1)[3], 0, "no tile is transparent, not small");
		Ok(())
	}

	/// The squares follow the zoom: [`LOOK`] levels down, but never past the deepest asked for.
	#[tokio::test]
	async fn draws_the_level_six_below_and_no_deeper_than_asked() -> Result<()> {
		let heat = Heat::new(index(vec![(14, 8800, 5373, 10), (8, 137, 83, 10)]), 14, ramp(), 1).await?;
		assert_eq!([heat.detail_at(0), heat.detail_at(8), heat.detail_at(12)], [6, 14, 14]);
		let far = image(&heat, 2, 2, 1).await.expect("zoom 8 under zoom 2");
		assert_eq!(far.dimensions(), (64, 64));
		let near = image(&heat, 12, 2200, 1343).await.expect("zoom 14 under zoom 12");
		assert_eq!(near.dimensions(), (4, 4));
		assert!(image(&heat, 2, 0, 0).await.is_none(), "no tiles under it");
		Ok(())
	}

	#[tokio::test]
	async fn refuses_a_level_with_no_tiles_and_a_maximum_of_nought() {
		let error = Heat::new(index(vec![(3, 0, 0, 10)]), 5, ramp(), 1).await.unwrap_err();
		assert!(format!("{error}").contains("zoom 5"));
		assert!(Heat::new(index(vec![(3, 0, 0, 10)]), 3, ramp(), 0).await.is_err());
	}
}
