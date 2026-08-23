<script lang="ts">
	import { untrack } from 'svelte';
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import { tiles } from '../state/tiles.svelte';
	import { token } from '../styles/tokens';
	import { role } from './theme';
	import { mapOverlay, type Overlay } from './overlay';

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

	/// The overlay, once the map exists. Held so the data effect below can redraw without rebuilding.
	let overlay = $state<Overlay | null>(null);

	$effect(() => {
		if (!map) return;
		const m = map;

		// The source, the layers, putting them back after a restyle and lifting them above whatever
		// was drawn later are all `mapOverlay`'s ([Q46]). This file had the most complete version of
		// that logic and still carried the one mistake the others copied: gating on `isStyleLoaded()`,
		// which is false while any tile is in flight — which, for an overlay about tiles in flight, is
		// precisely when it is needed.
		const mounted = mapOverlay(m, {
			source: SOURCE,
			label: 'tile activity',
			layers: () => [
				{
					id: FILL,
					type: 'fill',
					source: SOURCE,
					metadata: role('pending-fill'),
					paint: {
						'fill-color': token('--map-pending'),
						'fill-opacity': ['case', ['==', ['get', 'state'], 'rendering'], 0.4, 0.2]
					}
				},
				{
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
						'text-color': token('--map-label'),
						'text-opacity': ['case', ['==', ['get', 'state'], 'rendering'], 0.8, 0.5]
					}
				}
			],
			// `untrack`, because this is read from map events as well as from the effect below and
			// subscribing there would tie the layers' lifetime to the tiles they describe.
			data: () => ({ type: 'FeatureCollection', features: untrack(featuresOf) })
		});

		overlay = mounted;
		return () => {
			mounted.dispose();
			overlay = null;
		};
	});

	// Its own effect, so a tile arriving redraws the data rather than tearing the layers down and
	// building them again. `draw` also lifts the layers back on top, which matters here: the
	// preview's layers are added as previews finish, and this overlay has to stay above them.
	$effect(() => {
		void tiles.features;
		overlay?.draw();
	});
</script>
