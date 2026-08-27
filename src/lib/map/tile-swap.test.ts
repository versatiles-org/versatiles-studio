/**
 * Deciding whether a change is nothing but tile URLs, and pointing the sources at them.
 *
 * **The rule is asymmetric on purpose.** Calling a real change a tile swap would leave the map
 * showing something nobody asked for; calling a tile swap a real change costs a flash and nothing
 * else. So every case below that is not *certainly* a swap is expected to be `full`, including the
 * ones that look harmless.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';
import { planSwap, swapTiles } from './tile-swap';

/** A style with one vector source and one layer reading from it. */
function style(
	options: {
		tiles?: string;
		layer?: string;
		sprite?: string;
		source?: Record<string, unknown>;
		extra?: Record<string, unknown>;
	} = {}
): StyleSpecification {
	const { tiles = 'studio://host/tiles/basemap/{z}/{x}/{y}?v=1', layer = 'basemap:water', sprite } = options;
	return {
		version: 8,
		...(sprite ? { sprite } : {}),
		sources: { basemap: options.source ?? { type: 'vector', tiles: [tiles] } },
		layers: [{ id: layer, type: 'line', source: 'basemap', 'source-layer': 'water' }],
		...options.extra
	} as unknown as StyleSpecification;
}

/** The same graph, rebuilt: one revision further on. */
const rebuilt = style({ tiles: 'studio://host/tiles/basemap/{z}/{x}/{y}?v=2' });

describe('planning', () => {
	// Nothing is on the map yet, so there is nothing to swap into.
	it('is full for the first style', () => {
		expect(planSwap(null, style())).toEqual({ kind: 'full' });
	});

	// Not `tiles` with an empty list: a style that changes nothing must not reach `setStyle`, whose
	// diff applies nothing and then announces nothing - see `restyle.ts`.
	it('is nothing when the style has not changed', () => {
		expect(planSwap(style(), style())).toEqual({ kind: 'none' });
	});

	// The case this exists for: a rebuilt graph, same sources and layers, new revision in the URL.
	it('is a tile swap when only a source URL moved on', () => {
		expect(planSwap(style(), rebuilt)).toEqual({
			kind: 'tiles',
			updates: [{ source: 'basemap', tiles: ['studio://host/tiles/basemap/{z}/{x}/{y}?v=2'] }]
		});
	});

	it('swaps only the sources that moved on', () => {
		const before = {
			...style(),
			sources: {
				basemap: { type: 'vector', tiles: ['a?v=1'] },
				hillshade: { type: 'raster-dem', tiles: ['b?v=1'], encoding: 'terrarium' }
			}
		} as StyleSpecification;
		const after = {
			...before,
			sources: { ...before.sources, hillshade: { type: 'raster-dem', tiles: ['b?v=2'], encoding: 'terrarium' } }
		} as StyleSpecification;

		expect(planSwap(before, after)).toEqual({
			kind: 'tiles',
			updates: [{ source: 'hillshade', tiles: ['b?v=2'] }]
		});
	});

	// A pipeline change that alters which layers a graph produces arrives as both at once, and the
	// layers are what `setStyle` is for.
	it('is full when a layer changed as well', () => {
		const next = { ...rebuilt, layers: [{ ...rebuilt.layers[0], id: 'basemap:roads' }] } as StyleSpecification;
		expect(planSwap(style(), next)).toEqual({ kind: 'full' });
	});

	// Full *from here*: a reorder is `reorder.ts`'s, which `restyle.ts` asks after this declines.
	it('is full when the layers were only reordered', () => {
		const two = {
			...style(),
			layers: [
				{ id: 'a', type: 'background' },
				{ id: 'b', type: 'background' }
			]
		} as StyleSpecification;
		const swapped = { ...two, layers: [two.layers[1], two.layers[0]] } as StyleSpecification;

		expect(planSwap(two, swapped)).toEqual({ kind: 'full' });
	});

	it('is full when a source arrives or leaves', () => {
		const two = {
			...style(),
			sources: { ...style().sources, extra: { type: 'vector', tiles: ['x'] } }
		} as StyleSpecification;

		expect(planSwap(style(), two), 'a graph switched on').toEqual({ kind: 'full' });
		expect(planSwap(two, style()), 'a graph switched off').toEqual({ kind: 'full' });
	});

	// **The reason every field is compared rather than the ones anybody listed.** None of these has
	// a setter, so a swap would leave the source on the map claiming something it no longer says.
	it('is full when a source changed anything besides its tiles', () => {
		const before = style({ source: { type: 'raster-dem', tiles: ['a?v=1'], encoding: 'terrarium' } });
		const after = style({ source: { type: 'raster-dem', tiles: ['a?v=2'], encoding: 'mapbox' } });
		expect(planSwap(before, after), 'the encoding changed too').toEqual({ kind: 'full' });

		const zoomed = style({ source: { type: 'vector', tiles: ['a?v=1'], maxzoom: 14 } });
		expect(planSwap(style({ source: { type: 'vector', tiles: ['a?v=1'] } }), zoomed)).toEqual({ kind: 'full' });
	});

	it('is full when the style itself changed around them', () => {
		expect(planSwap(style(), style({ sprite: 'http://host/sprites' })), 'a sprite arrived').toEqual({
			kind: 'full'
		});
		// A field this module has never heard of is a reason to take the slow path, not to ignore it.
		expect(planSwap(style(), style({ extra: { sky: { 'sky-color': '#fff' } } }))).toEqual({ kind: 'full' });
	});

	// A GeoJSON source is the one MapLibre's own diff can already update in place, and it has no
	// tiles to swap.
	it('is full for a source with no tiles to point anywhere', () => {
		const before = style({ source: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } });
		const after = style({ source: { type: 'geojson', data: { type: 'FeatureCollection', features: [1] } } });
		expect(planSwap(before, after)).toEqual({ kind: 'full' });
	});
});

