import { describe, expect, it } from 'vitest';
import { tileForLngLat, tileToLngLat } from './tile-grid';

// Web Mercator arithmetic is easy to get subtly wrong, so these check against values that can be
// verified by hand rather than against whatever the implementation happens to produce.
describe('tileForLngLat', () => {
	it('puts the whole world in tile 0/0 at z0', () => {
		expect(tileForLngLat(0, 0, 0)).toEqual({ x: 0, y: 0 });
		expect(tileForLngLat(-179, 80, 0)).toEqual({ x: 0, y: 0 });
	});

	it('splits the world into quadrants at z1', () => {
		expect(tileForLngLat(-90, 45, 1)).toEqual({ x: 0, y: 0 }); // NW
		expect(tileForLngLat(90, 45, 1)).toEqual({ x: 1, y: 0 }); // NE
		expect(tileForLngLat(-90, -45, 1)).toEqual({ x: 0, y: 1 }); // SW
		expect(tileForLngLat(90, -45, 1)).toEqual({ x: 1, y: 1 }); // SE
	});

	it('finds the known tile for Berlin at z14', () => {
		// 52.52 N, 13.405 E — the canonical OSM slippy-map tile.
		expect(tileForLngLat(13.405, 52.52, 14)).toEqual({ x: 8802, y: 5373 });
	});

	it('clamps rather than escaping the pyramid at the edges', () => {
		const { x, y } = tileForLngLat(180, -85.05, 4);
		expect(x).toBeLessThanOrEqual(15);
		expect(y).toBeLessThanOrEqual(15);
	});
});

describe('tileToLngLat', () => {
	it('returns the north-west corner', () => {
		expect(tileToLngLat(0, 0, 0)).toEqual([-180, expect.closeTo(85.051, 2)]);
	});

	it('round-trips with tileForLngLat', () => {
		for (const z of [1, 8, 14]) {
			const tile = tileForLngLat(13.405, 52.52, z);
			const [w, n] = tileToLngLat(tile.x, tile.y, z);
			const [e, s] = tileToLngLat(tile.x + 1, tile.y + 1, z);
			// The corner the tile came from must lie inside the box it maps back to.
			expect(w).toBeLessThanOrEqual(13.405);
			expect(e).toBeGreaterThan(13.405);
			expect(s).toBeLessThanOrEqual(52.52);
			expect(n).toBeGreaterThan(52.52);
		}
	});
});
