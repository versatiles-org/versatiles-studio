/**
 * Adds an opened container to a style as a vector or raster source (S1.2).
 *
 * The container reports its own format and real zoom range, so nothing here guesses.
 */

import type { Map as MaplibreMap } from 'maplibre-gl';
import type { OpenedContainer } from '../ipc/commands';
import { token } from '../styles/tokens';
import { role } from './theme';

export function addContainerToMap(map: MaplibreMap, opened: OpenedContainer): void {
	const { name, tileUrl, info } = opened;
	const vector = info.tileFormat === 'mvt';

	if (map.getSource(name)) removeContainerFromMap(map, name);

	map.addSource(name, {
		type: vector ? 'vector' : 'raster',
		tiles: [tileUrl],
		minzoom: info.minZoom,
		maxzoom: info.maxZoom,
		...(info.bbox ? { bounds: info.bbox } : {})
	});

	if (vector) {
		// Until S1.5 knows the container's layers, draw every vector layer as a hairline. Deriving a
		// real style from the layers actually present is D2, and it needs A4's introspection first.
		for (const layer of vectorLayerIds(info)) {
			map.addLayer({
				id: `${name}:${layer}`,
				type: 'line',
				source: name,
				'source-layer': layer,
				metadata: role('container-feature'),
				paint: { 'line-color': token('--map-feature'), 'line-width': 0.6, 'line-opacity': 0.8 }
			});
		}
	} else {
		map.addLayer({ id: `${name}:raster`, type: 'raster', source: name });
	}

	if (info.bbox) map.fitBounds(info.bbox, { padding: 24, duration: 0 });
}

export function removeContainerFromMap(map: MaplibreMap, name: string): void {
	for (const layer of map.getStyle().layers) {
		if (layer.id.startsWith(`${name}:`)) map.removeLayer(layer.id);
	}
	if (map.getSource(name)) map.removeSource(name);
}

/** TileJSON's `vector_layers`, which every well-formed vector container publishes. */
function vectorLayerIds(info: OpenedContainer['info']): string[] {
	const layers = info.tileJson?.vector_layers;
	if (!Array.isArray(layers)) return [];
	return layers.map((l) => (l as { id?: string }).id).filter((id): id is string => typeof id === 'string');
}
