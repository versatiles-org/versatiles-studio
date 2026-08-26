<script lang="ts">
	import { untrack } from 'svelte';
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import { gridFeatures } from './tile-grid';
	import { token } from '../styles/tokens';
	import { role } from './theme';
	import { mapOverlay, type Overlay } from './overlay';

	// A5 - the grid of the tiles MapLibre is actually asking for.
	//
	// **The level is handed in rather than read off the map**, because two things have to agree
	// about it: this, and the number in the control that sets it. It used to be `floor(getZoom())`
	// here and nowhere else, which is right for a 512px vector source and wrong for the other three
	// combinations - see `requestedZoom`, which is where the number now comes from.
	//
	// The source, the layers and putting them back are `mapOverlay`'s ([Q46]); what is left here is
	// what the grid *is* - which tiles are on screen, and when to ask again.
	let {
		map,
		visible,
		/** Which zoom level to draw, already resolved from the source and any nudge. */
		level
	}: { map: MaplibreMap | undefined; visible: boolean; level: number } = $props();

	const SOURCE = 'studio:tile-grid';

	/// Held so a level change redraws rather than rebuilding the overlay, the same split
	/// `TileActivity` makes: tearing the layers down and adding them again to change one number
	/// would flash the grid off and on.
	let overlay = $state<Overlay | null>(null);

	$effect(() => {
		if (!map || !visible) return;
		const m = map;

		const mounted = mapOverlay(m, {
			source: SOURCE,
			label: 'tile grid',
			layers: () => [
				{
					id: `${SOURCE}:lines`,
					type: 'line',
					source: SOURCE,
					metadata: role('grid-line'),
					paint: { 'line-color': token('--map-grid'), 'line-width': 0.7, 'line-opacity': 0.45 }
				},
				{
					id: `${SOURCE}:labels`,
					type: 'symbol',
					source: SOURCE,
					metadata: role('grid-label'),
					layout: {
						'text-field': ['get', 'label'],
						'text-font': ['noto_sans_regular'],
						'text-size': 10,
						'symbol-placement': 'point'
					},
					paint: {
						'text-color': token('--map-grid'),
						'text-halo-color': token('--map-grid-halo'),
						'text-halo-width': 1.2
					}
				}
			],
			// `untrack`, because this is read from map events as well as from the effect below;
			// subscribing here would tie the layers' lifetime to the level they happen to draw.
			data: () => ({
				type: 'FeatureCollection',
				features: gridFeatures(
					m.getBounds(),
					untrack(() => level)
				)
			})
		});

		overlay = mounted;
		const refresh = () => mounted.draw();
		m.on('moveend', refresh);

		return () => {
			m.off('moveend', refresh);
			mounted.dispose();
			overlay = null;
		};
	});

	// Its own effect, so walking a level redraws the grid rather than rebuilding it.
	$effect(() => {
		void level;
		overlay?.draw();
	});
</script>
