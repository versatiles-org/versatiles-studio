/**
 * The overlay lifecycle, against a map that only records what it was asked to do.
 *
 * Every one of these is a bug that shipped. They share a shape: the map is left in a state that
 * draws nothing and says nothing, and the only way to find out was to open the application and try
 * the gesture. A fake map is enough to catch all of them and needs neither a DOM nor WebGL, which is
 * why they are here rather than in an end-to-end run.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Map as MaplibreMap, LayerSpecification } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { mapOverlay, NOTHING } from './overlay';

/** One point, so a `setData` can be told from the empty collection it starts at. */
const SOMETHING: FeatureCollection = {
	type: 'FeatureCollection',
	features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }]
};

const LAYERS: LayerSpecification[] = [
	{ id: 'x:fill', type: 'fill', source: 'x' },
	{ id: 'x:line', type: 'line', source: 'x' }
];

/**
 * A map that records rather than renders.
 *
 * `refuse` names layer ids whose `addLayer` throws, which is how the half-added state that made this
 * bug invisible is reproduced without needing to know what upset MapLibre in the first place.
 */
function fakeMap(options: { refuse?: string[] } = {}) {
	const sources = new Map<string, { data: FeatureCollection }>();
	const layers: string[] = [];
	const handlers = new Map<string, Set<() => void>>();
	const refuse = new Set(options.refuse ?? []);

	const map = {
		getSource: (id: string) => {
			const held = sources.get(id);
			return held ? { setData: (data: FeatureCollection) => (held.data = data) } : undefined;
		},
		addSource: (id: string, spec: { data: FeatureCollection }) => void sources.set(id, { data: spec.data }),
		removeSource: (id: string) => void sources.delete(id),
		getLayer: (id: string) => (layers.includes(id) ? { id } : undefined),
		addLayer: (layer: LayerSpecification) => {
			if (refuse.has(layer.id)) throw new Error(`refused ${layer.id}`);
			layers.push(layer.id);
		},
		moveLayer: (id: string) => {
			layers.splice(layers.indexOf(id), 1);
			layers.push(id);
		},
		removeLayer: (id: string) => void layers.splice(layers.indexOf(id), 1),
		on: (event: string, handler: () => void) => {
			if (!handlers.has(event)) handlers.set(event, new Set());
			handlers.get(event)!.add(handler);
		},
		off: (event: string, handler: () => void) => void handlers.get(event)?.delete(handler)
	};

	/** Stops refusing one, so a retry can be shown to succeed on the same map. */
	const allow = (id: string) => void refuse.delete(id);

	return {
		map: map as unknown as MaplibreMap,
		layers,
		allow,
		/** What is on the source now - the thing a layer would actually draw. */
		data: (id = 'x') => sources.get(id)?.data,
		has: (id = 'x') => sources.has(id),
		/** Everything the map does to an overlay arrives as one of these. */
		fire: (event: string) => handlers.get(event)?.forEach((handler) => handler()),
		listeners: (event: string) => handlers.get(event)?.size ?? 0
	};
}

const spec = (data: () => FeatureCollection = () => NOTHING) => ({
	source: 'x',
	layers: () => LAYERS,
	data,
	label: 'test overlay'
});

