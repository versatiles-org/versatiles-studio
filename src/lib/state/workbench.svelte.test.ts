// @vitest-environment jsdom

/**
 * The order things happen in when something is opened.
 *
 * **This is the half that had no test at all.** Every rule here was enforced by the order of
 * statements inside `App.svelte`, so the only way to check one was to open the application and look
 * - and the failures are all quiet. A graph created without the list being refreshed leaves the
 * landing screen up over the pipeline it just opened; a document applied without its containers
 * synced leaves the inspector with nothing to say about a container the pipeline is plainly using.
 *
 * So what is asserted is mostly *sequence*: which module was called, and in what order.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Every call the workbench makes, in order, so a sequence can be asserted as one. */
const calls = vi.hoisted(() => [] as string[]);

/** Records that a call happened. The name only - the sequence is what these tests are about. */
const note = (what: string, answer?: unknown) => () => {
	calls.push(what);
	return answer;
};

/** The same, for the two where the wording matters: what the bar said is part of the behaviour. */
const says = (what: string) => (message: unknown) => void calls.push(`${what}(${String(message)})`);

const doc = (graph: number, name = 'berlin', diagnostics: unknown[] = []) => ({
	graph,
	name,
	text: 'from_debug',
	pipeline: { nodes: [] },
	tokens: [],
	diagnostics,
	canUndo: false,
	canRedo: false,
	path: null,
	dirty: false
});

const ipc = vi.hoisted(() => ({
	addGraph: vi.fn(),
	formatGraph: vi.fn(),
	getGraph: vi.fn(),
	importKinds: vi.fn(),
	importOpening: vi.fn(),
	importReadNode: vi.fn(),
	isProject: vi.fn(),
	openVpl: vi.fn(),
	redo: vi.fn(),
	saveVpl: vi.fn(),
	setCrop: vi.fn(),
	setGraph: vi.fn(),
	undo: vi.fn(),
	vplInsertNode: vi.fn(),
	vplRemoveNode: vi.fn()
}));
vi.mock('../ipc/commands', () => ipc);

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('../common/import', () => ({ anyExtension: () => ['versatiles', 'vpl'], askForSource: vi.fn() }));
vi.mock('../map/add-source', () => ({ fitToBounds: vi.fn() }));
vi.mock('../map/composition.svelte', () => ({ composition: { drawn: false, editedName: null } }));

const state = vi.hoisted(() => ({ current: null as ReturnType<typeof doc> | null, graph: null as number | null }));

vi.mock('./document.svelte', () => ({
	document: {
		get current() {
			return state.current;
		},
		get graph() {
			return state.graph;
		},
		show: (next: unknown) => {
			calls.push('document.show');
			state.current = next as ReturnType<typeof doc>;
			state.graph = (next as { graph: number } | null)?.graph ?? null;
		},
		update: note('document.update')
	}
}));
vi.mock('./graphs.svelte', () => ({
	graphs: {
		list: [],
		first: undefined,
		refresh: note('graphs.refresh', Promise.resolve()),
		remove: note('graphs.remove', Promise.resolve(null)),
		rename: note('graphs.rename', Promise.resolve()),
		mountAll: note('graphs.mountAll', Promise.resolve()),
		setEnabled: note('graphs.setEnabled', Promise.resolve()),
		setNodeEnabled: note('graphs.setNodeEnabled', Promise.resolve())
	}
}));
vi.mock('./preview.svelte', () => ({
	preview: {
		built: {},
		refresh: note('preview.refresh', Promise.resolve({ kind: 'shown' })),
		syncContainers: note('preview.syncContainers', Promise.resolve()),
		mount: note('preview.mount', Promise.resolve({ vpl: 'from_container filename=x' })),
		clear: note('preview.clear')
	}
}));
vi.mock('./layout.svelte', () => ({ layout: { current: null } }));
vi.mock('./project.svelte', () => ({
	project: {
		open: () => Promise.resolve({ sources: {}, order: [] }),
		at: () => Promise.resolve({ sources: {}, order: [] })
	}
}));
vi.mock('./style.svelte', () => ({ style: { restored: note('style.restored') } }));
vi.mock('./status.svelte', () => ({
	status: { busy: says('status.busy'), settle: note('status.settle'), fail: says('status.fail') }
}));

const { workbench } = await import('./workbench.svelte');

