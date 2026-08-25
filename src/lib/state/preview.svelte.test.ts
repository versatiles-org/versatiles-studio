import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The three rules that used to live in the order of statements inside `App.svelte`.
 *
 * Each one fails silently in the running application - a layer that cannot be removed, a stale
 * build overwriting a newer one, a status bar stuck on "Opening …" - which is why they are worth a
 * test apiece rather than a careful reading.
 */

const added: unknown[] = [];
const removed: string[] = [];
const fitted: unknown[] = [];

vi.mock('../map/add-source', () => ({
	addContainerToMap: (_map: unknown, p: unknown) => (added.push(p), true),
	removeContainerFromMap: (_map: unknown, name: string) => void removed.push(name),
	fitToBounds: (_map: unknown, bbox: unknown) => void fitted.push(bbox)
}));

const ipc = vi.hoisted(() => ({
	mountGraph: vi.fn(),
	previewPipeline: vi.fn(),
	openContainer: vi.fn()
}));
vi.mock('../ipc/commands', () => ipc);

const { preview, layersIn } = await import('./preview.svelte');

/** A built preview under a given mount name. Only the fields this module reads are filled in. */
function built(name: string) {
	return {
		name,
		tileUrl: `x://${name}`,
		layers: [],
		info: {
			source: name,
			tileFormat: 'mvt',
			bbox: [13, 52, 14, 53],
			tileJson: { vector_layers: [{ id: 'water' }] }
		}
	};
}

/** A valid document. `diagnostics` is what decides whether it is built at all. */
function document(diagnostics: unknown[] = []) {
	return { graph: 1, diagnostics, pipeline: { nodes: [] } } as never;
}

const map = {} as never;
const unstyled = () => false;

beforeEach(() => {
	preview.reset();
	added.length = 0;
	removed.length = 0;
	fitted.length = 0;
	vi.resetAllMocks();
});

