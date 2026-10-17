//! The heat map: a deeper level's tile sizes, drawn inside the level the map shows (S14.3, B1).
//!
//! **Not the tiles on screen.** A map shows four to ten tiles of the level it requests, so colouring
//! those says nothing. This draws a *detail* level inside them instead: at zoom 8 with the detail
//! level at 14, each tile carries its 64×64 tiles of zoom 14, one pixel each, and MapLibre draws the
//! pixels as squares ([Q72]).
//!
//! **A tile source of its own**, served beside the graph's mount, so the map reads it like any other
//! raster and the core does the work where the index is. Each heat tile is one `tile_size_stream`
//! over the detail tiles it covers - an index read, no tile body.
//!
//! **Past 256 a side, a pixel is the largest of the tiles under it**: the question is where the
//! worst tiles are, and an average would hide one bad tile among fifteen good ones. And no heat
//! tiles more than [`SPAN`] levels above the detail level, where one heat tile would mean reading a
//! million sizes; the map says to zoom in instead.
//!
//! [Q72]: ../../../docs/decisions.md

use anyhow::{Context, Result, ensure};
use async_trait::async_trait;
use std::sync::Arc;
use versatiles_container::{SharedTileSource, SourceType, Tile, TileSource, TileSourceMetadata, Traversal};
use versatiles_core::{TileBBox, TileCompression, TileCoord, TileFormat, TileJSON, TilePyramid, TileStream};
use versatiles_image::{DynamicImage, DynamicImageTraitConvert};

/// Where the colour changes, in stored bytes: under 50 kB, 200 kB, 500 kB, and above.
///
/// **Fixed, not relative to the container**, so a colour means the same in every file. A scale fitted
/// to each container would paint its biggest tile red even when every tile is fine. 500 kB is the
/// ceiling a vector tile is usually held to.
pub const BANDS: [u32; 3] = [50_000, 200_000, 500_000];

/// How many levels above the detail level heat tiles are drawn.
pub const SPAN: u8 = 10;

/// The most pixels a heat tile has a side.
const SIDE: u32 = 256;

/// One colour per band, as RGBA.
pub type Palette = [[u8; 4]; 4];

/// Which band a size falls in, `0` to `3`.
#[must_use]
pub fn band(bytes: u32) -> usize {
	BANDS.iter().filter(|&&edge| bytes >= edge).count()
}

/// Reads a `#rrggbb` colour, as the webview hands its tokens over.
pub fn parse_colour(text: &str) -> Result<[u8; 4]> {
	let hex = text.trim().trim_start_matches('#');
	ensure!(hex.len() == 6, "a colour has to be #rrggbb, not {text:?}");
	let channel = |at: usize| u8::from_str_radix(&hex[at..at + 2], 16).with_context(|| format!("reading {text:?}"));
	Ok([channel(0)?, channel(2)?, channel(4)?, 255])
}

/// The heat map of one source at one detail level.
#[derive(Debug)]
pub struct Heat {
	sizes: SharedTileSource,
	detail: u8,
	palette: Palette,
	metadata: TileSourceMetadata,
	tilejson: TileJSON,
}

