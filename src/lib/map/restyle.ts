/**
 * Replacing the map's style without asking MapLibre to do it mid-load.
 *
 * **The bug this exists for greeted every launch:**
 *
 * ```text
 * Unable to perform style diff: Style is not done loading. Rebuilding the style from scratch.
 * ```
 *
 * `Map.setStyle` with an object tries to *diff* the new style against the current one, and the diff
 * begins by asserting the current style has finished loading. Fail that and MapLibre catches its own
 * error, warns, and rebuilds from scratch — so the cost is not the log line. It is every source torn
 * down and refetched, at the one moment a map has the most to fetch.
 *
 * **And it was guaranteed, not unlucky.** The map is constructed with the default style, and the
 * composed one arrives a moment later — as soon as the server URL, the background and the first
 * graph have all landed. That is comfortably inside the first style's load.
 *
 * So a style is *applied* rather than set: if the one on the map has not finished loading, the new
 * one waits for it. **The newest wins.** Several can arrive while the first is still loading — a
 * background resolving, a graph mounting, a recipe changing — and only the last of them describes
 * what the map should show; applying each in turn would rebuild the map once per intermediate state
 * nobody asked to see.
 *
 * MapLibre defers this way itself, but only for `transformStyle`, which Studio does not use.
 *
 * **Waiting is safe because `style.load` is not waiting on the network.** MapLibre fires it at the
 * end of parsing the style, in the same breath as setting the flag the diff checks — sprites,
 * glyphs and tiles all load after it and none of them can hold it up. What *does* delay it is that
 * a style given as an object is parsed one animation frame later, which is the whole of the race
 * this module exists for. The one way it never arrives is a style that fails validation, and that
 * is a map with no layers on it either way.
 */

import type { Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';

/**
 * A function that applies a style when the map is ready for it.
 *
 * `onApplied` is called once a style *this* applied has finished loading — which is when whatever
 * the caller drew on the old style has to be drawn again, because setting a style discards it.
 * Deliberately not called for the style the map was constructed with: nothing has been drawn yet,
 * and a caller restoring its layers onto the very first style would be restoring nothing.
 */
export function restyler(map: MaplibreMap, onApplied?: () => void): (style: StyleSpecification) => void {
	/** Whether the style now on the map has finished loading — the thing the diff insists on. */
	let ready = false;
	/** The newest style waiting for that, if any. */
	let waiting: StyleSpecification | null = null;
	/** Whether this has ever set one, which is what tells a restore from the initial load. */
	let owned = false;

	map.on('style.load', () => {
		ready = true;
		if (waiting) {
			push();
			return;
		}
		if (owned) onApplied?.();
	});

	function push() {
		const next = waiting;
		waiting = null;
		if (!next) return;
		ready = false;
		owned = true;
		map.setStyle(next);
	}

	return (style: StyleSpecification) => {
		waiting = style;
		if (ready) push();
	};
}