describe('the preview on the map', () => {
	it('takes the old layer off before it forgets what it was called', async () => {
		ipc.mountGraph.mockResolvedValueOnce(built('first'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });
		expect(removed).toEqual([]);

		ipc.mountGraph.mockResolvedValueOnce(built('second'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });

		// Without this the first mount stays on the map for the rest of the session: the only handle
		// that could remove it was overwritten by the second build.
		expect(removed).toEqual(['first']);
		expect(preview.last?.name).toBe('second');
	});

	it('lets a superseded build change nothing on its way out', async () => {
		ipc.mountGraph.mockResolvedValueOnce(built('current'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });

		ipc.previewPipeline.mockResolvedValueOnce({ kind: 'superseded' });
		const outcome = await preview.refresh({
			map,
			pipeline: document(),
			pinned: { graph: 1, path: [0] },
			styled: unstyled,
			restored: false
		});

		expect(outcome).toEqual({ kind: 'superseded' });
		// The newer build owns all three of these. A cancelled build that tidied up after itself
		// would take the newer preview off the map.
		expect(preview.last?.name).toBe('current');
		expect(removed).toEqual([]);
		expect(added).toHaveLength(1);
	});

	it('does not build a document that does not validate, and still quiets the bar', async () => {
		const outcome = await preview.refresh({
			map,
			pipeline: document([{ message: 'filename is required' }]),
			pinned: null,
			styled: unstyled,
			restored: false
		});

		// `nothing`, not `unavailable`: there is a graph, so the caller has to stop saying it is
		// working on one. The pane is already showing the diagnostic.
		expect(outcome).toEqual({ kind: 'nothing' });
		expect(ipc.mountGraph).not.toHaveBeenCalled();
	});

	it('says nothing at all when there is no map yet', async () => {
		// The reload case: the document is back from the core before the map exists. Reporting
		// `nothing` here would clear an "Opening …" that is still true.
		const outcome = await preview.refresh({
			map: undefined,
			pipeline: document(),
			pinned: null,
			styled: unstyled,
			restored: false
		});
		expect(outcome).toEqual({ kind: 'unavailable' });
	});

	it('leaves the hairlines off when a style is drawing these tiles', async () => {
		ipc.mountGraph.mockResolvedValueOnce(built('styled-one'));
		const outcome = await preview.refresh({
			map,
			pipeline: document(),
			pinned: null,
			styled: () => true,
			restored: false
		});

		expect(outcome).toEqual({ kind: 'shown' });
		expect(added).toEqual([]);
		// Still the build the rest of the window composes its style from.
		expect(preview.last?.name).toBe('styled-one');
	});

	/**
	 * What the console said, once per save: `Source "pipeline" cannot be removed while layer
	 * "pipeline/pipeline:raster" is using it.`
	 *
	 * Nothing was mounted - the recipe drew those tiles and this module drew none of them - but the
	 * mount name was recorded anyway, so the next refresh tried to take the *style's* source off the
	 * map. A mount's name is the style's source name too ([Q32]), which is what made the mistake
	 * reach MapLibre instead of failing to find anything.
	 */
	it('has nothing to take off again when a style drew the tiles', async () => {
		ipc.mountGraph.mockResolvedValueOnce(built('pipeline'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: () => true, restored: false });

		ipc.mountGraph.mockResolvedValueOnce(built('pipeline'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: () => true, restored: false });
		expect(removed).toEqual([]);

		// And the same on the way back out of a style: still nothing of this module's on the map.
		ipc.mountGraph.mockResolvedValueOnce(built('pipeline'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });
		expect(removed).toEqual([]);
		expect(added).toHaveLength(1);
	});

	it('forgets the mount when the style it was drawn on is replaced', async () => {
		// `restore` is called once the new style is in place. Setting a style discards every layer
		// added to the old one, so a name kept across it points at layers that are already gone -
		// and quite possibly at a source the *new* style owns.
		ipc.mountGraph.mockResolvedValueOnce(built('pipeline'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });

		preview.restore(map, true);
		expect(added, 'not over a styled map').toHaveLength(1);

		ipc.mountGraph.mockResolvedValueOnce(built('pipeline'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });
		expect(removed).toEqual([]);
	});

	it('puts the preview back after a style swap, and knows it is there', async () => {
		ipc.mountGraph.mockResolvedValueOnce(built('pipeline'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });

		preview.restore(map, false);
		expect(added).toHaveLength(2);

		// Drawn again means mounted again: the next refresh has to take those layers off.
		ipc.mountGraph.mockResolvedValueOnce(built('pipeline'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });
		expect(removed).toEqual(['pipeline']);
	});

	it('asks about the style after the build, not before', async () => {
		// `styled` is derived from the preview this call produces, so a value read up front is the
		// previous build's answer - which puts hairlines over a styled map every other refresh.
		ipc.mountGraph.mockResolvedValueOnce(built('one'));
		const seen: (string | null)[] = [];
		await preview.refresh({
			map,
			pipeline: document(),
			pinned: null,
			styled: () => (seen.push(preview.last?.name ?? null), false),
			restored: false
		});
		expect(seen).toEqual(['one']);
	});

	it('frames the data when tiles first appear', async () => {
		ipc.mountGraph.mockResolvedValueOnce(built('first'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });
		expect(fitted).toEqual([[13, 52, 14, 53]]);
	});

	/**
	 * The bug this pair exists for: every edit to the VPL rebuilds the preview, and the camera used
	 * to be refit at the end of `addContainerToMap`. Panning somewhere to look at a change threw you
	 * straight back out of it.
	 */
	it('leaves the camera alone on every rebuild after that', async () => {
		ipc.mountGraph.mockResolvedValueOnce(built('first'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });
		expect(fitted).toHaveLength(1);

		for (const name of ['second', 'third']) {
			ipc.mountGraph.mockResolvedValueOnce(built(name));
			await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });
		}
		expect(fitted, 'a rebuild must not move the map').toHaveLength(1);
	});

	it('frames again once the map has been emptied', async () => {
		// `clear` is the last graph going; whatever comes next is a first appearance again.
		ipc.mountGraph.mockResolvedValueOnce(built('first'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });
		preview.clear(map);

		ipc.mountGraph.mockResolvedValueOnce(built('next'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });
		expect(fitted).toHaveLength(2);
	});

	/**
	 * **Framing is not one of the things a recipe takes over.**
	 *
	 * This used to assert the opposite, and the opposite was the bug: the fit sat below the `styled`
	 * early return, so a window whose tiles a style was drawing - since S6.2, very nearly every
	 * window - opened at null island and stayed there until somebody pressed Reset view.
	 */
	it('frames the data whoever is drawing it', async () => {
		ipc.mountGraph.mockResolvedValueOnce(built('styled-two'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: () => true, restored: false });

		expect(fitted).toEqual([[13, 52, 14, 53]]);
		expect(added, 'and still no hairlines over a styled map').toEqual([]);
	});

	/**
	 * What a reload is for. The window's camera comes back from the core ([Q48], S7.4), and framing
	 * the data over the top of it would undo the one thing a reload is supposed to preserve - a
	 * window that came back exactly where it was, looking at the same place.
	 */
	it('does not frame over a camera the window already has', async () => {
		ipc.mountGraph.mockResolvedValueOnce(built('reopened'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: true });

		expect(fitted).toEqual([]);
		expect(added, 'and still draws what it built').toHaveLength(1);
	});

	it('leaves the camera alone when a style is switched off', async () => {
		// The tiles were on screen the whole time - the recipe was drawing them - so the hairlines
		// taking over is not a first appearance. Asking "did *this module* mount anything" instead
		// would throw the camera back to the data's extent on the way out of a style.
		ipc.mountGraph.mockResolvedValueOnce(built('styled-three'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: () => true, restored: false });
		expect(fitted, 'framed once, when the data first appeared').toHaveLength(1);

		ipc.mountGraph.mockResolvedValueOnce(built('styled-three'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });
		expect(fitted, 'and not again for a change of who draws it').toHaveLength(1);
	});

	it('forgets the mount when the last graph goes', async () => {
		ipc.mountGraph.mockResolvedValueOnce(built('only'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });

		preview.clear(map);
		expect(removed).toEqual(['only']);
		// And not a second time - the layer is already gone.
		preview.clear(map);
		expect(removed).toEqual(['only']);
	});
});