impl Heat {
	/// A heat map of `sizes` at `detail`, which must be a level the source has tiles at.
	pub async fn new(sizes: SharedTileSource, detail: u8, palette: Palette) -> Result<Self> {
		let pyramid = sizes.tile_pyramid().await.context("reading the tile pyramid")?;
		let base = pyramid.level_bbox(detail);
		ensure!(!base.is_empty(), "there are no tiles at zoom {detail}");

		let mut drawn = TilePyramid::new_empty();
		for level in detail.saturating_sub(SPAN)..=detail {
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
			detail,
			palette,
			metadata,
			tilejson,
		})
	}

	/// The lowest level heat tiles are drawn at.
	#[must_use]
	pub fn min_zoom(&self) -> u8 {
		self.detail.saturating_sub(SPAN)
	}

	/// The heat tile at `coord`: a pixel per detail tile, `None` where there are none at all.
	async fn draw(&self, coord: &TileCoord) -> Result<Option<Tile>> {
		if coord.level > self.detail || coord.level < self.min_zoom() {
			return Ok(None);
		}
		let depth = self.detail - coord.level;
		let full = 1u32 << depth;
		let side = full.min(SIDE);
		let per = full / side;
		let (x0, y0) = (coord.x << depth, coord.y << depth);
		let bbox = TileBBox::from_min_and_max(self.detail, x0, y0, x0 + full - 1, y0 + full - 1)?;

		let mut cells: Vec<Option<u32>> = vec![None; (side * side) as usize];
		let mut stream = self.sizes.tile_size_stream(bbox).await?;
		while let Some((at, bytes)) = stream.next().await {
			let cell = (((at.y - y0) / per) * side + (at.x - x0) / per) as usize;
			cells[cell] = Some(cells[cell].map_or(bytes, |kept| kept.max(bytes)));
		}
		if cells.iter().all(Option::is_none) {
			return Ok(None);
		}

		let pixels: Vec<u8> = cells
			.iter()
			.flat_map(|cell| cell.map_or([0; 4], |bytes| self.palette[band(bytes)]))
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

	const PALETTE: Palette = [
		[0, 255, 0, 255],
		[255, 255, 0, 255],
		[255, 128, 0, 255],
		[255, 0, 0, 255],
	];

	async fn image(heat: &Heat, z: u8, x: u32, y: u32) -> Option<DynamicImage> {
		let tile = heat.tile(&TileCoord::new(z, x, y).unwrap()).await.unwrap()?;
		let blob = tile.into_blob(&TileCompression::Uncompressed).unwrap();
		Some(DynamicImage::from_blob(&blob, TileFormat::PNG).unwrap())
	}

	#[test]
	fn a_size_falls_in_one_of_four_bands() {
		assert_eq!(
			[band(0), band(49_999), band(50_000), band(499_999), band(500_000)],
			[0, 0, 1, 2, 3]
		);
	}

	#[test]
	fn reads_a_token_colour() {
		assert_eq!(parse_colour("#0e7c7b").unwrap(), [14, 124, 123, 255]);
		assert!(parse_colour("rgb(1, 2, 3)").is_err());
	}

	/// The heart of it: at zoom 0, the four tiles of zoom 1 are four pixels, each in its own colour,
	/// and the one that is missing is transparent rather than "small".
	#[tokio::test]
	async fn draws_each_detail_tile_as_a_pixel() -> Result<()> {
		let heat = Heat::new(
			index(vec![(1, 0, 0, 10), (1, 1, 0, 600_000), (1, 0, 1, 100_000)]),
			1,
			PALETTE,
		)
		.await?;
		let drawn = image(&heat, 0, 0, 0).await.expect("a heat tile");
		assert_eq!(drawn.dimensions(), (2, 2));
		let pixel = |x, y| drawn.get_pixel(x, y).0;
		assert_eq!(pixel(0, 0), PALETTE[0]);
		assert_eq!(pixel(1, 0), PALETTE[3]);
		assert_eq!(pixel(0, 1), PALETTE[1]);
		assert_eq!(pixel(1, 1)[3], 0, "no tile is transparent, not small");
		Ok(())
	}

	/// More detail tiles than pixels: a pixel is the worst tile under it, not the average.
	#[tokio::test]
	async fn a_pixel_over_many_tiles_is_the_largest() -> Result<()> {
		// Zoom 9 under zoom 0 is 512 a side; at 256 pixels, each pixel covers two by two.
		let heat = Heat::new(index(vec![(9, 0, 0, 10), (9, 1, 1, 700_000)]), 9, PALETTE).await?;
		let drawn = image(&heat, 0, 0, 0).await.expect("a heat tile");
		assert_eq!(drawn.dimensions(), (256, 256));
		assert_eq!(drawn.get_pixel(0, 0).0, PALETTE[3]);
		Ok(())
	}

	#[tokio::test]
	async fn draws_nothing_where_there_are_no_tiles_or_too_far_up() -> Result<()> {
		let heat = Heat::new(index(vec![(12, 0, 0, 10)]), 12, PALETTE).await?;
		assert!(image(&heat, 1, 1, 1).await.is_none(), "no tiles under it");
		assert!(image(&heat, 1, 0, 0).await.is_none(), "more than SPAN levels up");
		assert!(image(&heat, 2, 0, 0).await.is_some());
		assert_eq!(heat.min_zoom(), 2);
		Ok(())
	}

	#[tokio::test]
	async fn refuses_a_level_with_no_tiles() {
		let error = Heat::new(index(vec![(3, 0, 0, 10)]), 5, PALETTE).await.unwrap_err();
		assert!(format!("{error}").contains("zoom 5"));
	}
}
