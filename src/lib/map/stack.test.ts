import { describe, expect, it } from 'vitest';
import { drawableLayers, drawOrder, drawn, entryFor, stackFor } from './stack';
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
		const order = drawOrder(recipe({ order: [{ source: 'basemap', from: null }] }), {
			places: built('places'),
			basemap: built('basemap')
		});
		expect(order).toEqual(['basemap', 'places']);
	});

	// `order` is a preference, not a register - the same two rules the core's `draw_order` applies.
	it('ignores a name nothing built, and never hides one that was', () => {
		const order = drawOrder(
			recipe({
				order: [
					{ source: 'gone', from: null },
					{ source: 'basemap', from: null }
				]
			}),
			{ basemap: built('basemap'), late: built('late') }
		);
		expect(order).toEqual(['basemap', 'late']);
	});

	it('is stable when the order says nothing', () => {
		expect(drawOrder(recipe(), { zebra: built('zebra'), alpha: built('alpha') })).toEqual(['alpha', 'zebra']);
	});
});

describe('stackFor', () => {
	const background = { version: 8, sources: { osm: { type: 'raster', tiles: ['x'] } }, layers: [] } as never;

	it('draws nothing before the server is up', () => {
		expect(stackFor({ recipe: recipe(), built: {}, serverUrl: null, background })).toEqual({
			style: null,
			bases: [],
			rows: []
		});
	});

	// The regression that started all of this: the background was reachable only when nothing else
	// drew, and S6.2 made something almost always draw.
	it('draws the background even when a source draws too', () => {
		const { style } = stackFor({
			recipe: recipe(),
			built: { places: built('places') },
			serverUrl: BASE,
			background
		});
		expect(Object.keys(style!.sources)).toContain('background');
	});

	it('draws the background before any recipe has arrived', () => {
		const { style } = stackFor({ recipe: null, built: {}, serverUrl: BASE, background });
		expect(style).not.toBeNull();
	});

	/// **Every graph that has tiles, and no second mode** ([Q49]).
	///
	/// A pinned node used to replace the stack with itself, which drew one step of one graph and hid
	/// the rest of the project. It also decided what a *save* wrote: `styleText` serialises what
	/// this returns, so saving while something was pinned wrote a `style.json` naming one source.
	/// Switching a source off now means it is not in `built` at all, which is the same fact in one
	/// place instead of two.
	it('draws every source that has tiles', () => {
		const { style, bases } = stackFor({
			recipe: recipe(),
			built: { a: built('a'), b: built('b') },
			serverUrl: BASE,
			background
		});
		// `bases` is one row per *entry* - the background is context rather than a source anyone
		// lists or reorders, so it draws without appearing here.
		expect(bases.map((entry) => entry.name)).toEqual(['a', 'b']);
		expect(Object.keys(style!.sources)).toContain('background');
	});

	/// What a switched-off graph looks like from here: absent, because nothing built it.
	it('draws nothing for a source with no tiles', () => {
		const { bases } = stackFor({
			recipe: recipe(),
			built: { a: built('a') },
			serverUrl: BASE,
			background
		});
		expect(bases.map((entry) => entry.name)).toEqual(['a']);
	});
});

describe('drawn', () => {
	const composed = { style: null, bases: [{ name: 'places', basis: 'preset' as const, style: null }], rows: [] };

	it('is true only for a source that drew', () => {
		expect(drawn(composed, 'places')).toBe(true);
		expect(drawn(composed, 'missing')).toBe(false);
		expect(drawn(composed, null)).toBe(false);
	});

	// The hairlines exist to show pipeline output nothing else draws. With a background on, the map
	// has a style while the source itself drew nothing - which is exactly when the hairlines are
	// wanted, and exactly when `styled !== null` would have hidden them.
	it('is false for a source that drew nothing, whatever else is on the map', () => {
		const notDrawn = { style: {} as never, bases: [{ name: 'places', basis: 'none' as const, style: null }], rows: [] };
		expect(notDrawn.style).not.toBeNull();
		expect(drawn(notDrawn, 'places')).toBe(false);
	});
});

/**
 * **Every layer the source has, not the ones a probe happened to see.**
 *
 * `probe_layers` decodes one tile - the middle of the bounds at the source's *lowest* zoom, which is
 * the emptiest tile in the pyramid. A basemap declaring 34 layers has two at z0, so the derived
 * style drew two hairlines and the layer tree listed two, for a source with 34. The report itself is
 * honest (the export dialog shows its counts); using it as the list of what exists is what was
 * wrong.
 */
describe('which layers a derived style is given', () => {
	const DECLARED = ['Gewaesserflaeche', 'Grenze_Linie', 'Name_Punkt', 'Verkehrslinie'];

	/** A source whose TileJSON declares four layers and whose sampled tile held one. */
	const basemap = () =>
		built('basemap', {
			layers: [{ name: 'Grenze_Linie', geometry: 'line' }],
			info: { tileFormat: 'mvt', tileSchema: null, tileJson: { vector_layers: DECLARED.map((id) => ({ id })) } }
		});

	it('is every layer the container declares', () => {
		expect(drawableLayers(basemap()).map((layer) => layer.name)).toEqual(DECLARED);
	});

	// The sample is still the only thing that knows what a layer is made of.
	it('keeps the geometry of the layers the probe did see', () => {
		const drawn = drawableLayers(basemap());
		expect(drawn.find((layer) => layer.name === 'Grenze_Linie')?.geometry).toBe('line');
	});

	// A hairline is the right thing to draw for a layer nobody has looked at yet - and `unknown` is
	// what `deriveStyle` turns into one.
	it('leaves the rest unknown rather than guessing', () => {
		const drawn = drawableLayers(basemap());
		expect(drawn.find((layer) => layer.name === 'Name_Punkt')?.geometry).toBe('unknown');
	});

	// A pipeline that builds its own tiles has no TileJSON to declare anything, and then the probe
	// is all there is.
	it('falls back to the probe when nothing is declared', () => {
		const home = built('csv', {
			layers: [{ name: 'points', geometry: 'point' }],
			info: { tileFormat: 'mvt', tileSchema: null, tileJson: {} }
		});
		expect(drawableLayers(home)).toEqual([{ name: 'points', geometry: 'point' }]);
	});

	/**
	 * The end of it, and the assertion worth keeping: what reaches the map draws every layer the
	 * source said it has. Everything above is how; this is what.
	 */
	it('ends with a layer on the map for every layer the source has', () => {
		const { style } = stackFor({
			recipe: recipe({
				sources: {
					basemap: { kind: null, appearance: { type: 'vector', preset: 'derived', recolor: {}, overrides: {} } }
				}
			} as never),
			built: { basemap: basemap() },
			serverUrl: BASE,
			background: null
		});

		const drawnFrom = new Set(
			style!.layers
				.map((layer) => (layer as { 'source-layer'?: string })['source-layer'])
				.filter((name): name is string => typeof name === 'string')
		);
		expect([...drawnFrom].sort()).toEqual([...DECLARED].sort());
	});
});
