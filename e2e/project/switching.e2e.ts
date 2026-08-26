/**
 * Switching sources and operations off, and watching the pipeline follow ([Q49]).
 *
 * The gesture is one press on an eye, and behind it is the whole of the change: the core records it,
 * the effective pipeline is rebuilt without those nodes, the mount under that graph's name follows,
 * and the pane redraws around what is left. Unit tests cover each of those; only a real window shows
 * that pressing the eye reaches them in that order - and that the map survives it, which is the
 * failure mode a passing unit test cannot see.
 *
 * [Q49]: ../../docs/decisions.md
 */

import { browser, expect, $ } from '@wdio/globals';
import { invoke, openProject } from '../support';

type Graph = { id: number; name: string; enabled: boolean; nodes: number; running: number };

const graphs = () => invoke<Graph[]>('graphs');
const only = async (): Promise<Graph> => (await graphs())[0];

/** Waits for the core to agree with what was just pressed. */
async function until(what: string, is: (graph: Graph) => boolean): Promise<void> {
	await browser.waitUntil(async () => is(await only()), { timeout: 10_000, timeoutMsg: what });
}

/** Nothing went wrong on the way - a restyle MapLibre refused would show up here. */
async function nothingBroke(): Promise<void> {
	await expect($('.maplibregl-canvas')).toBeExisting();
	const problems = await invoke<{ message: string }[]>('diagnostics');
	expect(problems.map((problem) => problem.message)).toEqual([]);
}

// One window for the whole file: the launcher is consumed by opening it, so a second `openProject`
// would find no launcher to open anything from.
before(openProject);

describe('switching a source off', () => {
	it('starts drawn, and says so on its row', async () => {
		const graph = await only();
		expect(graph.enabled).toBe(true);
		expect(graph.running).toBe(graph.nodes);

		await expect($(`button[aria-label="Switch off ${graph.name}"]`)).toBeDisplayed();
	});

	it('stops being drawn when its eye is pressed', async () => {
		const { name } = await only();
		await $(`button[aria-label="Switch off ${name}"]`).click();

		await until('the core never recorded the graph as off', (graph) => !graph.enabled);
		// The same eye, now offering the other direction - so the row is showing what the core holds
		// rather than what was clicked.
		await expect($(`button[aria-label="Switch on ${name}"]`)).toBeDisplayed();
		await nothingBroke();
	});

	it('is drawn again when it is pressed back on', async () => {
		const { name } = await only();
		await $(`button[aria-label="Switch on ${name}"]`).click();

		await until('the core never recorded the graph as on again', (graph) => graph.enabled);
		await nothingBroke();
	});
});

describe('switching one operation off', () => {
	/**
	 * A two-node chain, so there is something to switch off that is not the head.
	 *
	 * **Added through the pane, not through the core.** `set_graph` would move the document behind
	 * the window's back: the pane draws what the webview holds, and nothing tells it to re-read.
	 * `vector_repair` because it fits vector tiles and has no required parameter, so the chain it
	 * makes is one that builds.
	 */
	before(async () => {
		await $('button*=＋ operation…').click();
		await $('[data-value="vector_repair"]').waitForDisplayed({
			timeout: 10_000,
			timeoutMsg: 'the operation picker never opened'
		});
		await $('[data-value="vector_repair"]').click();

		await $('button[aria-label="Switch off vector_repair"]').waitForDisplayed({
			timeout: 20_000,
			timeoutMsg: 'the second node never appeared in the chain'
		});
	});

	it('leaves the graph running with one operation fewer', async () => {
		await $('button[aria-label="Switch off vector_repair"]').click();

		await until('the core never recorded the node as off', (graph) => graph.running === 1);
		const graph = await only();
		// **Still on, and still drawn.** A bypass is not a cut: what is off is the one operation.
		expect(graph.enabled).toBe(true);
		expect(graph.nodes).toBe(2);
		await nothingBroke();
	});

	it('says that an export would run it anyway', async () => {
		// The one place the eyes and an export disagree, said where the switch is.
		await expect($('p*=1 of 2 operations are switched on')).toBeDisplayed();
		await expect($('p*=An export runs all of them')).toBeDisplayed();
	});

	it('runs it again when the eye goes back on', async () => {
		await $('button[aria-label="Switch on vector_repair"]').click();

		await until('the core never recorded the node as on again', (graph) => graph.running === 2);
		await nothingBroke();
	});
});
