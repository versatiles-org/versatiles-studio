<script lang="ts">
	import { untrack } from 'svelte';
	import type { Map as MaplibreMap, GeoJSONSource } from 'maplibre-gl';
	import { tiles } from '../state/tiles.svelte';
	import { token } from '../styles/tokens';
	import { role } from './theme';

	// Which tiles the map is still waiting for (S2.16, C3).
	//
	// The status bar says how many; this says which. On a slow pipeline the two answer different
	// questions — "is anything happening" and "is it the tile I am looking at" — and the second is
	// the one that tells you whether panning somewhere else would help.
	//
	// **Drawn from the queue, not from MapLibre.** Studio fetches these tiles itself, so it knows a
	// tile's coordinate and its state at the same time; MapLibre reports both halves as "loading"
	// (see `tile-queue.ts`).

	let { map }: { map: MaplibreMap | undefined } = $props();

	/// Named once, so the two places that read the pending tiles agree on their shape.
	const featuresOf = () => tiles.features;

	const SOURCE = 'studio:tile-activity';
	const FILL = `${SOURCE}:fill`;
	const LABEL = `${SOURCE}:label`;

	/**
	 * Puts the overlay back, and on top.
	 *
	 * **Both halves are needed, and neither is optional.** Swapping the background replaces the whole
	 * style, which is MapLibre's only way to do it, and a replaced style has none of the layers added
	 * to the old one — so an overlay added once at startup is gone the first time the map is
	 * restyled. And whatever is drawn *after* it goes above it: the preview's own layers are re-added
	 * on the same event, so an overlay that only ensured its existence would end up buried under the
	 * tiles it is meant to describe.
	 */
	function ensure(m: MaplibreMap) {
		if (!m.getSource(SOURCE)) {
			m.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
			m.addLayer({
				id: FILL,
				type: 'fill',
				source: SOURCE,
				metadata: role('pending-fill'),
				paint: {
					'fill-color': token('--map-pending'),
					'fill-opacity': ['case', ['==', ['get', 'state'], 'rendering'], 0.4, 0.2]
				}
			});
			m.addLayer({
				id: LABEL,
				type: 'symbol',
				source: SOURCE,
				metadata: role('pending-label'),
				layout: {
					'text-field': ['get', 'state'],
					'text-font': ['noto_sans_regular'],
					'text-size': 20,
					'symbol-placement': 'point'
				},
				paint: {
					'text-color': '#000',
					'text-opacity': ['case', ['==', ['get', 'state'], 'rendering'], 0.8, 0.5]
				}
			});
			// Whatever was pending across the restyle is still pending; `untrack` because this runs
			// from a style event as well as from the effect, and reading it must not subscribe.
			draw(m, untrack(featuresOf));
			return;
		}
		// Already there, so only the order can be wrong.
		for (const id of [FILL, LABEL]) if (m.getLayer(id)) m.moveLayer(id);
	}

	function draw(m: MaplibreMap, features: ReturnType<typeof featuresOf>) {
		const source = m.getSource(SOURCE) as GeoJSONSource | undefined;
		source?.setData({ type: 'FeatureCollection', features });
	}

	$effect(() => {
		if (!map) return;
		const m = map;
		// **Guarded, because `addSource` throws on a style that has not finished loading**, and at
		// the moment this mounts it has not. `applyMapTheme` guards the same way for the same
		// reason. Getting this wrong is silent and permanent: the throw took out the rest of this
		// effect, so the listener below was never attached and the overlay never came back.
		const restore = () => {
			if (m.isStyleLoaded()) ensure(m);
		};

		// Attached *before* the first attempt, so a throw cannot cost us the recovery. `styledata`
		// fires for a replaced style and for the first one; `load` covers the case where the style
		// was already in place before this mounted.
		m.on('styledata', restore);
		m.on('load', restore);
		restore();

		return () => {
			m.off('styledata', restore);
			m.off('load', restore);
			for (const id of [LABEL, FILL]) if (m.getLayer(id)) m.removeLayer(id);
			if (m.getSource(SOURCE)) m.removeSource(SOURCE);
		};
	});

	// Its own effect, so a tile arriving redraws the data rather than tearing the layers down and
	// building them again.
	$effect(() => {
		const features = featuresOf();
		if (!map) return;
		draw(map, features);
		// The preview's layers are added as previews finish, which puts them above this one. Raising
		// here costs nothing and keeps the overlay visible without watching for every such moment.
		if (features.length > 0) for (const id of [FILL, LABEL]) if (map.getLayer(id)) map.moveLayer(id);
	});
</script>
