import { describe, expect, it } from 'vitest';
import { isVector, sourceKind } from './source-kind';

const SHORTBREAD = ['water_polygons', 'street_polygons', 'boundaries', 'place_labels'];

describe('sourceKind', () => {
	describe('what the container declares', () => {
		it('takes shortbread from the schema', () => {
			expect(sourceKind('mvt', 'shortbread@1.0', [])).toEqual({ kind: 'vectorShortbread', basis: 'declared' });
		});

		it('reads every dem encoding as elevation', () => {
			for (const schema of ['dem/mapbox', 'dem/terrarium', 'dem/versatiles']) {
				expect(sourceKind('png', schema, []).kind, schema).toBe('rasterDem');
			}
		});

		it('reads rgb and rgba as imagery', () => {
			expect(sourceKind('png', 'rgb', []).kind).toBe('rasterImage');
			expect(sourceKind('webp', 'rgba', []).kind).toBe('rasterImage');
		});

		// The declaration beats the pixels: this is the whole reason S6.1 exists. A DEM and a
		// photograph are the same PNG, and only the schema separates them.
		it('believes the schema over the format', () => {
			const dem = sourceKind('png', 'dem/mapbox', []);
			const image = sourceKind('png', 'rgb', []);
			expect([dem.kind, image.kind]).toEqual(['rasterDem', 'rasterImage']);
		});

		// A schema upstream adds must degrade to a guess, never to a confident wrong answer.
		it('falls through to inference for a schema it does not know', () => {
			expect(sourceKind('mvt', 'something@2.0', SHORTBREAD)).toEqual({
				kind: 'vectorShortbread',
				basis: 'inferred'
			});
		});
	});

	describe('what it infers when nothing is declared', () => {
		it('calls vector tiles with shortbread markers shortbread', () => {
			expect(sourceKind('mvt', null, SHORTBREAD)).toEqual({ kind: 'vectorShortbread', basis: 'inferred' });
		});

		it('calls other vector tiles other', () => {
			expect(sourceKind('mvt', null, ['places']).kind).toBe('vectorOther');
		});

		// One marker is not enough — plenty of tilesets have a `water` layer without being a basemap.
		it('needs more than one marker', () => {
			expect(sourceKind('mvt', null, ['water_polygons', 'places']).kind).toBe('vectorOther');
		});

		it('has no layers to go on when the tiles are raster', () => {
			expect(sourceKind('jpg', null, []).kind).toBe('rasterImage');
		});

		// Reading a photograph as a DEM shows hillshade of noise; reading a DEM as a photograph shows
		// its encoded colours — wrong, but recognisably a picture, next to the picker that fixes it.
		it('guesses imagery rather than elevation', () => {
			expect(sourceKind('png', null, []).kind).toBe('rasterImage');
		});
	});

	describe('what someone said explicitly', () => {
		it('beats the declaration', () => {
			expect(sourceKind('png', 'rgb', [], 'rasterDem')).toEqual({ kind: 'rasterDem', basis: 'chosen' });
		});

		it('beats the inference', () => {
			expect(sourceKind('mvt', null, SHORTBREAD, 'vectorOther')).toEqual({
				kind: 'vectorOther',
				basis: 'chosen'
			});
		});
	});

	it('separates vector from raster', () => {
		expect(['vectorShortbread', 'vectorOther'].every((k) => isVector(k as never))).toBe(true);
		expect(['rasterImage', 'rasterDem'].some((k) => isVector(k as never))).toBe(false);
	});
});
