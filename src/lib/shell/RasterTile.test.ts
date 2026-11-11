import { describe, expect, it } from 'vitest';
import { metres, spell } from './RasterTile.svelte';

/** A pixel's value, written for the channels the tile has - a canvas always gives four. */
describe('spelling a pixel', () => {
	const pixel = [58, 111, 43, 200];

	it('writes colour as hex, with alpha only where the tile has one', () => {
		expect(spell(pixel, 'RGB')).toBe('#3a6f2b');
		expect(spell(pixel, 'RGBA')).toBe('#3a6f2bc8');
	});

	// A grey tile comes back from a canvas as three equal channels; the tile has one.
	it('writes grey as the one number it is', () => {
		expect(spell([128, 128, 128, 255], 'grey')).toBe('128');
		expect(spell([128, 128, 128, 7], 'grey + alpha')).toBe('128, alpha 7');
	});

	it('pads a small channel to two digits', () => {
		expect(spell([0, 5, 15, 255], 'RGB')).toBe('#00050f');
	});
});

/** The height a pixel encodes - the same formulas as the core's, which the tile's range comes from. */
describe('reading a height', () => {
	it('decodes Terrarium and Mapbox as upstream does', () => {
		expect(metres([128, 0, 0, 255], 'terrarium')).toBe(0);
		expect(metres([131, 232, 0, 255], 'terrarium')).toBe(1000);
		expect(metres([128, 0, 128, 255], 'terrarium')).toBe(0.5);
		expect(metres([1, 134, 160, 255], 'mapbox')).toBe(0);
	});

	it('reads no height from a pixel that is no data', () => {
		expect(metres([128, 0, 0, 0], 'terrarium')).toBeNull();
	});
});
