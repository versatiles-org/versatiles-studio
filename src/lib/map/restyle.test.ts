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
function fakeMap(applies: 'rebuild' | 'nothing' = 'rebuild') {
	const handlers: (() => void)[] = [];
	const set: string[] = [];
	/** What `isStyleLoaded` would answer - the flag MapLibre's diff insists on. */
	let styleLoaded = false;

	const map = {
		on: (event: string, handler: () => void) => {
			if (event === 'style.load') handlers.push(handler);
		},
		setStyle: (next: StyleSpecification) => {
			set.push(next.layers[0].id);
			if (applies === 'rebuild') styleLoaded = false;
		},
		isStyleLoaded: () => styleLoaded
	};

	return {
		map: map as unknown as MaplibreMap,
		set,
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
