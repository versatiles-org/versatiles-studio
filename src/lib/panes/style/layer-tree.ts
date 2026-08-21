/**
 * What the layer tree shows, apart from the component that draws it (S4.5, D3).
 *
 * A generated style is long — `colorful` is 324 layers — and the list is only usable if it is
 * grouped and filterable. Both are decisions with answers worth asserting, so they live here.
 */

import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

/** One row of the tree. */
export interface StyleLayer {
	id: string;
	type: string;
	/** The tile layer it draws, or `null` for a background. */
	source: string | null;
}

/** Layers that draw the same tile layer, in the order the style paints them. */
export interface LayerGroup {
	source: string | null;
	layers: StyleLayer[];
}

/**
 * The style's layers as rows.
 *
 * Background layers keep a `null` source rather than being dropped: a style's background is a thing
 * people want to change, and it is the one layer with no tile behind it.
 */
export function rows(style: StyleSpecification | null): StyleLayer[] {
	if (!style) return [];
	return style.layers.map((layer) => ({
		id: layer.id,
		type: layer.type,
		source: 'source-layer' in layer ? ((layer['source-layer'] as string) ?? null) : null
	}));
}

/**
 * Rows grouped by the tile layer they draw.
 *
 * **Runs, not buckets**, the same rule the picker uses: a style paints `water` twice, once under the
 * roads and once over them, and gathering both under one heading would move one of them. Grouping
 * has to preserve paint order or the tree describes a different map from the one on screen.
 */
export function grouped(layers: StyleLayer[]): LayerGroup[] {
	const out: LayerGroup[] = [];
	for (const layer of layers) {
		const last = out.at(-1);
		if (last && last.source === layer.source) last.layers.push(layer);
		else out.push({ source: layer.source, layers: [layer] });
	}
	return out;
}

/** Rows whose id or tile layer contains `query`, case-insensitively. */
export function matching(layers: StyleLayer[], query: string): StyleLayer[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return layers;
	return layers.filter((layer) => `${layer.id} ${layer.source ?? ''}`.toLowerCase().includes(needle));
}

/**
 * The paint property that carries a layer's main colour.
 *
 * One per layer type, because that is how MapLibre names them — there is no generic `color`. A type
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
 * **Only a plain colour.** A paint property may be an expression — `["interpolate", …]` is how a
 * road changes width with zoom — and a swatch showing the first branch of one would be a lie, while
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
