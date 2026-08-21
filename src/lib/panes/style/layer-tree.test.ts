import { describe, expect, it } from 'vitest';
import { colourKey, colourOf, grouped, isExpression, matching, rows } from './layer-tree';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

const STYLE = {
	version: 8,
	sources: {},
	layers: [
		{ id: 'bg', type: 'background', paint: { 'background-color': '#fff' } },
		{ id: 'water', type: 'fill', source: 's', 'source-layer': 'water', paint: { 'fill-color': '#00f' } },
		{ id: 'water-edge', type: 'line', source: 's', 'source-layer': 'water' },
		{ id: 'roads', type: 'line', source: 's', 'source-layer': 'roads' },
		{ id: 'water-label', type: 'symbol', source: 's', 'source-layer': 'water' }
	]
} as unknown as StyleSpecification;

describe('rows', () => {
	it('keeps a background, which has no tile behind it but is still worth changing', () => {
		expect(rows(STYLE)[0]).toEqual({ id: 'bg', type: 'background', source: null });
	});

	it('has nothing to show before a style exists', () => {
		expect(rows(null)).toEqual([]);
	});
});

describe('grouped', () => {
	// A style paints `water` under the roads and labels it over them. Gathering both under one
	// heading would describe a different map from the one on screen.
	it('groups consecutive runs, not every layer with the same name', () => {
		const groups = grouped(rows(STYLE));
		expect(groups.map((g) => g.source)).toEqual([null, 'water', 'roads', 'water']);
		expect(groups[1].layers.map((l) => l.id)).toEqual(['water', 'water-edge']);
	});
});

describe('matching', () => {
	it('finds a layer by its id or by the tile layer it draws', () => {
		expect(matching(rows(STYLE), 'edge').map((l) => l.id)).toEqual(['water-edge']);
		expect(matching(rows(STYLE), 'roads').map((l) => l.id)).toEqual(['roads']);
	});

	it('an empty query is everything', () => {
		expect(matching(rows(STYLE), '  ')).toHaveLength(5);
	});
});

describe('colours', () => {
	const layer = (id: string) => STYLE.layers.find((l) => l.id === id) as LayerSpecification;

	it('knows which property carries the colour for each kind of layer', () => {
		expect(colourKey('fill')).toBe('fill-color');
		expect(colourKey('symbol')).toBe('text-color');
		// A raster has no colour of its own, so the tree offers no swatch rather than a dead one.
		expect(colourKey('raster')).toBeNull();
	});

	it('reads the painted colour, and prefers an override', () => {
		expect(colourOf(layer('water'), undefined)).toBe('#00f');
		expect(colourOf(layer('water'), { 'fill-color': '#0a0' })).toBe('#0a0');
	});

	it('has no colour for a layer that was never given one', () => {
		expect(colourOf(layer('water-edge'), undefined)).toBeNull();
	});

	// A swatch showing the first branch of an interpolation would be a lie, and setting it would
	// silently delete the rest.
	it('refuses an expression rather than showing a branch of it', () => {
		const expression = { 'fill-color': ['interpolate', ['linear'], ['zoom'], 0, '#fff', 10, '#000'] };
		expect(colourOf(layer('water'), expression)).toBeNull();
		expect(isExpression(layer('water'), expression)).toBe(true);
		expect(isExpression(layer('water'), undefined)).toBe(false);
	});
});
