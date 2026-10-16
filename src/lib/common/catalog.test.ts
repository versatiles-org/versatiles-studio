// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { CATALOG_URL, fetchCatalog, parseCatalog } from './catalog';

/** The shape download.versatiles.org publishes, cut down to what is read. */
const CATALOG = {
	datasets: [
		{
			slug: 'osm',
			title: 'OpenStreetMap',
			description: [
				'Full planet tileset in <a href="https://shortbread-tiles.org/schema/">Shortbread Schema</a>.',
				'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap Contributors</a>'
			],
			tileType: 'vector',
			latest: { url: 'https://download.versatiles.org/osm.versatiles', size: 66534652244, date: '2026-06-08' },
			versions: []
		},
		{
			slug: 'satellite',
			title: 'Satellite Imagery (Alpha)',
			description: [],
			tileType: 'raster',
			latest: { url: 'https://download.versatiles.org/satellite.versatiles', size: 1716900000000, date: null },
			versions: []
		}
	]
};

describe('parseCatalog', () => {
	it('reads every dataset, in its own order', () => {
		const shortcuts = parseCatalog(CATALOG);
		expect(shortcuts.map((shortcut) => shortcut.title)).toEqual(['OpenStreetMap', 'Satellite Imagery (Alpha)']);
		expect(shortcuts[0]).toMatchObject({
			url: 'https://download.versatiles.org/osm.versatiles',
			size: 66534652244,
			date: '2026-06-08',
			tileType: 'vector'
		});
		expect(shortcuts[1].date).toBeNull();
	});

	// The catalogue writes HTML. None of it is rendered as such - a link in somebody else's document
	// is not something Studio's window should be able to be made to show.
	it('reads descriptions as plain text', () => {
		const [osm] = parseCatalog(CATALOG);
		expect(osm.description).toEqual(['Full planet tileset in Shortbread Schema.', '© OpenStreetMap Contributors']);
	});

	it('leaves out what it cannot open, rather than showing it half-empty', () => {
		const shortcuts = parseCatalog({
			datasets: [
				{ title: 'No release' },
				{ title: 'Not https', latest: { url: 'http://example.org/x.versatiles' } },
				{ latest: { url: 'https://example.org/untitled.versatiles' } },
				...CATALOG.datasets
			]
		});
		expect(shortcuts.map((shortcut) => shortcut.title)).toEqual(['OpenStreetMap', 'Satellite Imagery (Alpha)']);
	});

	it('is no shortcuts for something that is not a catalogue', () => {
		expect(parseCatalog(null)).toEqual([]);
		expect(parseCatalog({ datasets: 'nope' })).toEqual([]);
	});
});

describe('fetchCatalog', () => {
	const responding = (body: unknown, ok = true) =>
		vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) }) as unknown as typeof fetch;

	it('asks download.versatiles.org', async () => {
		const fetcher = responding(CATALOG);
		expect(await fetchCatalog(fetcher)).toHaveLength(2);
		expect(fetcher).toHaveBeenCalledWith(CATALOG_URL, expect.anything());
	});

	// `null`, not `[]`: the dialog says Studio may be offline, which an empty catalogue is not.
	it('is null when the catalogue cannot be had', async () => {
		expect(
			await fetchCatalog(vi.fn().mockRejectedValue(new TypeError('offline')) as unknown as typeof fetch)
		).toBeNull();
		expect(await fetchCatalog(responding({}, false))).toBeNull();
	});
});
