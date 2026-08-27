import { describe, expect, it } from 'vitest';
import { declaredLayers } from './tile-json';

/** A container's info, with only the field this reads filled in. */
const info = (tileJson: unknown) => ({ tileJson }) as never;

describe('declaredLayers', () => {
	it('reads the layer names out of the TileJSON', () => {
		expect(declaredLayers(info({ vector_layers: [{ id: 'water' }, { id: 'roads' }] }))).toEqual(['water', 'roads']);
	});

	// A raster container, one whose TileJSON says nothing, and no container at all. None of these is
	// a failure, and each was a guard a caller used to write for itself.
	it('says nothing when there is nothing to say', () => {
		expect(declaredLayers(null)).toEqual([]);
		expect(declaredLayers(undefined)).toEqual([]);
		expect(declaredLayers(info(null))).toEqual([]);
		expect(declaredLayers(info({}))).toEqual([]);
	});

	// The TileJSON is whatever the container published, so it can be malformed in the small: an
	// entry with no `id` is one layer this cannot name, not a reason to name none of them.
	it('keeps the layers it can name and drops the ones it cannot', () => {
		expect(declaredLayers(info({ vector_layers: [{ id: 'water' }, {}, { id: 42 }, { id: 'roads' }] }))).toEqual([
			'water',
			'roads'
		]);
	});

	it('refuses a `vector_layers` that is not a list', () => {
		expect(declaredLayers(info({ vector_layers: 'water,roads' }))).toEqual([]);
	});
});