describe('mapOverlay', () => {
	it('adds its source and layers when it mounts', () => {
		const fake = fakeMap();
		mapOverlay(fake.map, spec());

		expect(fake.has()).toBe(true);
		expect(fake.layers).toEqual(['x:fill', 'x:line']);
	});

	/// The bug: `addSource` succeeded, a later `addLayer` threw, and the next call returned early on
	/// the source it had just added - so the layer that failed was never attempted again. Half-drawn
	/// for the life of the style, and silent, because a layer that was never added throws nothing.
	it('retries a layer that was refused, rather than being stopped by the source it added', () => {
		const fake = fakeMap({ refuse: ['x:line'] });
		mapOverlay(fake.map, spec());
		expect(fake.layers, 'the one that threw is absent, the other is not').toEqual(['x:fill']);
		expect(fake.has(), 'and the source it added is present, which is what used to end it').toBe(true);

		// A refusal is a moment, not a verdict. Guarding the group on its source meant the next call
		// found the source and returned - so the layer that failed was never attempted again.
		fake.allow('x:line');
		fake.fire('styledata');
		expect(fake.layers, 'the missing one heals on the same map').toEqual(['x:fill', 'x:line']);
	});

	/// One overlay failing must not cost another its turn - they were called in sequence inside one
	/// `try`, so the first throw skipped the second entirely.
	it('does not let one overlay stop another', () => {
		const fake = fakeMap({ refuse: ['x:fill'] });
		mapOverlay(fake.map, spec());
		mapOverlay(fake.map, {
			source: 'y',
			layers: () => [{ id: 'y:fill', type: 'fill', source: 'y' }],
			data: () => NOTHING
		});

		expect(fake.layers).toContain('y:fill');
	});

	/// The bug: a style change destroys the sources, `ensure` brings them back empty, and the effect
	/// that fills them has no reason to run because none of its inputs changed. The crop vanished the
	/// moment someone switched the background.
	it('redraws a source the style took away', () => {
		const fake = fakeMap();
		const overlay = mapOverlay(
			fake.map,
			spec(() => SOMETHING)
		);
		overlay.draw();
		expect(fake.data()).toBe(SOMETHING);

		// What a restyle does: everything this overlay owns is gone.
		fake.map.removeSource('x');
		fake.layers.length = 0;
		fake.fire('styledata');

		expect(fake.layers, 'the layers came back').toEqual(['x:fill', 'x:line']);
		expect(fake.data(), 'and so did what they draw').toBe(SOMETHING);
	});

	/// A restore that had nothing to rebuild must not redraw: `styledata` fires constantly, and
	/// re-parsing the data on each one is the kind of cost that starves a drag.
	it('does not redraw when there was nothing to rebuild', () => {
		const fake = fakeMap();
		const data = vi.fn(() => NOTHING);
		mapOverlay(fake.map, { ...spec(), data });
		const atMount = data.mock.calls.length;

		fake.fire('styledata');
		fake.fire('styledata');
		expect(data.mock.calls.length).toBe(atMount);
	});

	/// The bug: the preview's own layers are re-added on the same event, so an overlay that only
	/// ensured its *existence* ended up buried under the tiles it is there to describe.
	it('lifts itself back above layers added after it', () => {
		const fake = fakeMap();
		mapOverlay(fake.map, spec());
		fake.map.addLayer({ id: 'preview:water', type: 'line', source: 'preview' });
		expect(fake.layers.at(-1)).toBe('preview:water');

		fake.fire('styledata');
		expect(fake.layers.at(-1), 'the overlay is on top again').toBe('x:line');
	});

	/// Every round of this bug looked identical from the outside. `idle` is where "too early" stops
	/// being an answer, so anything still missing then has to say so.
	it('reports what it could not add, once the map is idle', () => {
		const fake = fakeMap({ refuse: ['x:line'] });
		const complain = vi.spyOn(console, 'error').mockImplementation(() => {});
		mapOverlay(fake.map, spec());

		fake.fire('idle');
		expect(complain).toHaveBeenCalledWith(expect.stringContaining('test overlay: x:line'), expect.anything());

		// Once, not on every idle - the map fires this constantly.
		complain.mockClear();
		fake.fire('idle');
		expect(complain).not.toHaveBeenCalled();
		complain.mockRestore();
	});

	it('says nothing when everything is on the map', () => {
		const fake = fakeMap();
		const complain = vi.spyOn(console, 'error').mockImplementation(() => {});
		mapOverlay(fake.map, spec());
		fake.fire('idle');
		expect(complain).not.toHaveBeenCalled();
		complain.mockRestore();
	});

	/// A source still carrying layers cannot be removed, and a listener left attached outlives the
	/// component - both leave a map that behaves oddly long after the thing that broke it is gone.
	it('takes its layers, its source and its listeners with it', () => {
		const fake = fakeMap();
		const overlay = mapOverlay(fake.map, spec());
		overlay.dispose();

		expect(fake.layers).toEqual([]);
		expect(fake.has()).toBe(false);
		for (const event of ['styledata', 'load', 'idle']) expect(fake.listeners(event)).toBe(0);
	});

	it('can be disposed when nothing was ever added', () => {
		const fake = fakeMap({ refuse: ['x:fill', 'x:line'] });
		const overlay = mapOverlay(fake.map, spec());
		expect(() => overlay.dispose()).not.toThrow();
		expect(fake.has()).toBe(false);
	});
});