/** A map whose sources remember what they were pointed at. */
function fakeMap(sources: Record<string, { setTiles?: (tiles: string[]) => void }>) {
	return { getSource: (id: string) => sources[id] } as unknown as MaplibreMap;
}

describe('swapping', () => {
	it('points each source at its new tiles', () => {
		const basemap = vi.fn();
		const hillshade = vi.fn();
		const map = fakeMap({ basemap: { setTiles: basemap }, hillshade: { setTiles: hillshade } });

		const done = swapTiles(map, [
			{ source: 'basemap', tiles: ['a?v=2'] },
			{ source: 'hillshade', tiles: ['b?v=2'] }
		]);

		expect(done).toBe(true);
		expect(basemap).toHaveBeenCalledWith(['a?v=2']);
		expect(hillshade).toHaveBeenCalledWith(['b?v=2']);
	});

	// **Checked before applied.** Refusing halfway would leave the map half-changed, and the caller's
	// fallback is a whole style - which describes the end state, not the difference from it.
	it('changes nothing at all when one of the sources is not there', () => {
		const basemap = vi.fn();
		const map = fakeMap({ basemap: { setTiles: basemap } });

		const done = swapTiles(map, [
			{ source: 'basemap', tiles: ['a?v=2'] },
			{ source: 'gone', tiles: ['b?v=2'] }
		]);

		expect(done).toBe(false);
		expect(basemap, 'the one that was there is untouched').not.toHaveBeenCalled();
	});

	it('refuses a source that cannot be pointed anywhere', () => {
		// A GeoJSON source has no `setTiles`; asking it would be a `TypeError` on the map.
		expect(swapTiles(fakeMap({ overlay: {} }), [{ source: 'overlay', tiles: ['a'] }])).toBe(false);
	});

	it('reports a refusal from the map rather than letting it escape', () => {
		const map = fakeMap({
			basemap: {
				setTiles: () => {
					throw new Error('no');
				}
			}
		});

		expect(swapTiles(map, [{ source: 'basemap', tiles: ['a?v=2'] }])).toBe(false);
	});
});
