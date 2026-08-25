import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphInfo } from '../ipc/commands';

/**
 * The three rules that used to be enforced by the order of statements inside `App.svelte`.
 *
 * Each fails quietly in the running application: tiles that stay on the map with nothing left to
 * remove them by, a renamed graph whose style resets itself, a pin left pointing at a graph that is
 * gone. None of them is a crash, which is why each is worth a test rather than a careful reading.
 */

const ipc = vi.hoisted(() => ({
	listGraphs: vi.fn(),
	removeGraph: vi.fn(),
	renameGraph: vi.fn(),
	setPin: vi.fn(),
	getPinned: vi.fn()
}));
vi.mock('../ipc/commands', () => ipc);

const forgotten: string[] = [];
const mounted: number[][] = [];
vi.mock('./preview.svelte', () => ({
	preview: {
		get built() {
			return { basemap: {} };
		},
		forget: (name: string) => void forgotten.push(name),
		mountAll: (ids: number[]) => void mounted.push(ids)
	}
}));

const { graphs } = await import('./graphs.svelte');

const info = (id: number, name: string): GraphInfo => ({ id, name }) as GraphInfo;

beforeEach(async () => {
	forgotten.length = 0;
	mounted.length = 0;
	ipc.listGraphs.mockResolvedValue([info(1, 'basemap'), info(2, 'places')]);
	ipc.removeGraph.mockResolvedValue(undefined);
	ipc.renameGraph.mockResolvedValue(undefined);
	ipc.getPinned.mockResolvedValue(null);
	ipc.setPin.mockImplementation((pin: unknown) => Promise.resolve(pin));
	await graphs.refresh();
	// **Module-scoped `$state` outlives a test.** Without this the pin set by one test is still
	// there for the next, and a toggle that should set reads as a toggle that clears.
	await graphs.readPin();
});

describe('the list', () => {
	it('says whether the project has anything in it', () => {
		expect(graphs.empty).toBe(false);
		expect(graphs.first?.name).toBe('basemap');
		expect(graphs.nameOf(2)).toBe('places');
		expect(graphs.nameOf(99)).toBeNull();
	});

	it('survives the core refusing to answer', async () => {
		ipc.listGraphs.mockRejectedValue(new Error('gone'));
		await graphs.refresh();
		expect(graphs.empty).toBe(true);
	});
});

describe('removing a graph', () => {
	// **The name has to be read before the removal.** Afterwards there is nothing left to look it up
	// with, so its tiles would stay on the map for the rest of the session.
	it('forgets its tiles by the name it had', async () => {
		ipc.listGraphs.mockResolvedValue([info(2, 'places')]);
		await graphs.remove(1);
		expect(forgotten).toEqual(['basemap']);
	});

	it('reports which graph should be shown next', async () => {
		ipc.listGraphs.mockResolvedValue([info(2, 'places')]);
		expect(await graphs.remove(1)).toBe(2);
	});

	it('reports nothing when that was the last one', async () => {
		ipc.listGraphs.mockResolvedValue([]);
		expect(await graphs.remove(1)).toBeNull();
	});

	// The core may have dropped the pin along with the graph; asking beats assuming which way.
	it('reads the pin back rather than guessing', async () => {
		ipc.listGraphs.mockResolvedValue([]);
		await graphs.remove(1);
		expect(ipc.getPinned).toHaveBeenCalled();
	});
});

describe('renaming a graph', () => {
	// The mount moves with the name, so the old entry is stale the moment this returns - and a stale
	// entry means the style resets itself to defaults on a rename.
	it('forgets the old name and rebuilds under the new one', async () => {
		ipc.listGraphs.mockResolvedValue([info(1, 'streets'), info(2, 'places')]);
		await graphs.rename(1, 'streets');
		expect(forgotten).toEqual(['basemap']);
		expect(mounted.flat()).toContain(1);
	});
});

describe('the pin', () => {
	it('moves to a node that was not pinned', async () => {
		await graphs.togglePin(1, [0, 2]);
		expect(graphs.pinned).toEqual({ graph: 1, path: [0, 2] });
	});

	// The same gesture off as on - a separate "clear" would be a control that only exists sometimes.
	it('clears when the node it names is already pinned', async () => {
		await graphs.togglePin(1, [0, 2]);
		await graphs.togglePin(1, [0, 2]);
		expect(graphs.pinned).toBeNull();
	});

	it('moves rather than clearing for a different node or a different graph', async () => {
		await graphs.togglePin(1, [0, 2]);
		await graphs.togglePin(1, [0, 3]);
		expect(graphs.pinned).toEqual({ graph: 1, path: [0, 3] });

		await graphs.togglePin(2, [0, 3]);
		expect(graphs.pinned).toEqual({ graph: 2, path: [0, 3] });
	});
});

describe('mounting', () => {
	// `built` already holds `basemap`, so only what is missing costs a build.
	it('builds only the graphs nothing has built yet', async () => {
		await graphs.mountAll();
		expect(mounted).toEqual([[2]]);
	});

	it('does nothing when everything is already built', async () => {
		ipc.listGraphs.mockResolvedValue([info(1, 'basemap')]);
		await graphs.refresh();
		await graphs.mountAll();
		expect(mounted).toEqual([]);
	});
});
