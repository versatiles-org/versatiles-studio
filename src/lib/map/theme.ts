/**
 * Repainting the map when the theme changes.
 *
 * The chrome follows `prefers-color-scheme` for free, because every colour in it is a CSS token. The
 * map cannot: MapLibre paint properties are values copied into the layer when it is added, so a
 * layer created under the light theme keeps its light colours forever. Without this the map would be
 * the one part of the window that ignored the system theme.
 *
 * Layers say what they are through `metadata['studio:role']` rather than being recognised by their
 * id. Ids encode where a layer came from — a container's mount name, the grid's source — and matching
 * on them would mean this file breaking whenever a naming scheme changed somewhere else.
 *
 * See docs/styling.md.
 */

import type { AllPaintProperties } from '@maplibre/maplibre-gl-style-spec';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { token, type MapToken } from '../styles/tokens';

/** What a layer is for, as far as colour is concerned. */
export type LayerRole =
	'background' | 'grid-line' | 'grid-label' | 'container-feature' | 'pending-fill' | 'pending-line' | 'pending-label';

/**
 * Which paint properties each role takes from which token.
 *
 * Typed against MapLibre's own property names, so a renamed or misspelled property is a build error
 * rather than a colour that silently never updates.
 */
type ColourProperty = Extract<keyof AllPaintProperties, `${string}-color`>;

const PAINT: Record<LayerRole, [property: ColourProperty, token: MapToken][]> = {
	background: [['background-color', '--map-bg']],
	'grid-line': [['line-color', '--map-grid']],
	'grid-label': [
		['text-color', '--map-grid'],
		['text-halo-color', '--map-grid-halo']
	],
	'container-feature': [['line-color', '--map-feature']],
	// Two roles for one overlay, because a fill and a line take differently named properties and
	// this table is typed against MapLibre's own names (S2.16).
	'pending-fill': [['fill-color', '--map-pending']],
	'pending-line': [['line-color', '--map-pending']],
	// The halo token is named for the grid and is simply the map's halo — the colour a label needs
	// behind it to stay legible over arbitrary tiles. Two overlays want it now.
	'pending-label': [
		['text-color', '--map-pending'],
		['text-halo-color', '--map-grid-halo']
	]
};

/** Tags a layer so {@link applyMapTheme} can find it later. */
export function role(name: LayerRole): { 'studio:role': LayerRole } {
	return { 'studio:role': name };
}

/**
 * Re-reads every themed colour and applies it.
 *
 * Cheap enough to call for the whole style: this runs when the system theme flips, which is a rare
 * and deliberate act, not on every frame.
 */
export function applyMapTheme(map: MaplibreMap): void {
	// The style is not always loaded — a theme flip can land mid-load, and `getStyle` throws then.
	if (!map.isStyleLoaded()) return;

	for (const layer of map.getStyle().layers) {
		const name = (layer.metadata as { 'studio:role'?: LayerRole } | undefined)?.['studio:role'];
		if (!name) continue;
		for (const [property, key] of PAINT[name]) {
			map.setPaintProperty(layer.id, property, token(key));
		}
	}
}
