/**
 * One selection, across every pane that has an opinion about it
 * ([the layer stack](../../docs/layers.md)).
 *
 * **The bug this exists for was invisible to every unit test.** The Style pane wrote to the
 * *selected* graph and read what the *last preview* had produced - the same graph until somebody
 * picks another one without editing it, because selecting a graph rebuilds nothing. After that the
 * pane went on showing the previous graph's layers while every control wrote into the newly selected
 * one's recipe, keyed on ids it did not have.
 *
 * Nothing throws when that happens. The recipe is valid, the map still draws, and the only witness
 * is a preset that lands on the wrong source - which is exactly the shape of thing a story in a real
 * window catches and a component test cannot, because the two answers live in two modules that only
 * meet in `App.svelte`.
 */

import { browser, expect, $ } from '@wdio/globals';
import { invoke, openPane, openProject } from '../support';

type Recipe = { sources: Record<string, { appearance?: { preset?: string } }> };
type Graph = { id: number; name: string };

const graphs = () => invoke<Graph[]>('graphs');
const recipe = () => invoke<Recipe>('style');
const presetOf = async (name: string) => (await recipe()).sources[name]?.appearance?.preset;

describe('selecting another source', () => {
	before(openProject);

	/** A second graph, so there is something to select *away* from. */
	before(async () => {
		await invoke('add_graph', { source: null, text: 'from_debug format=png' });
		await browser.waitUntil(async () => (await graphs()).length === 2, {
			timeout: 10_000,
			timeoutMsg: 'the second graph never arrived'
		});
	});

	it('points the style pane at what was selected, not at what was built last', async () => {
		const [first, second] = await graphs();

		// The fixture's graph is the one that has been previewed; select the other and change it.
		await openPane('Sources');
		await $(`button*=${second.name}`).click();
		await openPane('Style');
		await $('button=Neutrino').click();

		await browser.waitUntil(async () => (await presetOf(second.name)) === 'neutrino', {
			timeout: 10_000,
			timeoutMsg: 'the preset never reached the selected graph'
		});

		// **And nowhere else.** The graph that happened to be previewed must be untouched: a recipe
		// that records the right preset against the wrong source is the whole bug.
		expect(await presetOf(first.name)).toBe(undefined);
	});

	it('follows a click in the layer tree back to that layer’s source', async () => {
		const [first] = await graphs();

		await openPane('Layers');
		await $(`button*=${first.name}`).click();

		// The highlight in the sources list *is* the selection - two questions kept apart, and this
		// is the one that says which graph the panes below are about.
		await browser.waitUntil(async () => (await $('ul.graphs li.current').getText()).includes(first.name), {
			timeout: 10_000,
			timeoutMsg: 'clicking a layer row never selected its source'
		});
	});
});
