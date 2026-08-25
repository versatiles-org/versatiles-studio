/**
 * One thing Studio draws on the map: a GeoJSON source, the layers over it, and keeping both there.
 *
 * `TileGrid`, `TileActivity` and `CropOverlay` each hand-rolled this, and every one of them had a
 * different subset of it right. What the three between them had learned, and now share:
 *
 * **A style change destroys everything.** Swapping the background replaces the whole style, which is
 * MapLibre's only way to do it, so an overlay added once at start-up is gone the first time the map
 * is restyled. `styledata` and `load` bring it back.
 *
 * **Whatever is drawn after it goes above it.** The preview's own layers are re-added on the same
 * event, so an overlay that only ensured its *existence* ended up buried under the tiles it is meant
 * to describe. Layers that are already there are moved back to the top.
 *
 * **A rebuilt source comes back empty.** The layers exist, nothing draws, and the effect that would
 * fill them has no reason to run because none of its inputs changed. So a rebuild redraws.
 *
 * **Each piece is ensured on its own.** Guarding a whole overlay on its source is what made this
 * class of bug invisible: `addSource` succeeding and a later `addLayer` throwing left the source
 * present and the layers absent, and every call after that returned early on the source it had just
 * added - half-drawn for the life of the style, silently, because a layer that was never added
 * throws nothing afterwards.
 *
 * **And it says when it failed.** Anything still missing once the map is `idle` is reported with the
 * error that stopped it. Every round of the bug above looked identical from the outside: nothing on
 * the map, nothing in the console. `idle` is the point at which "too early" stops being an answer.
 *
 * Not gated on `isStyleLoaded()`, which is the wrong question - `Style.loaded()` is false while
 * *any* tile is still in flight, which with a background basemap is most of the time. `addSource`
 * throws only when there is no style at all, so this tries and lets the events bring it round.
 */

import type { Map as MaplibreMap, GeoJSONSource, LayerSpecification } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';

/** Nothing to draw. Shared, because every overlay starts and ends here. */
export const NOTHING: FeatureCollection = { type: 'FeatureCollection', features: [] };

export interface OverlaySpec {
	/** The source id. Layer ids are the caller's, so an existing overlay keeps the names it had. */
	source: string;
	/**
	 * The layers over it, in draw order, built **on demand**.
	 *
	 * A function rather than an array so `token()` is read when a layer is added - which is after a
	 * theme change, not when this module loaded.
	 */
	layers: () => LayerSpecification[];
	/** What to draw. Read whenever the layers had to be built, so a rebuild is not left blank. */
	data: () => FeatureCollection;
	/** Named in the console when something cannot be added. Defaults to the source id. */
	label?: string;
}

export interface Overlay {
	/** Re-reads `data()` and puts it on the map, adding anything missing first. */
	draw(): void;
	/** Removes the layers, the source and the listeners. Safe to call when none were added. */
	dispose(): void;
}

/**
 * Mounts an overlay and keeps it mounted.
 *
 * Returns the handle the caller drives: `draw()` when its data changes, `dispose()` on teardown.
 */
export function mapOverlay(map: MaplibreMap, spec: OverlaySpec): Overlay {
	const name = spec.label ?? spec.source;
	/** What could not be added, and why - so the audit can say *why*, not only *that*. */
	const refused: Record<string, unknown> = {};
	let complained = false;

	/** Adds whatever is missing, and lifts what is already there back to the top. */
	function ensure(): boolean {
		let rebuilt = false;
		try {
			if (!map.getSource(spec.source)) {
				map.addSource(spec.source, { type: 'geojson', data: NOTHING });
				rebuilt = true;
			}
		} catch {
			// No style yet. The listeners below bring us round again.
			return false;
		}

		for (const layer of spec.layers()) {
			if (map.getLayer(layer.id)) {
				map.moveLayer(layer.id);
				continue;
			}
			try {
				map.addLayer(layer);
				rebuilt = true;
			} catch (error) {
				refused[layer.id] = error;
			}
		}
		return rebuilt;
	}

	function draw() {
		ensure();
		const source = map.getSource(spec.source) as GeoJSONSource | undefined;
		source?.setData(spec.data());
	}

	/** Ensure, and redraw only if something had to be built - a no-op restore stays a no-op. */
	function restore() {
		if (ensure()) {
			const source = map.getSource(spec.source) as GeoJSONSource | undefined;
			source?.setData(spec.data());
		}
	}

	function audit() {
		restore();
		if (complained) return;
		const absent = spec.layers().filter((layer) => !map.getLayer(layer.id));
		if (absent.length === 0) return;
		complained = true;
		for (const layer of absent) {
			console.error(`${name}: ${layer.id} is not on the map`, refused[layer.id] ?? '(no error reported)');
		}
	}

	// Attached *before* the first attempt, so a throw cannot cost us the recovery - the failure
	// `TileActivity` was written to avoid and then reintroduced elsewhere twice.
	map.on('styledata', restore);
	map.on('load', restore);
	map.on('idle', audit);
	restore();

	return {
		draw,
		dispose() {
			map.off('styledata', restore);
			map.off('load', restore);
			map.off('idle', audit);
			// Layers before the source: a source still carrying layers cannot be removed.
			for (const layer of [...spec.layers()].reverse()) {
				if (map.getLayer(layer.id)) map.removeLayer(layer.id);
			}
			if (map.getSource(spec.source)) map.removeSource(spec.source);
		}
	};
}
