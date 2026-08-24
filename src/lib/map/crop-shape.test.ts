import { describe, expect, it } from 'vitest';
import { MERCATOR_LIMIT, boxBetween, isRectangle, outside, rectangle, type BBox } from './crop-shape';

const BERLIN: BBox = [13.0, 52.3, 13.8, 52.7];

const ringsOf = (fc: ReturnType<typeof rectangle>) => fc.features[0].geometry.coordinates;

describe('rectangle', () => {
	it('is one closed ring of the box itself', () => {
		const [ring] = ringsOf(rectangle(BERLIN));
		expect(ringsOf(rectangle(BERLIN))).toHaveLength(1);
		expect(ring).toHaveLength(5);
		expect(ring[0]).toEqual(ring[4]);
	});

	it('covers exactly the corners it was given', () => {
		const [ring] = ringsOf(rectangle(BERLIN));
		expect(ring.map(([lng]) => lng).sort()).toEqual([13, 13, 13, 13.8, 13.8]);
		expect(new Set(ring.map(([, lat]) => lat))).toEqual(new Set([52.3, 52.7]));
	});
});

describe('outside', () => {
	// One polygon with a hole does both jobs — the fill dims, the line traces. Two shapes could be
	// drawn out of step with each other; one cannot.
	it('is the world with the crop as a hole in it', () => {
		const rings = ringsOf(outside(BERLIN));
		expect(rings).toHaveLength(2);
		expect(rings[1]).toEqual(ringsOf(rectangle(BERLIN))[0]);
	});

	// Beyond the Web Mercator limit there is no map to dim, and a polygon reaching ±90 projects to
	// infinity — which MapLibre draws as nothing at all.
	it('stops the dimming at the Mercator limit, not the pole', () => {
		const [world] = ringsOf(outside(BERLIN));
		const lats = world.map(([, lat]) => Math.abs(lat));
		expect(Math.max(...lats)).toBe(MERCATOR_LIMIT);
		expect(Math.max(...lats)).toBeLessThan(90);
	});

	it('spans the whole world east to west', () => {
		const [world] = ringsOf(outside(BERLIN));
		expect(new Set(world.map(([lng]) => lng))).toEqual(new Set([-180, 180]));
	});
});

describe('boxBetween', () => {
	it('reads west, south, east, north whichever way the drag went', () => {
		const downRight = boxBetween({ lng: 13.0, lat: 52.7 }, { lng: 13.8, lat: 52.3 });
		const upLeft = boxBetween({ lng: 13.8, lat: 52.3 }, { lng: 13.0, lat: 52.7 });
		expect(downRight).toEqual(BERLIN);
		expect(upLeft).toEqual(BERLIN);
	});

	it('survives a drag across the equator and the meridian', () => {
		expect(boxBetween({ lng: 5, lat: 5 }, { lng: -5, lat: -5 })).toEqual([-5, -5, 5, 5]);
	});
});

describe('isRectangle', () => {
	it('accepts a box with area', () => {
		expect(isRectangle(BERLIN)).toBe(true);
	});

	// A click must not read as an empty selection: it would clear the crop someone was only trying
	// to look at, and clicking again does not bring it back.
	it('refuses a click, and a drag along one axis only', () => {
		expect(isRectangle([13, 52.3, 13, 52.7])).toBe(false);
		expect(isRectangle([13, 52.3, 13.8, 52.3])).toBe(false);
		expect(isRectangle([13, 52.3, 13, 52.3])).toBe(false);
	});
});
