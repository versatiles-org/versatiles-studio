/**
 * The z/x/y tile grid as a GeoJSON source (A5, S1.7).
 *
 * Built in the main thread from the viewport rather than fetched: at any zoom the visible grid is a
 * few hundred rectangles, which is cheaper to generate than to request.
 */

import type { LngLatBounds } from 'maplibre-gl';

export interface GridFeature {
	type: 'Feature';
	geometry: { type: 'Polygon'; coordinates: [number, number][][] };
	properties: { label: string };
}

/** Web Mercator tile x/y for a lon/lat at zoom `z`. */
export function tileForLngLat(lng: number, lat: number, z: number): { x: number; y: number } {
	const n = 2 ** z;
	const x = Math.floor(((lng + 180) / 360) * n);
	const rad = (lat * Math.PI) / 180;
	const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
	return { x: clamp(x, 0, n - 1), y: clamp(y, 0, n - 1) };
}

/** West/north corner of a tile, in degrees. */
export function tileToLngLat(x: number, y: number, z: number): [number, number] {
	const n = 2 ** z;
	const lng = (x / n) * 360 - 180;
	const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
	return [lng, lat];
}

/**
 * Grid rectangles covering `bounds` at integer zoom `z`.
 *
 * Capped at 2048 tiles: past that the labels are unreadable anyway, and generating them stalls the
 * frame that draws them.
 */
/**
 * The zoom level MapLibre asks a source for, at a given map zoom (A5).
 *
 * **MapLibre's own rule, not a guess.** `Transform.coveringZoomLevel` is
 * `(roundZoom ? round : floor)(zoom + log2(512 / tileSize))`, and there is no `devicePixelRatio`
 * anywhere in it - a retina screen is where this gets *noticed*, not where it comes from. Two things
 * move the answer:
 *
 * - **Tile size.** 512 is MapLibre's own unit, so a 256px source is asked for one level deeper. A
 *   pipeline ending in `raster_tile_resize tile_size=256` produces exactly that.
 * - **Rounding.** `RasterTileSource` sets `roundZoom = true` and `RasterDEMTileSource` inherits it;
 *   vector sources leave it false. So imagery changes level at the half, and vector at the whole.
 *
 * The grid drew `floor(zoom)` regardless, which is right for one of the four combinations. A grid
 * one level out is worse than no grid: it labels tiles that were never requested.
 *
 * `null` for a map with nothing of ours on it - there is no source to follow, so the map's own zoom
 * is the only answer available.
 */
export function requestedZoom(mapZoom: number, source: { type: string; tileSize?: number } | null | undefined): number {
	if (!source) return Math.max(0, Math.floor(mapZoom));
	const rounds = source.type === 'raster' || source.type === 'raster-dem';
	const shift = Math.log2(512 / (source.tileSize ?? 512));
	return Math.max(0, (rounds ? Math.round : Math.floor)(mapZoom + shift));
}

/**
 * The middle of one tile, in degrees.
 *
 * Where a marker for that tile goes ([S2.16](../../../docs/history.md)). `tileToLngLat` takes the
 * fraction happily, so the centre is the corner half a tile along - which keeps the marker and the
 * grid reading the same projection rather than two spellings of it.
 */
export function tileCenter(x: number, y: number, z: number): [number, number] {
	return tileToLngLat(x + 0.5, y + 0.5, z);
}

/**
 * The four corners of one tile, as a GeoJSON ring.
 *
 * The grid's own. The pending tiles used to be shaded with these too, which is why this was written
 * to be shared; they are marked at their centre now (S2.16), and `tileCenter` is the half of that
 * agreement which survived.
 */
export function tileRing(x: number, y: number, z: number): [number, number][][] {
	const [w, n] = tileToLngLat(x, y, z);
	const [e, s] = tileToLngLat(x + 1, y + 1, z);
	return [
		[
			[w, n],
			[e, n],
			[e, s],
			[w, s],
			[w, n]
		]
	];
}

export function gridFeatures(bounds: LngLatBounds, z: number): GridFeature[] {
	const nw = tileForLngLat(bounds.getWest(), bounds.getNorth(), z);
	const se = tileForLngLat(bounds.getEast(), bounds.getSouth(), z);

	const features: GridFeature[] = [];
	const limit = 2048;

	for (let x = nw.x; x <= se.x && features.length < limit; x++) {
		for (let y = nw.y; y <= se.y && features.length < limit; y++) {
			features.push({
				type: 'Feature',
				geometry: { type: 'Polygon', coordinates: tileRing(x, y, z) },
				properties: { label: `${z}/${x}/${y}` }
			});
		}
	}
	return features;
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}
