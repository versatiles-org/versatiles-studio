/**
 * A layer's colour, and which paint property carries it (D3).
 *
 * Split out of the old `layer-tree.ts` when the tree became project-wide: what a row *shows* about
 * one layer outlived the grouping rules around it, which `panes/layers/tree.ts` answers now.
 */

import type { LayerSpecification } from 'maplibre-gl';

/**
 * The paint property that carries a layer's main colour.
 *
 * One per layer type, because that is how MapLibre names them - there is no generic `color`. A type
 * with no colour of its own (`raster`, `hillshade`) returns `null`, and the tree offers no swatch
 * rather than one that would do nothing.
 */
export function colourKey(type: string): string | null {
	switch (type) {
		case 'fill':
			return 'fill-color';
		case 'line':
			return 'line-color';
		case 'circle':
			return 'circle-color';
		case 'symbol':
			return 'text-color';
		case 'background':
			return 'background-color';
		case 'fill-extrusion':
			return 'fill-extrusion-color';
		default:
			return null;
	}
}

/**
 * A layer's current colour, or `null` when it has none this can edit.
 *
 * **Only a plain colour.** A paint property may be an expression - `["interpolate", …]` is how a
 * road changes width with zoom - and a swatch showing the first branch of one would be a lie, while
 * setting it would silently delete the rest. Those say so instead, and stay for the expression
 * editor.
 */
export function colourOf(layer: LayerSpecification, override: unknown): string | null {
	const key = colourKey(layer.type);
	if (!key) return null;
	const patched = (override as Record<string, unknown> | undefined)?.[key];
	const painted = (layer as { paint?: Record<string, unknown> }).paint?.[key];
	const value = patched ?? painted;
	return typeof value === 'string' ? value : null;
}

/** Whether a layer's colour is an expression, which this cannot edit but must not hide. */
export function isExpression(layer: LayerSpecification, override: unknown): boolean {
	const key = colourKey(layer.type);
	if (!key) return false;
	const value =
		(override as Record<string, unknown> | undefined)?.[key] ??
		(layer as { paint?: Record<string, unknown> }).paint?.[key];
	return value !== undefined && typeof value !== 'string';
}
