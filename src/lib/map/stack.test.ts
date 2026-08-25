import { describe, expect, it } from 'vitest';
import { drawOrder, drawn, entryFor, stackFor } from './stack';
import type { Preview, Recipe } from '../ipc/commands';

const BASE = 'http://127.0.0.1:8080';
const SHORTBREAD = ['water_polygons', 'street_polygons', 'boundaries'];

function built(name: string, over: Record<string, unknown> = {}): Preview {
	return {
		name,
		tileUrl: `${BASE}/tiles/${name}/{z}/{x}/{y}`,
		layers: [{ name: 'places', geometry: 'point' }],
		info: {
			tileFormat: 'mvt',
			tileSchema: null,
			tileJson: { vector_layers: SHORTBREAD.map((id) => ({ id })) },
			...(over.info as object)
		},
		...over
	} as unknown as Preview;
}

function recipe(over: Partial<Recipe> = {}): Recipe {
	return { sources: {}, order: [], ...over } as Recipe;
}

describe('entryFor', () => {
	it('draws an unstyled source as a preset rather than as nothing', () => {
		const entry = entryFor(built('places'), recipe());
		expect(entry.appearance.type).toBe('vector');
		expect(entry.kind).toBe('vectorShortbread');
	});

	it('takes the appearance the recipe stored for that name', () => {
		const entry = entryFor(
			built('photo'),
			recipe({ sources: { photo: { kind: 'rasterImage', appearance: { type: 'raster', adjust: {} } } } } as never)
		);
		expect(entry.appearance.type).toBe('raster');
		expect(entry.kind).toBe('rasterImage');
	});

	it('carries the schema through, which is what a DEM needs', () => {
		const entry = entryFor(built('terrain', { info: { tileFormat: 'png', tileSchema: 'dem/mapbox' } }), recipe());
		expect(entry.tileSchema).toBe('dem/mapbox');
		expect(entry.kind).toBe('rasterDem');
	});
});

describe('drawOrder', () => {
	it('puts what the order names first, then the rest by name', () => {
		const order = drawOrder(recipe({ order: ['basemap'] }), { places: built('places'), basemap: built('basemap') });
		expect(order).toEqual(['basemap', 'places']);
	});

	// `order` is a preference, not a register - the same two rules the core's `draw_order` applies.
	it('ignores a name nothing built, and never hides one that was', () => {
		const order = drawOrder(recipe({ order: ['gone', 'basemap'] }), { basemap: built('basemap'), late: built('late') });
		expect(order).toEqual(['basemap', 'late']);
	});

	it('is stable when the order says nothing', () => {
		expect(drawOrder(recipe(), { zebra: built('zebra'), alpha: built('alpha') })).toEqual(['alpha', 'zebra']);
	});
});

describe('stackFor', () => {
	const background = { version: 8, sources: { osm: { type: 'raster', tiles: ['x'] } }, layers: [] } as never;

	it('draws nothing before the server is up', () => {
		expect(stackFor({ recipe: recipe(), built: {}, pinned: null, serverUrl: null, background })).toEqual({
			style: null,
			bases: []
		});
	});

	// The regression that started all of this: the background was reachable only when nothing else
	// drew, and S6.2 made something almost always draw.
	it('draws the background even when a source draws too', () => {
		const { style } = stackFor({
			recipe: recipe(),
			built: { places: built('places') },
			pinned: null,
			serverUrl: BASE,
			background
		});
		expect(Object.keys(style!.sources)).toContain('background');
	});

	it('draws the background before any recipe has arrived', () => {
		const { style } = stackFor({ recipe: null, built: {}, pinned: null, serverUrl: BASE, background });
		expect(style).not.toBeNull();
	});

	// A pin is a question about one step of one graph; the rest of the project is not the answer.
	it('shows only the pinned node', () => {
		const { style, bases } = stackFor({
			recipe: recipe(),
			built: { a: built('a'), b: built('b') },
			pinned: built('a'),
			serverUrl: BASE,
			background
		});
		// `bases` is one row per *entry* - the background is context rather than a source anyone
		// lists or reorders, so it draws without appearing here.
		expect(bases.map((entry) => entry.name)).toEqual(['a']);
		expect(Object.keys(style!.sources)).toContain('background');
	});
});

describe('drawn', () => {
	const composed = { style: null, bases: [{ name: 'places', basis: 'preset' as const }] };

	it('is true only for a source that drew', () => {
		expect(drawn(composed, 'places')).toBe(true);
		expect(drawn(composed, 'missing')).toBe(false);
		expect(drawn(composed, null)).toBe(false);
	});

	// The hairlines exist to show pipeline output nothing else draws. With a background on, the map
	// has a style while the source itself drew nothing - which is exactly when the hairlines are
	// wanted, and exactly when `styled !== null` would have hidden them.
	it('is false for a source that drew nothing, whatever else is on the map', () => {
		const notDrawn = { style: {} as never, bases: [{ name: 'places', basis: 'none' as const }] };
		expect(notDrawn.style).not.toBeNull();
		expect(drawn(notDrawn, 'places')).toBe(false);
	});
});
