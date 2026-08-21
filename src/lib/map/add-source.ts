/**
 * Adds an opened container to a style as a vector or raster source (S1.2).
 *
 * The container reports its own format and real zoom range, so nothing here guesses.
 */

import type { Map as MaplibreMap } from 'maplibre-gl';
import type { OpenedContainer } from '../ipc/commands';
import { token } from '../styles/tokens';
import { renderableAs } from './tile-format';
import { role } from './theme';
import { throughQueue } from './tile-queue';

export function addContainerToMap(
	map: MaplibreMap,
	opened: { name: string; tileUrl: string; info: OpenedContainer['info'] }
): boolean {
	const { name, tileUrl, info } = opened;
	// Only formats a map can actually draw get a layer. Treating "not mvt" as "raster" is how a
	// container of `bin` tiles produced one decode error per tile and a blank map — see
	// `tile-format.ts`.
	const kind = renderableAs(info.tileFormat);

	if (map.getSource(name)) removeContainerFromMap(map, name);
	if (kind === null) return false;

	map.addSource(name, {
		type: kind,
		// Through Studio's own queue rather than straight at the server (S2.16): it is the only
		// place that can tell a tile waiting for a slot from one the server is rendering, and the
		// status bar says which.
		tiles: [throughQueue(tileUrl)],
		minzoom: info.minZoom,
		maxzoom: info.maxZoom,
		...(info.bbox ? { bounds: info.bbox } : {})
	});

	if (kind === 'vector') {
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
	return true;
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
