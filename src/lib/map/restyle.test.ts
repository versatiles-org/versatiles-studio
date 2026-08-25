/**
 * Setting a style without asking MapLibre to diff one that has not loaded.
 *
 * The failure is quiet and expensive: MapLibre catches its own error, warns once, and rebuilds the
 * style from scratch — every source torn down and refetched. It happened on every launch, and the
 * only reason anyone knew was that the console is now collected (S6.8).
 */

import { describe, expect, it, vi } from 'vitest';
import type { Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';
import { restyler } from './restyle';

/** A style, told apart by its one layer's id. */
const style = (id: string) => ({ version: 8, sources: {}, layers: [{ id, type: 'background' }] }) as StyleSpecification;

/** The ids of the styles the map was actually given, in order. */
function fakeMap() {
	const handlers: (() => void)[] = [];
	const set: string[] = [];

	const map = {
		on: (event: string, handler: () => void) => {
			if (event === 'style.load') handlers.push(handler);
		},
		setStyle: (next: StyleSpecification) => void set.push(next.layers[0].id)
	};

	return {
		map: map as unknown as MaplibreMap,
		set,
		/** What MapLibre fires when the style on the map has finished loading. */
		loaded: () => handlers.forEach((handler) => handler())
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
