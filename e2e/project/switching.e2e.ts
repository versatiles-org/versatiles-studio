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

import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { browser, expect, $ } from '@wdio/globals';
import { invoke, openProject } from '../support';

type Graph = {
	id: number;
	name: string;
	enabled: boolean;
	nodes: number;
	running: number;
	disabled: number[][];
};

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
		await $('button*=+ operation…').click();
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

	// The row in the sources list is the only place a half-run graph is visible when its chain is
	// not on screen, so it has to say so there.
	it('says on the row how much of the graph runs', async () => {
		await expect($('span=1/2')).toBeDisplayed();
	});

	it('runs it again when the eye goes back on', async () => {
		await $('button[aria-label="Switch on vector_repair"]').click();

		await until('the core never recorded the node as on again', (graph) => graph.running === 2);
		await nothingBroke();

		// Left off for the story below, which is about what a project remembers.
		await $('button[aria-label="Switch off vector_repair"]').click();
		await until('the node never went off again', (graph) => graph.running === 1);
	});
});

describe('what a saved project remembers', () => {
	/** Where this story writes its project, thrown away first so a rerun starts clean. */
	const DIR = resolve(tmpdir(), 'studio-e2e-switching');

	/** Whatever the stories above left behind, this one is about a graph with an operation off. */
	before(async () => {
		if ((await only()).running === 2) await $('button[aria-label="Switch off vector_repair"]').click();
		await browser.waitUntil(async () => (await only()).running === 1, {
			timeout: 10_000,
			timeoutMsg: 'the node would not go off'
		});
	});

	it('writes the switches into the manifest and leaves the .vpl alone', async () => {
		rmSync(DIR, { recursive: true, force: true });
		await invoke('save_project', { dir: DIR, style: null });

		// Which of its operations Studio runs is beside the crop in the manifest, for the same
		// reason the crop is there.
		expect(readFileSync(resolve(DIR, 'project.yaml'), 'utf8')).toContain('disabled');

		// **And the `.vpl` still holds the whole pipeline**, switched-off operation included: the
		// file stays the thing `versatiles convert` runs, rather than becoming a different pipeline
		// for every tool that reads it.
		const vpl = readFileSync(resolve(DIR, 'debug.vpl'), 'utf8');
		expect(vpl).toContain('vector_repair');
		expect(vpl).not.toContain('# | vector_repair');
	});

	// Asserted against the core rather than the pane: `open_project` here is the command, not the
	// gesture, so nothing has told this window to redraw - and what persistence is about is what
	// came back, not what is on screen.
	it('opens again with the same operations switched off', async () => {
		await invoke('open_project', { dir: DIR });

		await browser.waitUntil(async () => (await only()).nodes === 2, {
			timeout: 20_000,
			timeoutMsg: 'the project never came back'
		});
		const graph = await only();
		expect(graph.running).toBe(1);
		expect(graph.disabled).toEqual([[1]]);
	});
});