/** A `from_container` read node pointing at `source`. */
function readNode(source: string) {
	return {
		name: 'from_container',
		sources: [],
		properties: [{ key: 'filename', value: { kind: 'single', value: source } }]
	};
}

const withNodes = (...nodes: unknown[]) => ({ graph: 1, diagnostics: [], pipeline: { nodes } }) as never;

describe('the containers the document reads', () => {
	beforeEach(() => {
		ipc.openContainer.mockImplementation((source: string) => Promise.resolve({ info: { source } }));
	});

	// The read nodes *are* the sources (Q22), so editing one has to move the map with it - otherwise
	// the document and the picture drift apart, which is what merging the modes was meant to prevent.
	it('opens a container the document names', async () => {
		const opening: string[] = [];
		await preview.syncContainers(withNodes(readNode('berlin.mbtiles')), (s) => void opening.push(s));

		expect(preview.containers.map((c) => c.info.source)).toEqual(['berlin.mbtiles']);
		expect(opening).toEqual(['berlin.mbtiles']);
	});

	it('drops one the document no longer names', async () => {
		await preview.syncContainers(withNodes(readNode('berlin.mbtiles')), () => {});
		await preview.syncContainers(withNodes(readNode('paris.mbtiles')), () => {});
		expect(preview.containers.map((c) => c.info.source)).toEqual(['paris.mbtiles']);
	});

	// Reading a container is not always instant - a remote one reads its index over the network - so
	// one already open must not be read again on every keystroke.
	it('does not re-read one it already has', async () => {
		await preview.syncContainers(withNodes(readNode('berlin.mbtiles')), () => {});
		ipc.openContainer.mockClear();
		const opening: string[] = [];
		await preview.syncContainers(withNodes(readNode('berlin.mbtiles')), (s) => void opening.push(s));
		expect(ipc.openContainer).not.toHaveBeenCalled();
		expect(opening).toEqual([]);
	});

	it('ignores nodes that are not containers, and containers with no filename yet', async () => {
		await preview.syncContainers(
			withNodes(
				{ name: 'from_debug', sources: [], properties: [] },
				{ name: 'from_container', sources: [], properties: [] }
			),
			() => {}
		);
		expect(preview.containers).toEqual([]);
	});
});

describe('the stack of built graphs', () => {
	it('builds each one and files it under its name', async () => {
		ipc.mountGraph.mockImplementation((id: number) => Promise.resolve(built(`graph-${id}`)));
		await preview.mountAll([1, 2]);
		expect(Object.keys(preview.built).sort()).toEqual(['graph-1', 'graph-2']);
	});

	// One graph that will not build must not stop the others arriving; the one being edited reports
	// its own problems through `refresh`.
	it('keeps the graphs that did build when one fails', async () => {
		ipc.mountGraph.mockImplementation((id: number) =>
			id === 1 ? Promise.reject(new Error('no')) : Promise.resolve(built('places'))
		);
		await preview.mountAll([1, 2]);
		expect(Object.keys(preview.built)).toEqual(['places']);
	});

	it('forgets a graph that has been removed', async () => {
		ipc.mountGraph.mockResolvedValue(built('places'));
		await preview.mountAll([1]);
		preview.forget('places');
		expect(preview.built).toEqual({});
	});

	it('ignores being asked to forget one it does not have', async () => {
		preview.forget('never-existed');
		expect(preview.built).toEqual({});
	});
});

describe('putting the preview back after a style swap', () => {
	// A style swap discards every layer added to the old style, so the preview has to go back on.
	it('re-adds the hairlines when nothing else is drawing these tiles', async () => {
		ipc.mountGraph.mockResolvedValue(built('berlin'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });
		added.length = 0;

		preview.restore(map, false);
		expect(added).toHaveLength(1);
	});

	// They are the fallback for a preset that matches nothing; over a styled map they would put a
	// line over every feature the style just drew.
	it('leaves them off when a style is drawing them', async () => {
		ipc.mountGraph.mockResolvedValue(built('berlin'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled, restored: false });
		added.length = 0;

		preview.restore(map, true);
		expect(added).toEqual([]);
	});

	it('does nothing before there is a map', () => {
		preview.restore(undefined, false);
		expect(added).toEqual([]);
	});
});

describe('what a preview’s tiles contain', () => {
	it('reads the layer names out of its TileJSON', () => {
		expect(layersIn(built('berlin') as never)).toEqual(['water']);
	});

	it('says nothing for a preview that has none, or none at all', () => {
		expect(layersIn(null)).toEqual([]);
		expect(layersIn({ info: {} } as never)).toEqual([]);
	});
});
