/**
 * Which layers a click is allowed to hit, and how often that is worked out.
 *
 * Both of these shipped. The first was visible — a popup full of OSM roads — and the second was
 * not: it made the map feel broken during a drag, which is a symptom nobody attributes to a lookup.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { sourceLayers } from './source-layers';

/** A map whose style can be replaced, and which counts how often it was asked to serialise it. */
function fakeMap(layers: { id: string; source?: string }[]) {
	const getStyle = vi.fn(() => ({ layers }));
	return { map: { getStyle } as unknown as MaplibreMap, getStyle };
}

const STYLE = [
	{ id: 'background' }, // no source at all, as a background layer has none
	{ id: 'osm:roads', source: 'versatiles-shortbread' },
	{ id: 'osm:places', source: 'versatiles-shortbread' },
	{ id: 'basemap:water', source: 'basemap' },
	{ id: 'basemap:roads', source: 'basemap' }
];

describe('sourceLayers', () => {
	it('names only the layers on the source it was given', () => {
		const fake = fakeMap(STYLE);
		expect(sourceLayers(fake.map, 'basemap').ids()).toEqual(['basemap:water', 'basemap:roads']);
	});

	/// A background layer has no `source`, and reading one off it must not throw or match.
	it('ignores a layer that has no source', () => {
		const fake = fakeMap(STYLE);
		expect(sourceLayers(fake.map, 'basemap').ids()).not.toContain('background');
	});

	/// **Not the same as "no filter".** An empty list handed to `queryRenderedFeatures` makes it
	/// query every layer, which is the bug this exists to prevent — so callers check for empty, and
	/// this must return empty rather than something that looks permissive.
	it('answers nothing when there is no source', () => {
		const fake = fakeMap(STYLE);
		expect(sourceLayers(fake.map, null).ids()).toEqual([]);
		expect(fake.getStyle, 'and does not serialise a style to say so').not.toHaveBeenCalled();
	});

	/// The bug: this was called from a `mousemove` handler. `getStyle()` clones every layer and
	/// source in the style — with a basemap loaded, hundreds — and MapLibre fires its listeners in
	/// one ordered loop, so the handler after it never got a usable turn.
	it('serialises the style once, however often it is asked', () => {
		const fake = fakeMap(STYLE);
		const lookup = sourceLayers(fake.map, 'basemap');
		for (let i = 0; i < 50; i++) lookup.ids();
		expect(fake.getStyle).toHaveBeenCalledTimes(1);
	});

	it('looks again once the style has changed', () => {
		const fake = fakeMap(STYLE);
		const lookup = sourceLayers(fake.map, 'basemap');
		expect(lookup.ids()).toHaveLength(2);

		STYLE.push({ id: 'basemap:labels', source: 'basemap' });
		expect(lookup.ids(), 'still the cached answer').toHaveLength(2);
		lookup.invalidate();
		expect(lookup.ids(), 'and the new one after the style said so').toHaveLength(3);
		STYLE.pop();
	});

	/// `getStyle` throws when there is no style yet, which is ordinary at mount. Answering nothing is
	/// right; caching that nothing, or letting it out, is not — this runs ahead of other listeners.
	it('answers nothing while there is no style, and tries again afterwards', () => {
		const getStyle = vi.fn(() => {
			throw new Error('no style');
		});
		const map = { getStyle } as unknown as MaplibreMap;
		const lookup = sourceLayers(map, 'basemap');

		expect(() => lookup.ids()).not.toThrow();
		expect(lookup.ids()).toEqual([]);
		expect(getStyle, 'it did not cache the failure').toHaveBeenCalledTimes(2);
	});
});
