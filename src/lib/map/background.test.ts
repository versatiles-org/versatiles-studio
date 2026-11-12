import { describe, expect, it } from 'vitest';
import { BACKGROUNDS, backgroundOf, buildBackground, hasLabels } from './background';
import { BACKGROUND, composeStyle, ON_TOP } from './style';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';

const SERVER = 'http://127.0.0.1:1234';

describe('buildBackground', () => {
	it('builds nothing for none', async () => {
		expect(await buildBackground('none', SERVER)).toBeNull();
	});

	/**
	 * The point of generating rather than fetching a hosted style: only the tiles are remote. A
	 * hosted style brings its own sprite and glyph URLs, so every font and icon would be fetched
	 * from the network too.
	 */
	it('takes tiles from the network and assets from our own server', async () => {
		for (const { id } of BACKGROUNDS.filter((b) => b.id !== 'none')) {
			const style = await buildBackground(id, SERVER);
			expect(style, id).not.toBeNull();

			expect(style!.glyphs, id).toContain(SERVER);
			expect(JSON.stringify(style!.sprite), id).toContain(SERVER);

			const tiles = Object.values(style!.sources).flatMap((source) =>
				'tiles' in source && source.tiles ? source.tiles : []
			);
			expect(tiles.length, id).toBeGreaterThan(0);
			expect(
				tiles.every((url) => url.startsWith('https://tiles.versatiles.org/')),
				id
			).toBe(true);
		}
	});

	it('produces a style with layers to draw', async () => {
		const style = await buildBackground('colorful', SERVER);
		expect(style!.layers.length).toBeGreaterThan(100);
	});

	it('gives satellite a raster source, and a layer that draws it', async () => {
		const style = await buildBackground('satellite', SERVER);
		const raster = Object.entries(style!.sources).filter(([, source]) => source.type === 'raster');
		expect(raster).toHaveLength(1);
		expect(style!.layers.some((layer) => 'source' in layer && layer.source === raster[0][0])).toBe(true);
		// The tiles themselves, not only the document listing them: tiles.versatiles.org publishes
		// them relative to its host, and MapLibre would resolve that against Studio's own page.
		const imagery = raster[0][1] as { url?: string; tiles?: string[] };
		expect(imagery.url).toBeUndefined();
		expect(imagery.tiles?.[0]).toMatch(/^https:\/\/tiles\.versatiles\.org\//);
	});
});

/**
 * **Every choice in the menu, checked the same way.** Most are one vector source and a pile of
 * layers, so anything that held for one held for all - and satellite, the only one built from two
 * sources, was the only one nobody's assumptions fitted.
 */
describe('every background', () => {
	const chosen = BACKGROUNDS.filter((background) => background.id !== 'none');

	it('is a style MapLibre will accept', async () => {
		for (const { id } of chosen) {
			const style = await buildBackground(id, SERVER);
			expect(validateStyleMin(style!), id).toEqual([]);
		}
	});

	it('has something to draw', async () => {
		for (const { id } of chosen) {
			const style = await buildBackground(id, SERVER);
			expect(style!.layers.length, id).toBeGreaterThan(0);
		}
	});

	// A layer naming a source the style does not have draws nothing and says nothing about why.
	it('draws only from sources it declares', async () => {
		for (const { id } of chosen) {
			const style = await buildBackground(id, SERVER);
			const orphans = style!.layers.filter((layer) => 'source' in layer && !(layer.source in style!.sources));
			expect(
				orphans.map((layer) => layer.id),
				id
			).toEqual([]);
		}
	});

	/**
	 * The one that mattered: the map draws the *composed* style, and composing kept one source per
	 * style it merged. Satellite has two, so its imagery was dropped on the way to the map and the
	 * layer drawing it was left pointing at nothing - the background simply did not appear.
	 *
	 * Checked with and without a pipeline on the map, because the two take different paths: layer and
	 * source ids are prefixed only once more than one thing draws.
	 */
	it('still draws from its own sources once it is composed onto the map', async () => {
		const entry = {
			name: 'berlin',
			tileUrl: `${SERVER}/tiles/berlin/{z}/{x}/{y}`,
			appearance: { type: 'vector', theme: 'colorful', recolor: {}, overrides: {} },
			kind: 'vectorShortbread',
			tileFormat: 'mvt',
			layers: [{ name: 'places', geometry: 'point' }],
			mountedLayers: ['water_polygons']
		} as never;

		for (const { id } of chosen) {
			const background = await buildBackground(id, SERVER);
			for (const entries of [[], [entry]]) {
				const { style } = composeStyle(entries, SERVER, background);
				const where = `${id}, ${entries.length} entries`;
				const orphans = style!.layers.filter((layer) => 'source' in layer && !(layer.source in style!.sources));
				expect(
					orphans.map((layer) => layer.id),
					where
				).toEqual([]);
				// Renaming a source is only safe if what comes out is still a style.
				expect(validateStyleMin(style!), where).toEqual([]);
			}
		}
	});

	// Dropping one is how the imagery went missing; keeping them is the fix, so it is asserted
	// rather than left to follow from the check above.
	it('keeps every source it was built with', async () => {
		for (const { id } of chosen) {
			const background = await buildBackground(id, SERVER);
			const { style } = composeStyle([], SERVER, background);
			expect(Object.keys(style!.sources).length, id).toBe(Object.keys(background!.sources).length);
		}
	});
});

describe('backgroundOf', () => {
	/** A persisted value from an older build must not be able to break the map. */
	it('accepts only ids we know, and falls back to none', () => {
		for (const { id } of BACKGROUNDS) expect(backgroundOf(id), id).toBe(id);
		for (const value of ['terrain', '', null, 42, undefined]) expect(backgroundOf(value)).toBe('none');
	});

	// The four v5 names an earlier build stored, read as what they became - by character, so the
	// quiet grey one stays quiet rather than becoming the washed-out `gray`.
	it('reads the ids an earlier build stored as what they became', () => {
		expect(['neutrino', 'graybeard', 'shadow', 'eclipse'].map(backgroundOf)).toEqual([
			'muted',
			'positrino',
			'positrino-dark',
			'colorful-dark'
		]);
	});
});

describe('the labels switch', () => {
	const symbols = (style: { layers: { type: string }[] } | null) =>
		style!.layers.filter((layer) => layer.type === 'symbol').length;

	it('takes the labels off a map, and leaves the rest', async () => {
		const withLabels = await buildBackground('positrino', SERVER);
		const without = await buildBackground('positrino', SERVER, false);
		expect(symbols(without)).toBeLessThan(symbols(withLabels));
		expect(without!.layers.some((layer) => layer.id.startsWith('label-'))).toBe(false);
		expect(without!.layers.some((layer) => layer.type === 'fill')).toBe(true);
	});

	it('takes them off the satellite overlay too', async () => {
		const without = await buildBackground('satellite', SERVER, false);
		expect(without!.layers.some((layer) => layer.id.startsWith('label-'))).toBe(false);
		expect(without!.layers.some((layer) => layer.type === 'raster')).toBe(true);
	});

	// The background lies under the stack, so its names lay under the data and were covered by it.
	describe('lifts the labels over everything', () => {
		const lifted = (style: { layers: { id: string; metadata?: unknown }[] }) =>
			style.layers.filter((layer) => (layer.metadata as Record<string, unknown> | undefined)?.[ON_TOP]);

		it('marks exactly what the switch takes off', async () => {
			for (const id of ['positrino', 'satellite'] as const) {
				const withLabels = (await buildBackground(id, SERVER))!;
				const without = new Set((await buildBackground(id, SERVER, false))!.layers.map((layer) => layer.id));
				const marked = lifted(withLabels).map((layer) => layer.id);
				expect(marked.length, id).toBeGreaterThan(0);
				expect(marked, id).toEqual(withLabels.layers.map((layer) => layer.id).filter((layer) => !without.has(layer)));
			}
		});

		it('marks nothing with the switch off', async () => {
			expect(lifted((await buildBackground('positrino', SERVER, false))!)).toEqual([]);
		});

		it('lays them over a source, and keeps the rest of the background under it', async () => {
			const entry = {
				name: 'berlin',
				tileUrl: `${SERVER}/tiles/berlin/{z}/{x}/{y}`,
				appearance: { type: 'inspector', overrides: {} },
				kind: 'vectorOther',
				tileFormat: 'mvt',
				layers: [{ name: 'buildings', geometry: 'polygon' }],
				mountedLayers: ['buildings']
			} as never;
			const background = (await buildBackground('positrino', SERVER))!;
			const ids = composeStyle([entry], SERVER, background).style!.layers.map((layer) => layer.id);

			const labels = lifted(background).map((layer) => `${BACKGROUND}/${layer.id}`);
			const data = ids.filter((id) => id.startsWith('berlin/'));
			expect(data.length).toBeGreaterThan(0);
			// The labels are the top of the map, in the order the background drew them in.
			expect(ids.slice(-labels.length)).toEqual(labels);
			// The land and the roads are still the bottom: every other background layer comes before the data.
			const under = ids.filter((id) => id.startsWith(`${BACKGROUND}/`) && !labels.includes(id));
			expect(under.length).toBeGreaterThan(0);
			expect(ids.slice(0, under.length)).toEqual(under);
			expect(ids.slice(under.length, under.length + data.length)).toEqual(data);
		});
	});

	// Imagery only has no overlay at all, so there is nothing for the switch to do.
	it('has nothing to switch on imagery only, or on none', async () => {
		expect(hasLabels('satellite-plain')).toBe(false);
		expect(hasLabels('none')).toBe(false);
		const plain = await buildBackground('satellite-plain', SERVER);
		expect(plain!.layers.every((layer) => layer.type === 'background' || layer.type === 'raster')).toBe(true);
	});
});

describe('the catalogue', () => {
	it('offers off, then quiet ones for data, then full maps, then imagery', () => {
		expect(BACKGROUNDS[0].id).toBe('none');
		const groups = [...new Set(BACKGROUNDS.map((b) => b.group))];
		expect(groups).toEqual(['off', 'data', 'context', 'imagery']);
	});
});
