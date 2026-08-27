// @vitest-environment jsdom

/**
 * The style the map is handed.
 *
 * **Narrow on purpose.** *How* a style is composed is `stack.ts`'s, and tested there; what is left
 * here is the part that only became checkable once this was a module rather than a `$derived` in
 * `App.svelte` - what a reader gets back, and when there is nothing to give them.
 *
 * The derivations below it - which graphs are in the stack, in what order, and which one the pane is
 * acting on - need a *reactive* source to be worth asserting: a `$derived` over a plain mocked getter
 * is computed once and cached, so a test that mutated one would be reading the first answer forever.
 * `fixture` is `$state`, which is what makes the reads below track.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({ serverBaseUrl: vi.fn() }));
vi.mock('../ipc/commands', () => ipc);
vi.mock('./background', () => ({ buildBackground: vi.fn() }));

/** What the state modules would hold. `$state`, so a `$derived` over it invalidates. */
const fixture = $state({
	graphs: [] as { id: number; name: string }[],
	recipe: null as unknown,
	built: {} as Record<string, unknown>,
	graph: null as number | null
});

vi.mock('../state/graphs.svelte', () => ({
	graphs: {
		get list() {
			return fixture.graphs;
		},
		nameOf: (id: number) => fixture.graphs.find((graph) => graph.id === id)?.name ?? null
	}
}));
vi.mock('../state/document.svelte', () => ({
	document: {
		get graph() {
			return fixture.graph;
		}
	}
}));
vi.mock('../state/preview.svelte', () => ({
	preview: {
		get built() {
			return fixture.built;
		}
	}
}));
vi.mock('../state/style.svelte', () => ({
	style: {
		get current() {
			return fixture.recipe;
		}
	}
}));
vi.mock('../state/layout.svelte', () => ({ layout: { background: 'none' } }));
vi.mock('../state/status.svelte', () => ({ status: { fail: vi.fn() } }));

const { composition } = await import('./composition.svelte');

/** A built graph, with only the fields the composition reads. */
const build = (name: string) => ({
	name,
	tileUrl: `http://x/${name}/{z}/{x}/{y}`,
	layers: [{ name: 'water', geometry: 'polygon' }],
	info: {
		tileFormat: 'mvt',
		tileSchema: null,
		bbox: null,
		minZoom: 0,
		maxZoom: 14,
		tileJson: { vector_layers: [{ id: 'water' }] }
	}
});

beforeEach(() => {
	fixture.graphs = [];
	fixture.recipe = null;
	fixture.built = {};
	fixture.graph = null;
	vi.clearAllMocks();
});

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

describe('which source the pane acts on', () => {
	/**
	 * The bug [Q51] describes, one level up: selecting a graph rebuilds nothing, so the pane went on
	 * showing the previous graph's layers while every control wrote into the newly selected one's
	 * recipe, keyed on ids it did not have. Both halves have to follow the *selection*.
	 */
	it('follows the selection rather than the last thing built', async () => {
		ipc.serverBaseUrl.mockResolvedValue('http://127.0.0.1:9000');
		await composition.load();
		fixture.graphs = [
			{ id: 1, name: 'basemap' },
			{ id: 2, name: 'places' }
		];
		fixture.built = { basemap: build('basemap'), places: build('places') };
		fixture.recipe = { sources: {}, order: [] };

		fixture.graph = 1;
		expect(composition.editedName).toBe('basemap');
		expect(composition.edited?.name).toBe('basemap');

		fixture.graph = 2;
		expect(composition.editedName).toBe('places');
		expect(composition.edited?.name).toBe('places');
	});
});

describe('the graphs in draw order', () => {
	// Top of the list first, which is the reverse of the order the layers are emitted in.
	it('lists them top of the map first', () => {
		fixture.graphs = [
			{ id: 1, name: 'basemap' },
			{ id: 2, name: 'places' }
		];
		fixture.recipe = {
			sources: {},
			order: [
				{ source: 'basemap', from: null },
				{ source: 'places', from: null }
			]
		};

		expect(composition.stacked.map((graph) => graph.name)).toEqual(['places', 'basemap']);
	});

	/// A graph that will not build keeps its place in the one control that can move it ([Q50]).
	it('keeps a graph that has never been built', () => {
		fixture.graphs = [
			{ id: 1, name: 'basemap' },
			{ id: 2, name: 'broken' }
		];
		fixture.built = { basemap: build('basemap') };

		expect(composition.stacked.map((graph) => graph.name)).toContain('broken');
	});
});
