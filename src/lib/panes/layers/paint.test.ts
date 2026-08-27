import { describe, expect, it } from 'vitest';
import { colourKey, colourOf, isExpression } from './paint';
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
