import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The three rules that used to live in the order of statements inside `App.svelte`.
 *
 * Each one fails silently in the running application — a layer that cannot be removed, a stale
 * build overwriting a newer one, a status bar stuck on "Opening …" — which is why they are worth a
 * test apiece rather than a careful reading.
 */

const added: unknown[] = [];
const removed: string[] = [];

vi.mock('../map/add-source', () => ({
	addContainerToMap: (_map: unknown, p: unknown) => (added.push(p), true),
	removeContainerFromMap: (_map: unknown, name: string) => void removed.push(name)
}));

const ipc = vi.hoisted(() => ({
	mountGraph: vi.fn(),
	previewPipeline: vi.fn(),
	openContainer: vi.fn()
}));
vi.mock('../ipc/commands', () => ipc);

const { preview } = await import('./preview.svelte');

/** A built preview under a given mount name. Only the fields this module reads are filled in. */
function built(name: string) {
	return {
		name,
		tileUrl: `x://${name}`,
		layers: [],
		info: { source: name, tileFormat: 'mvt', tileJson: { vector_layers: [{ id: 'water' }] } }
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
	vi.resetAllMocks();
});

describe('the preview on the map', () => {
	it('takes the old layer off before it forgets what it was called', async () => {
		ipc.mountGraph.mockResolvedValueOnce(built('first'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled });
		expect(removed).toEqual([]);

		ipc.mountGraph.mockResolvedValueOnce(built('second'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled });

		// Without this the first mount stays on the map for the rest of the session: the only handle
		// that could remove it was overwritten by the second build.
		expect(removed).toEqual(['first']);
		expect(preview.last?.name).toBe('second');
	});

	it('lets a superseded build change nothing on its way out', async () => {
		ipc.mountGraph.mockResolvedValueOnce(built('current'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled });

		ipc.previewPipeline.mockResolvedValueOnce({ kind: 'superseded' });
		const outcome = await preview.refresh({
			map,
			pipeline: document(),
			pinned: { graph: 1, path: [0] },
			styled: unstyled
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
			styled: unstyled
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
			styled: unstyled
		});
		expect(outcome).toEqual({ kind: 'unavailable' });
	});

	it('leaves the hairlines off when a style is drawing these tiles', async () => {
		ipc.mountGraph.mockResolvedValueOnce(built('styled-one'));
		const outcome = await preview.refresh({
			map,
			pipeline: document(),
			pinned: null,
			styled: () => true
		});

		expect(outcome).toEqual({ kind: 'shown' });
		expect(added).toEqual([]);
		// Still the current mount, so the next refresh knows what to take off.
		expect(preview.last?.name).toBe('styled-one');
	});

	it('asks about the style after the build, not before', async () => {
		// `styled` is derived from the preview this call produces, so a value read up front is the
		// previous build's answer — which puts hairlines over a styled map every other refresh.
		ipc.mountGraph.mockResolvedValueOnce(built('one'));
		const seen: (string | null)[] = [];
		await preview.refresh({
			map,
			pipeline: document(),
			pinned: null,
			styled: () => (seen.push(preview.last?.name ?? null), false)
		});
		expect(seen).toEqual(['one']);
	});

	it('forgets the mount when the last graph goes', async () => {
		ipc.mountGraph.mockResolvedValueOnce(built('only'));
		await preview.refresh({ map, pipeline: document(), pinned: null, styled: unstyled });

		preview.clear(map);
		expect(removed).toEqual(['only']);
		// And not a second time — the layer is already gone.
		preview.clear(map);
		expect(removed).toEqual(['only']);
	});
});
