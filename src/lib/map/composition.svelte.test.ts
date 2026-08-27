// @vitest-environment jsdom

/**
 * The style the map is handed.
 *
 * **Narrow on purpose.** *How* a style is composed is `stack.ts`'s, and tested there; what is left
 * here is the part that only became checkable once this was a module rather than a `$derived` in
 * `App.svelte` - what a reader gets back, and when there is nothing to give them.
 *
 * The derivations below it - which graphs are in the stack, in what order, and which one the pane is
 * acting on - are `stack.ts`'s rules applied to module state, and asserting them here would need a
 * reactive source this file cannot have: no test in this repository is compiled with runes, so a
 * mocked getter is not tracked and a `$derived` over it never invalidates. They are covered where
 * the rules live.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({ serverBaseUrl: vi.fn() }));
vi.mock('../ipc/commands', () => ipc);
vi.mock('./background', () => ({ buildBackground: vi.fn() }));

vi.mock('../state/graphs.svelte', () => ({ graphs: { list: [], nameOf: () => null } }));
vi.mock('../state/document.svelte', () => ({ document: { graph: null } }));
vi.mock('../state/preview.svelte', () => ({ preview: { built: {} } }));
vi.mock('../state/layout.svelte', () => ({ layout: { background: 'none' } }));
vi.mock('../state/style.svelte', () => ({ style: { current: null } }));
vi.mock('../state/status.svelte', () => ({ status: { fail: vi.fn() } }));

const { composition } = await import('./composition.svelte');

beforeEach(() => vi.clearAllMocks());

describe('the style the map is given', () => {
	// Every tile URL names the server's port, and the port is ephemeral - so until it answers there
	// is no style to give, and `App` has nothing to mount the map on.
	it('is nothing at all until the server has answered', () => {
		expect(composition.style).toBeNull();
		expect(composition.serverUrl).toBeNull();
	});

	// Nothing is open, so there is no source for the pane to act on and none for the grid to follow.
	it('has no source to act on before anything is open', () => {
		expect(composition.editedName).toBeNull();
		expect(composition.edited).toBeUndefined();
		expect(composition.drawn).toBe(false);
		expect(composition.gridSource).toBeNull();
		expect(composition.stacked).toEqual([]);
		expect(composition.text()).toBeNull();
	});

	/**
	 * `MapCanvas` decides whether to apply a style by comparing it with the last one it applied, and
	 * the markup reads this twice - once to decide whether to mount the map, once to hand it over.
	 *
	 * So a getter that built the default fresh on each read would hand out two different styles per
	 * render, and each would look like a new style to apply: every source torn down and refetched, on
	 * every frame that touched anything. That is what `mapStyle` being a `$derived` prevents, and this
	 * is the only thing that would notice if it stopped being one.
	 */
	it('is the same object across reads, so applying it is not a per-render rebuild', async () => {
		ipc.serverBaseUrl.mockResolvedValue('http://127.0.0.1:9000');
		await composition.load();

		expect(composition.serverUrl).toBe('http://127.0.0.1:9000');
		expect(composition.style).not.toBeNull();
		expect(composition.style).toBe(composition.style);
	});

	// With nothing open, the ground is still a map worth looking at - so the default stands in rather
	// than the window opening onto nothing (Q54).
	it('falls back to the default when nothing is built', () => {
		expect(composition.style?.layers.length).toBeGreaterThan(0);
	});
});
