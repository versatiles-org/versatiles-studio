<script lang="ts">
	import type { Map as MaplibreMap, GeoJSONSource } from 'maplibre-gl';
	import { gridFeatures } from '../../map/tile-grid';

	// A5 — the grid follows the map's own integer zoom, so what it labels is what MapLibre requests.
	let { map, visible }: { map: MaplibreMap | undefined; visible: boolean } = $props();

	const SOURCE = 'studio:tile-grid';

	$effect(() => {
		if (!map || !visible) return;
		const m = map;

		const empty = { type: 'FeatureCollection' as const, features: [] };
		if (!m.getSource(SOURCE)) {
			m.addSource(SOURCE, { type: 'geojson', data: empty });
			m.addLayer({
				id: `${SOURCE}:lines`,
				type: 'line',
				source: SOURCE,
				paint: { 'line-color': '#0e7c7b', 'line-width': 0.7, 'line-opacity': 0.45 }
			});
			m.addLayer({
				id: `${SOURCE}:labels`,
				type: 'symbol',
				source: SOURCE,
				layout: {
					'text-field': ['get', 'label'],
					'text-font': ['noto_sans_regular'],
					'text-size': 10,
					'symbol-placement': 'point'
				},
				paint: { 'text-color': '#0e7c7b', 'text-halo-color': '#fff', 'text-halo-width': 1.2 }
			});
		}

		const refresh = () => {
			const source = m.getSource(SOURCE) as GeoJSONSource | undefined;
			source?.setData({
				type: 'FeatureCollection',
				features: gridFeatures(m.getBounds(), Math.floor(m.getZoom()))
			});
		};
		refresh();
		m.on('moveend', refresh);

		return () => {
			m.off('moveend', refresh);
			for (const id of [`${SOURCE}:labels`, `${SOURCE}:lines`]) {
				if (m.getLayer(id)) m.removeLayer(id);
			}
			if (m.getSource(SOURCE)) m.removeSource(SOURCE);
		};
	});
</script>
