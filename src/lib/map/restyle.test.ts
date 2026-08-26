/**
 * Setting a style without asking MapLibre to diff one that has not loaded.
 *
 * The failure is quiet and expensive: MapLibre catches its own error, warns once, and rebuilds the
 * style from scratch - every source torn down and refetched. It happened on every launch, and the
 * only reason anyone knew was that the console is now collected (S6.8).
 */

import { describe, expect, it, vi } from 'vitest';
import type { Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';
import { restyler } from './restyle';

/** A style, told apart by its one layer's id. */
const style = (id: string) => ({ version: 8, sources: {}, layers: [{ id, type: 'background' }] }) as StyleSpecification;

/** The same graph at a given revision: one source, one layer, and a URL that moves on. */
const graph = (revision: number, layer = 'basemap:water') =>
	({
		version: 8,
		sources: { basemap: { type: 'vector', tiles: [`studio://host/basemap/{z}/{x}/{y}?v=${revision}`] } },
		layers: [{ id: layer, type: 'line', source: 'basemap' }]
	}) as StyleSpecification;

/**
 * The ids of the styles the map was actually given, in order.
 *
 * `applies` is what MapLibre does with a style it is handed, and the two cases behave differently
 * enough to be worth telling apart:
 *
 * * `rebuild` - the ordinary one. The style stops being loaded and says `style.load` when it is
 *   again, which the test decides the moment of.
 * * `nothing` - the diff found no operations to perform. `Style.setState` returns before firing
 *   anything, and the style already on the map is untouched and still loaded.
 */
function fakeMap(applies: 'rebuild' | 'nothing' = 'rebuild', sources: string[] = ['basemap']) {
	const handlers: (() => void)[] = [];
	const set: string[] = [];
	/** What `isStyleLoaded` would answer - the flag MapLibre's diff insists on. */
	let styleLoaded = false;

	/** What each source was last pointed at, for the styles that go in as a tile swap. */
	const swapped: string[] = [];

	const map = {
		on: (event: string, handler: () => void) => {
			if (event === 'style.load') handlers.push(handler);
		},
		setStyle: (next: StyleSpecification) => {
			set.push(next.layers[0].id);
			if (applies === 'rebuild') styleLoaded = false;
		},
		isStyleLoaded: () => styleLoaded,
		getSource: (id: string) =>
			sources.includes(id) ? { setTiles: (tiles: string[]) => void swapped.push(tiles[0]) } : undefined
	};

	return {
		map: map as unknown as MaplibreMap,
		set,
		swapped,
		/** What MapLibre fires when the style on the map has finished loading. */
		loaded: () => {
			styleLoaded = true;
			handlers.forEach((handler) => handler());
		}
	};
}

describe('applying a style', () => {
	it('waits for the style already on the map to finish loading', () => {
		// The launch case, and it is guaranteed rather than unlucky: the map is built with the
		// default style and the composed one arrives as soon as the server, the background and the
		// first graph have landed.
		const fake = fakeMap();
		const apply = restyler(fake.map);

		apply(style('composed'));
		expect(fake.set, 'nothing while the first style is still loading').toEqual([]);

		fake.loaded();
		expect(fake.set).toEqual(['composed']);
	});

	it('applies straight away once the map is ready', () => {
		const fake = fakeMap();
		const apply = restyler(fake.map);
		fake.loaded();

		apply(style('recoloured'));
		expect(fake.set).toEqual(['recoloured']);
	});

	/**
	 * A background resolving, a graph mounting and a recipe changing can all land while the first
	 * style loads. Only the last of them describes what the map should show; applying each in turn
	 * would rebuild it once per state nobody asked to see.
	 */
	it('keeps only the newest of several that arrive while it waits', () => {
		const fake = fakeMap();
		const apply = restyler(fake.map);

		apply(style('first'));
		apply(style('second'));
		apply(style('third'));
		fake.loaded();

		expect(fake.set).toEqual(['third']);
	});

	it('waits again for each style it applies', () => {
		const fake = fakeMap();
		const apply = restyler(fake.map);
		fake.loaded();

		apply(style('one'));
		apply(style('two'));
		expect(fake.set, 'the second waits for the first to load').toEqual(['one']);

		fake.loaded();
		expect(fake.set).toEqual(['one', 'two']);
	});

	it('says when an applied style has loaded, so what was drawn can be drawn again', () => {
		const applied = vi.fn();
		const fake = fakeMap();
		const apply = restyler(fake.map, applied);

		// Not for the style the map was built with: nothing has been drawn on it yet, and a caller
		// restoring its layers onto the very first style would be restoring nothing.
		fake.loaded();
		expect(applied).not.toHaveBeenCalled();

		apply(style('composed'));
		expect(applied, 'not until it has loaded').not.toHaveBeenCalled();

		fake.loaded();
		expect(applied).toHaveBeenCalledTimes(1);
	});

	/**
	 * **The event does not always come.** `Style.setState` returns at `operations.length === 0`
	 * before firing `style.load`, so a style that comes out equal to the one already on the map
	 * applies nothing and announces nothing. Waiting for it parks every later style behind an event
	 * that is never coming - a map that stops responding to a background switch, a preset, a new
	 * graph, until the window is reloaded.
	 */
	it('does not park the next style behind one that changed nothing', () => {
		const fake = fakeMap('nothing');
		const apply = restyler(fake.map);
		fake.loaded();

		apply(style('unchanged'));
		expect(fake.set).toEqual(['unchanged']);

		apply(style('after'));
		expect(fake.set, 'the map is still ready: nothing was torn down').toEqual(['unchanged', 'after']);
	});

	it('says nothing was applied when nothing was, because nothing was discarded', () => {
		const applied = vi.fn();
		const fake = fakeMap('nothing');
		const apply = restyler(fake.map, applied);
		fake.loaded();

		apply(style('unchanged'));

		// The callback exists so the caller can draw its own layers again. A style that applied no
		// operations discarded none of them, so calling it would redraw what is already there.
		expect(applied).not.toHaveBeenCalled();
	});

	it('does not say so for a style that was superseded before it was applied', () => {
		// The intermediate style never reached the map, so nothing was drawn on it to restore.
		const applied = vi.fn();
		const fake = fakeMap();
		const apply = restyler(fake.map, applied);

		apply(style('first'));
		apply(style('second'));
		fake.loaded();

		expect(fake.set).toEqual(['second']);
		expect(applied).not.toHaveBeenCalled();

		fake.loaded();
		expect(applied).toHaveBeenCalledTimes(1);
	});
});

/**
 * A rebuilt graph is the same sources and layers reading from a new revision of the same URLs, and
 * `setStyle` answers that by taking the source off the map and putting it back - every tile on
 * screen discarded to fetch the same squares again. See `tile-swap.ts`.
 */
describe('a style that only moved a source on', () => {
	it('points the source at its new tiles instead of setting a style', () => {
		const fake = fakeMap();
		const apply = restyler(fake.map);
		fake.loaded();

		apply(graph(1));
		expect(fake.set, 'the first one has to be a whole style').toEqual(['basemap:water']);
		fake.loaded();

		apply(graph(2));

		expect(fake.set, 'and the second is not a style at all').toEqual(['basemap:water']);
		expect(fake.swapped).toEqual(['studio://host/basemap/{z}/{x}/{y}?v=2']);
	});

	it('says nothing was applied, because nothing was discarded', () => {
		const applied = vi.fn();
		const fake = fakeMap();
		const apply = restyler(fake.map, applied);
		fake.loaded();
		apply(graph(1));
		fake.loaded();
		applied.mockClear();

		apply(graph(2));

		// The callback exists so the caller can draw its own layers again. A swap leaves them alone.
		expect(applied).not.toHaveBeenCalled();
	});

	it('is still ready for the style after it', () => {
		const fake = fakeMap();
		const apply = restyler(fake.map);
		fake.loaded();
		apply(graph(1));
		fake.loaded();

		apply(graph(2));
		apply(graph(3, 'basemap:roads'));

		expect(fake.set, 'a swap is not something to wait for').toEqual(['basemap:water', 'basemap:roads']);
	});

	it('falls back to a whole style when the source is not on the map', () => {
		const fake = fakeMap('rebuild', []);
		const apply = restyler(fake.map);
		fake.loaded();
		apply(graph(1));
		fake.loaded();

		apply(graph(2));

		expect(fake.swapped).toEqual([]);
		expect(fake.set, 'the style describes the end state, so it repairs whatever this was').toEqual([
			'basemap:water',
			'basemap:water'
		]);
	});

	/**
	 * **The one that would be a real bug.** Several styles can arrive while the map is loading and
	 * only the last is applied - so an intermediate one never described what is on screen. Comparing
	 * against it would call a change a tile swap on the strength of a style nobody ever saw, and
	 * point sources the map may not even have at tiles it never asked for.
	 */
	it('compares against the style on the map, not one that was superseded', () => {
		const fake = fakeMap();
		const apply = restyler(fake.map);
		fake.loaded();

		// On the map: a graph whose layer is `basemap:water`, still loading.
		apply(graph(1));
		expect(fake.set).toEqual(['basemap:water']);

		// Two more arrive while it loads. They differ from each other in nothing but the revision,
		// and from what is on the map in the layer as well.
		apply(graph(2, 'basemap:roads'));
		apply(graph(3, 'basemap:roads'));
		fake.loaded();

		expect(fake.swapped, 'the layer changed, whatever the dropped style said').toEqual([]);
		expect(fake.set).toEqual(['basemap:water', 'basemap:roads']);
	});
});