beforeEach(() => {
	calls.length = 0;
	state.current = null;
	state.graph = null;
	vi.clearAllMocks();
	ipc.getGraph.mockResolvedValue(doc(1));
});

describe('applying a document', () => {
	/**
	 * **The order is the rule.** The list has to be refetched before anything reads it - the unsaved
	 * dot lives there - and the containers have to be synced before the build, or the preview reads a
	 * source nobody opened. Doing the build first and the sync afterwards is the shape of bug where
	 * the map is right and the inspector is a step behind.
	 */
	it('shows it, refetches the list, syncs the containers, then builds', async () => {
		await workbench.applyDocument(doc(1) as never);

		expect(calls).toEqual([
			'document.show',
			'graphs.refresh',
			'preview.syncContainers',
			'preview.refresh',
			'status.settle'
		]);
	});
});

describe('opening a file', () => {
	it('says what it is opening before it goes and looks', async () => {
		ipc.importOpening.mockResolvedValue({ refused: null, kind: null });
		await workbench.open('/maps/berlin.versatiles');

		expect(calls[0]).toBe('status.busy(Opening berlin.versatiles…)');
	});

	// Three formats wear `.json`, so a TileJSON on disk is refused with a sentence rather than opened
	// as GeoJSON and failed three steps later.
	it('reports a refusal rather than opening the wrong thing', async () => {
		ipc.importOpening.mockResolvedValue({ refused: 'that is a TileJSON', kind: null });
		await workbench.open('/maps/tiles.json');

		expect(calls).toContain('status.fail(that is a TileJSON)');
		expect(calls).not.toContain('preview.refresh');
	});

	it('says so when nothing in this build can read it', async () => {
		ipc.importOpening.mockResolvedValue({ refused: null, kind: null });
		await workbench.open('/maps/notes.txt');

		expect(calls.some((call) => call.includes('no way to open notes.txt'))).toBe(true);
	});

	/**
	 * A `.vpl` goes through the funnel rather than being assigned: `open_vpl` creates the graph in the
	 * core, and a webview that only took the document back was left with a graph list that did not
	 * know about it - so everything downstream of "there is now a graph" behaved as though there were
	 * none, including the landing screen, which stayed up over the pipeline it had just opened.
	 */
	it('sends a pipeline through the funnel, so the graph list hears about it', async () => {
		ipc.importOpening.mockResolvedValue({ refused: null, kind: { id: 'pipeline', operation: null } });
		ipc.openVpl.mockResolvedValue(doc(7));
		await workbench.open('/maps/roads.vpl');

		expect(calls).toContain('graphs.refresh');
		expect(calls.indexOf('graphs.refresh')).toBeLessThan(calls.indexOf('preview.refresh'));
	});

	// A container is mounted as well as read, because the inspector reads its tiles directly (A4).
	it('mounts a container before it becomes the pipeline', async () => {
		ipc.importOpening.mockResolvedValue({ refused: null, kind: { id: 'container', operation: 'from_container' } });
		ipc.addGraph.mockResolvedValue(doc(1));
		await workbench.open('/maps/berlin.versatiles');

		expect(calls.indexOf('preview.mount')).toBeLessThan(calls.indexOf('document.show'));
	});

	/**
	 * A read node that arrives incomplete says so where the eye already is, and does not go on to
	 * build - the diagnostic names the field, and a builder error in the status bar would be further
	 * from it.
	 */
	it('reports an incomplete read node instead of building it', async () => {
		ipc.importOpening.mockResolvedValue({ refused: null, kind: { id: 'csv', operation: 'from_csv' } });
		ipc.importReadNode.mockResolvedValue('from_csv filename=x.csv');
		ipc.addGraph.mockResolvedValue(doc(1, 'x', [{ message: 'lon_column is not set' }]));
		await workbench.open('/data/x.csv');

		expect(calls).toContain('status.fail(lon_column is not set)');
		expect(calls).not.toContain('preview.refresh');
	});
});

