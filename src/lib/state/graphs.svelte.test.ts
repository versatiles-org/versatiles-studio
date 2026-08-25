import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphInfo } from '../ipc/commands';

/**
 * The three rules that used to be enforced by the order of statements inside `App.svelte`.
 *
 * Each fails quietly in the running application: tiles that stay on the map with nothing left to
 * remove them by, a renamed graph whose style resets itself, a graph whose eye says it is gone
 * while its tiles are still drawing. None of them is a crash, which is why each is worth a test
 * rather than a careful reading.
 */

const ipc = vi.hoisted(() => ({
	listGraphs: vi.fn(),
	removeGraph: vi.fn(),
	renameGraph: vi.fn(),
	setGraphEnabled: vi.fn(),
	setNodeEnabled: vi.fn()
}));
vi.mock('../ipc/commands', () => ipc);

const forgotten: string[] = [];
const mounted: number[][] = [];
const rebuilt: number[] = [];
vi.mock('./preview.svelte', () => ({
	preview: {
		get built() {
			return { basemap: {} };
		},
		forget: (name: string) => void forgotten.push(name),
		mountAll: (ids: number[]) => void mounted.push(ids),
		rebuild: (id: number) => void rebuilt.push(id)
	}
}));

const { graphs } = await import('./graphs.svelte');

const info = (id: number, name: string, enabled = true): GraphInfo =>
	({ id, name, enabled, disabled: [], nodes: 3 }) as unknown as GraphInfo;

beforeEach(async () => {
	forgotten.length = 0;
	mounted.length = 0;
	rebuilt.length = 0;
	ipc.listGraphs.mockResolvedValue([info(1, 'basemap'), info(2, 'places')]);
	ipc.removeGraph.mockResolvedValue(undefined);
	ipc.renameGraph.mockResolvedValue(undefined);
	ipc.setGraphEnabled.mockResolvedValue(true);
	ipc.setNodeEnabled.mockResolvedValue(null);
	await graphs.refresh();
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

describe('the eyes ([Q49])', () => {
	// **The half that fails quietly.** Telling the core is not enough: a graph whose tiles are still
	// mounted keeps drawing under its own name, so the eye would say "off" over a map that shows it.
	it('forgets the tiles of a graph it switches off', async () => {
		ipc.listGraphs.mockResolvedValue([info(1, 'basemap', false), info(2, 'places')]);
		await graphs.setEnabled(1, false);

		expect(ipc.setGraphEnabled).toHaveBeenCalledWith(1, false);
		expect(forgotten).toEqual(['basemap']);
		expect(mounted, 'and nothing is built for a graph that is off').toEqual([]);
	});

	it('builds it again when it comes back on', async () => {
		await graphs.setEnabled(2, true);

		expect(ipc.setGraphEnabled).toHaveBeenCalledWith(2, true);
		expect(forgotten).toEqual([]);
		expect(mounted.flat()).toContain(2);
	});

	// A graph that is off costs nothing when the project opens, which is most of the point.
	it('leaves a switched-off graph unbuilt on open', async () => {
		ipc.listGraphs.mockResolvedValue([info(1, 'basemap'), info(2, 'places', false)]);
		await graphs.refresh();
		await graphs.mountAll();

		expect(mounted).toEqual([]);
	});

	// Switching a node off changes what that graph *is*, so its own tiles have to follow - which is
	// the difference from the pin, whose tiles were a mount of their own.
	it('rebuilds the graph a node was switched off in', async () => {
		await graphs.setNodeEnabled(1, [2], false);

		expect(ipc.setNodeEnabled).toHaveBeenCalledWith(1, [2], false);
		expect(rebuilt).toEqual([1]);
	});

	it('reports what the core refuses rather than pretending it worked', async () => {
		ipc.setNodeEnabled.mockRejectedValue(new Error("'from_stacked' needs at least one source"));

		await expect(graphs.setNodeEnabled(1, [0, 1, 0], false)).rejects.toThrow('at least one source');
		expect(rebuilt).toEqual([]);
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
