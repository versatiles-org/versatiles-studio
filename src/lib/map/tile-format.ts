/**
 * What MapLibre can do with a container's tiles.
 *
 * `TileFormat` upstream is `avif | bin | geojson | jpg | json | mvt | png | svg | topojson | webp`,
 * and only some of those are things a map can draw. Studio used to treat "not `mvt`" as "raster",
 * which put a raster layer over `bin`, `json`, `geojson`, `topojson` and `svg` alike — MapLibre then
 * fetched every tile and failed to decode it, one `createImageBitmap` error per tile, with a blank
 * map and nothing to say why.
 *
 * `bin` is the *default* variant upstream, so a container whose format cannot be determined lands
 * there. That is the case worth naming rather than guessing at.
 */

/** Formats MapLibre renders as a raster source. */
const RASTER = new Set(['avif', 'jpg', 'png', 'webp']);

/** Formats MapLibre renders as a vector source. */
const VECTOR = new Set(['mvt']);

export type Renderable = 'vector' | 'raster' | null;

/** How to draw this format, or `null` if a map cannot draw it at all. */
export function renderableAs(tileFormat: string): Renderable {
	const format = tileFormat.toLowerCase();
	if (VECTOR.has(format)) return 'vector';
	if (RASTER.has(format)) return 'raster';
	return null;
}

/** Why a format cannot be shown, in words a user can act on. */
export function whyNotRenderable(tileFormat: string): string {
	const format = tileFormat.toLowerCase();
	if (format === 'bin') {
		return 'The tile format could not be determined, so the tiles cannot be drawn on the map.';
	}
	return `Tiles are ${format}, which the map cannot draw. Vector tiles (mvt) and images (png, jpg, webp, avif) can be.`;
}