describe('where an opened file lands', () => {
	/**
	 * **`current` is what File → Open and a dropped file mean.** Opening a file *is* setting the
	 * pipeline to its read node (Q22, Q25), from when a window held one document - so with a graph on
	 * screen the text goes into it.
	 */
	it('writes into the graph on screen by default', async () => {
		state.current = doc(4) as never;
		state.graph = 4;
		ipc.importOpening.mockResolvedValue({ refused: null, kind: { id: 'csv', operation: 'from_csv' } });
		ipc.importReadNode.mockResolvedValue('from_csv filename=x.csv');
		ipc.setGraph.mockResolvedValue(doc(4));

		await workbench.open('/data/x.csv');

		expect(ipc.setGraph).toHaveBeenCalled();
		expect(ipc.addGraph).not.toHaveBeenCalled();
	});

	/**
	 * **`new` is what a door in the Sources pane means.** That list adds sources, so a door on it that
	 * quietly overwrote the selected graph would be `＋ new graph…` doing the opposite of its label -
	 * and the file that was already open would be gone with no undo entry naming it.
	 */
	it('adds a graph beside it when asked to', async () => {
		state.current = doc(4) as never;
		state.graph = 4;
		ipc.importOpening.mockResolvedValue({ refused: null, kind: { id: 'csv', operation: 'from_csv' } });
		ipc.importReadNode.mockResolvedValue('from_csv filename=x.csv');
		ipc.addGraph.mockResolvedValue(doc(5));

		await workbench.open('/data/x.csv', 'new');

		expect(ipc.addGraph).toHaveBeenCalled();
		expect(ipc.setGraph).not.toHaveBeenCalled();
	});

	// A container is mounted either way; what changes is only which graph its read node is written to.
	it('adds a container beside what is open too', async () => {
		state.current = doc(4) as never;
		state.graph = 4;
		ipc.importOpening.mockResolvedValue({ refused: null, kind: { id: 'container', operation: 'from_container' } });
		ipc.addGraph.mockResolvedValue(doc(5));

		await workbench.open('/maps/berlin.versatiles', 'new');

		expect(calls).toContain('preview.mount');
		expect(ipc.addGraph).toHaveBeenCalled();
		expect(ipc.setGraph).not.toHaveBeenCalled();
	});

	// With nothing open the two are the same thing, and neither has to know that.
	it('creates the first graph whichever was asked for', async () => {
		ipc.importOpening.mockResolvedValue({ refused: null, kind: { id: 'csv', operation: 'from_csv' } });
		ipc.importReadNode.mockResolvedValue('from_csv filename=x.csv');
		ipc.addGraph.mockResolvedValue(doc(1));

		await workbench.open('/data/x.csv');

		expect(ipc.addGraph).toHaveBeenCalled();
	});
});

describe('adopting a project', () => {
	/**
	 * Every graph is mounted, not just the one that opens - a style names them all (S6.5), and this is
	 * the moment a person is already waiting. Before the build, or the stack it composes over is a
	 * graph short.
	 */
	it('restores the recipe, then mounts every graph before building', async () => {
		await workbench.adopt(() => Promise.resolve({ sources: {}, order: [] } as never));

		expect(calls).toEqual([
			'style.restored',
			'graphs.refresh',
			'graphs.mountAll',
			'preview.refresh',
			'status.settle',
			'status.settle'
		]);
	});

	it('does nothing at all when the dialog was cancelled', async () => {
		await workbench.adopt(() => Promise.resolve(null));
		expect(calls).toEqual([]);
	});
});

describe('removing a graph', () => {
	// With no graph left, `refresh` returns early - so the layer it drew would outlive the graph it
	// came from, and the map would go on showing tiles from a document that is gone.
	it('clears the map when that was the last one', async () => {
		state.graph = 1;
		await workbench.remove(1);

		expect(calls).toContain('preview.clear');
		expect(calls).not.toContain('preview.refresh');
	});
});

describe('what the OS hands over', () => {
	// The launcher hands a project folder over the same queue a double-clicked container arrives on,
	// and a directory has no read node - so asking first is what tells them apart (S7.5).
	it('adopts a directory and opens a file', async () => {
		ipc.isProject.mockResolvedValue(true);
		await workbench.openPath('/projects/berlin');
		expect(calls).toContain('style.restored');

		calls.length = 0;
		ipc.isProject.mockResolvedValue(false);
		ipc.importOpening.mockResolvedValue({ refused: null, kind: null });
		await workbench.openPath('/maps/berlin.versatiles');
		expect(calls[0]).toBe('status.busy(Opening berlin.versatiles…)');
	});
});
