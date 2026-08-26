/**
 * Adds an opened container to a style as a vector or raster source (S1.2).
 *
 * The container reports its own format and real zoom range, so nothing here guesses.
 */

import type { LayerSpecification, Map as MaplibreMap, SourceSpecification } from 'maplibre-gl';
import type { OpenedContainer } from '../ipc/commands';
import { token } from '../styles/tokens';
import { renderableAs } from './tile-format';
import { role } from './theme';
import { throughQueue } from './tile-queue';
import { tilesOnly } from './tile-swap';

/**
 * Which mount a layer belongs to, so removing one takes off this module's own work and nothing else.
 *
 * **Not matched by id.** A mount's name is the style's source name too ([Q32]), and a composed style
 * names its layers after it: `pipeline:raster` with one source drawn, `pipeline/pipeline:raster`
 * with several. Matching on the id therefore does both wrong things at once - it removes the
 * recipe's layer in the first case, and in the second it removes nothing and then tries to pull the
 * source out from under a layer still drawing from it, which MapLibre refuses in the console. Same
 * reason `theme.ts` tags a layer with its role rather than recognising one by name.
 */
const MOUNT = 'studio:mount';

export function addContainerToMap(
	map: MaplibreMap,
	opened: { name: string; tileUrl: string; info: OpenedContainer['info'] }
): boolean {
	const { name, tileUrl, info } = opened;
	// Only formats a map can actually draw get a layer. Treating "not mvt" as "raster" is how a
	// container of `bin` tiles produced one decode error per tile and a blank map - see
	// `tile-format.ts`.
	const kind = renderableAs(info.tileFormat);
	if (kind === null) {
		if (map.getSource(name)) removeContainerFromMap(map, name);
		return false;
	}

	const wanted = sourceFor(kind, tileUrl, info);
	// **A rebuild is the same container reading from a new revision.** Taking it off the map and
	// putting it back discards every tile on screen to fetch the same squares again - the same
	// waste `tile-swap.ts` exists for, done by hand here rather than by a style diff.
	if (swapInPlace(map, name, wanted, layerIdsFor(name, kind, info))) return true;

	if (map.getSource(name)) removeContainerFromMap(map, name);

	// A source of that name surviving the line above is one this module did not add: the style is
	// drawing the same mount, from the same graph's tiles. The layers below can sit on it - a second
	// source under a name already taken is the one thing `addSource` throws on.
	if (!map.getSource(name)) map.addSource(name, wanted);

	if (kind === 'vector') {
		// Until S1.5 knows the container's layers, draw every vector layer as a hairline. Deriving a
		// real style from the layers actually present is D2, and it needs A4's introspection first.
		for (const layer of vectorLayerIds(info)) {
			map.addLayer({
				id: `${name}:${layer}`,
				type: 'line',
				source: name,
				'source-layer': layer,
				metadata: { ...role('container-feature'), [MOUNT]: name },
				paint: { 'line-color': token('--map-feature'), 'line-width': 0.6, 'line-opacity': 0.8 }
			});
		}
	} else {
		map.addLayer({ id: `${name}:raster`, type: 'raster', source: name, metadata: { [MOUNT]: name } });
	}

	return true;
}

/** The source this module would add for a container. */
function sourceFor(kind: 'vector' | 'raster', tileUrl: string, info: OpenedContainer['info']): SourceSpecification {
	return {
		type: kind,
		// Through Studio's own queue rather than straight at the server (S2.16): it is the only place
		// that can tell a tile waiting for a slot from one the server is rendering, and the status
		// bar says which.
		tiles: [throughQueue(tileUrl)],
		minzoom: info.minZoom,
		maxzoom: info.maxZoom,
		...(info.bbox ? { bounds: info.bbox } : {})
	} as SourceSpecification;
}

/** The layers this module would add for a container, in the order it would add them. */
function layerIdsFor(name: string, kind: 'vector' | 'raster', info: OpenedContainer['info']): string[] {
	return kind === 'vector' ? vectorLayerIds(info).map((layer) => `${name}:${layer}`) : [`${name}:raster`];
}

/**
 * Points a mount this module already owns at new tiles, or reports that it cannot.
 *
 * Three things have to hold, and each of them is a way this could otherwise be wrong:
 *
 * * **The layers are ours.** A source of that name with no layers of ours on it belongs to the
 *   style, which draws the same graph's tiles from a source it added itself - and swapping that one
 *   from here would be two owners writing to it.
 * * **The layers are the same ones.** They come from the container's `vector_layers`, so a rebuild
 *   that changes which layers a pipeline produces has to add and remove them, not keep them.
 * * **Only the tiles moved on.** `minzoom`, `maxzoom` and `bounds` are on this source and none of
 *   them has a setter, so a change to any of them is a source that has to be rebuilt.
 */
function swapInPlace(map: MaplibreMap, name: string, wanted: SourceSpecification, layers: string[]): boolean {
	const source = map.getSource(name) as { setTiles?: (tiles: string[]) => void } | undefined;
	if (typeof source?.setTiles !== 'function') return false;

	// Once: serialising the style is not free, and both questions below are about the same instant.
	const style = map.getStyle();
	const ours = style.layers.filter((layer) => mountOf(layer) === name).map((layer) => layer.id);
	if (ours.length !== layers.length || ours.some((id, index) => id !== layers[index])) return false;

	const tiles = tilesOnly(style.sources?.[name], wanted);
	if (!tiles) return false;

	try {
		source.setTiles(tiles);
		return true;
	} catch {
		return false;
	}
}

/** How much of the window is left around a container's extent when framing it. */
const PADDING = 24;

/**
 * Frames a container's extent.
 *
 * **Separate from adding the source, because moving someone's camera is not a detail of that.**
 * `addContainerToMap` used to end with this, so every rebuild of the preview refit the map - and
 * the preview rebuilds on every edit to the VPL. Panning somewhere, changing a parameter and being
 * thrown back to the data's extent is the bug that separated them.
 *
 * Animated when a person asked for it and instant when the data simply appeared: a first preview
 * arriving should already be framed, not glide into place.
 */
export function fitToBounds(map: MaplibreMap, bbox: [number, number, number, number], animate = false): void {
	map.fitBounds(bbox, { padding: PADDING, duration: animate ? 400 : 0 });
}

/**
 * Takes a mount off the map: the layers added under `name` here, and the source they drew from once
 * nothing else is drawing from it.
 *
 * **The source goes only when it is free.** Removing one a layer is still using is refused - nothing
 * comes off, and the console fills with `Source "…" cannot be removed while layer "…" is using it.`
 */
export function removeContainerFromMap(map: MaplibreMap, name: string): void {
	let inUse = false;
	for (const layer of map.getStyle().layers) {
		if (mountOf(layer) === name) map.removeLayer(layer.id);
		else if ('source' in layer && layer.source === name) inUse = true;
	}
	if (!inUse && map.getSource(name)) map.removeSource(name);
}

/** The mount a layer was added for, or `undefined` for one this module did not add. */
function mountOf(layer: LayerSpecification): string | undefined {
	return (layer.metadata as { [MOUNT]?: string } | undefined)?.[MOUNT];
}

/** TileJSON's `vector_layers`, which every well-formed vector container publishes. */
function vectorLayerIds(info: OpenedContainer['info']): string[] {
	const layers = info.tileJson?.vector_layers;
	if (!Array.isArray(layers)) return [];
	return layers.map((l) => (l as { id?: string }).id).filter((id): id is string => typeof id === 'string');
}
