/**
 * Which layers draw from one source - worked out once per style, not once per event.
 *
 * Two bugs in one small function, both shipped:
 *
 * **Asking every layer.** `queryRenderedFeatures` with no filter queries the whole style, and the
 * background (D1) is an entire generated basemap - so a click anywhere returned OSM roads, landuse
 * and place labels. A8 is about what is in *your* tiles.
 *
 * **Asking too often.** The first fix called `getStyle()` from a `mousemove` handler. That
 * serialises every layer and source the style has, per event, and MapLibre fires its listeners in
 * one ordered loop - so the handler registered after it, the one drawing the crop rectangle, never
 * got a usable turn. The answer only changes when the style does, so it is cached until it says so.
 *
 * Matched by **source** rather than by layer id or metadata, because that is the one thing true of
 * Studio's tiles however they are drawn: the hairlines added per vector layer when nothing is
 * styled, and the recipe's own layers once something is (S4). Both sit on the graph's mount, which
 * is also its name and its style source at once ([Q32](../../../docs/decisions.md)).
 */

import type { Map as MaplibreMap } from 'maplibre-gl';

export interface SourceLayers {
	/** The ids, from cache when the style has not changed since the last call. */
	ids(): string[];
	/** Called when the style changes, so the next `ids()` looks again. */
	invalidate(): void;
}

/**
 * A cached lookup of the layers on `source`.
 *
 * With no source it answers nothing - deliberately, and not the same as "no filter": handing an
 * empty list to `queryRenderedFeatures` would make it query everything, which is the first bug
 * above wearing the second's clothes. Callers check for empty before asking.
 */
export function sourceLayers(map: MaplibreMap, source: string | null): SourceLayers {
	let cached: string[] | null = null;

	return {
		ids() {
			if (cached) return cached;
			if (!source) return [];
			// Not `isStyleLoaded()`: that is false while any tile is still in flight, which would
			// make a click answer nothing for as long as the map was busy. `getStyle` throws only
			// when there is no style at all, and then the next call simply tries again.
			try {
				cached = map
					.getStyle()
					.layers.filter((layer) => 'source' in layer && layer.source === source)
					.map((layer) => layer.id);
			} catch {
				return [];
			}
			return cached;
		},
		invalidate() {
			cached = null;
		}
	};
}
