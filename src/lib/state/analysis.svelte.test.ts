import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sizes } from '../ipc/commands';

/**
 * What the Analysis pane remembers about each source (S14.2).
 */

const ipc = vi.hoisted(() => ({ measureSizes: vi.fn() }));
vi.mock('../ipc/commands', () => ipc);

const { analysis } = await import('./analysis.svelte');

const sizes = { tiles: 1, bytes: 10, p50: 10, p95: 10, max: 10, levels: [], biggest: [] } as Sizes;

beforeEach(() => {
	vi.clearAllMocks();
	analysis.clear();
});

describe('a measurement', () => {
	it('is blank for a source nobody measured', () => {
		expect(analysis.of(1)).toEqual({ sizes: null, error: null, running: false, build: null });
		expect(analysis.stale(1, 'a')).toBe(false);
	});

	it('is running while the walk is, and keeps the answer with the build it was about', async () => {
		let answer: (value: Sizes) => void = () => {};
		ipc.measureSizes.mockReturnValue(new Promise((resolve) => (answer = resolve)));
		const done = analysis.measure(1, 'build-1');
		expect(analysis.of(1).running).toBe(true);
		answer(sizes);
		await done;
		expect(analysis.of(1)).toEqual({ sizes, error: null, running: false, build: 'build-1' });
	});

	it('is stale once the map draws another build, and not before', async () => {
		ipc.measureSizes.mockResolvedValue(sizes);
		await analysis.measure(1, 'build-1');
		expect(analysis.stale(1, 'build-1')).toBe(false);
		expect(analysis.stale(1, 'build-2')).toBe(true);
	});

	/** A failed re-measure must not take the figures that were already there with it. */
	it('keeps the last answer when a later one fails', async () => {
		ipc.measureSizes.mockResolvedValueOnce(sizes).mockRejectedValueOnce(new Error('no index'));
		await analysis.measure(1, 'build-1');
		await analysis.measure(1, 'build-2');
		expect(analysis.of(1)).toMatchObject({ sizes, error: 'no index', running: false, build: 'build-1' });
	});

	it('belongs to one source', async () => {
		ipc.measureSizes.mockResolvedValue(sizes);
		await analysis.measure(1, 'a');
		expect(analysis.of(2).sizes).toBeNull();
	});
});
