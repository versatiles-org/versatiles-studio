<script lang="ts">
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import { gridFeatures } from './tile-grid';
	import { token } from '../styles/tokens';
	import { role } from './theme';
	import { mapOverlay } from './overlay';

	// A5 — the grid follows the map's own integer zoom, so what it labels is what MapLibre requests.
	//
	// The source, the layers and putting them back are `mapOverlay`'s ([Q46]); what is left here is
	// what the grid *is* — which tiles are on screen, and when to ask again.
	let { map, visible }: { map: MaplibreMap | undefined; visible: boolean } = $props();

	const SOURCE = 'studio:tile-grid';

	$effect(() => {
		if (!map || !visible) return;
		const m = map;

		const overlay = mapOverlay(m, {
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
			data: () => ({
				type: 'FeatureCollection',
				features: gridFeatures(m.getBounds(), Math.floor(m.getZoom()))
			})
		});

		overlay.draw();
		const refresh = () => overlay.draw();
		m.on('moveend', refresh);

		return () => {
			m.off('moveend', refresh);
			overlay.dispose();
		};
	});
</script>
