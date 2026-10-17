import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contents, LayerContents } from '../ipc/commands';

/**
 * What the Analysis pane remembers about each source's layers (S14.7).
 */

const ipc = vi.hoisted(() => ({ scanContents: vi.fn() }));
vi.mock('../ipc/commands', () => ipc);

const { scans, combine } = await import('./contents.svelte');

const layer = (name: string, bytes: number): LayerContents => ({
	name,
	tiles: 1,
	features: 10,
	bytes,
	geometryBytes: bytes / 2,
	propertyBytes: bytes / 4,
	tagBytes: bytes / 8,
	idBytes: 0,
	otherBytes: bytes / 8
});

const contents: Contents = {
	sampled: false,
	read: 3,
	undecodable: 0,
	levels: [
		{ level: 13, tiles: 1, read: 1, layers: [layer('water', 800), layer('roads', 400)] },
		{ level: 14, tiles: 2, read: 2, layers: [layer('roads', 1600), layer('pois', 80)] }
	]
};

beforeEach(() => {
	vi.clearAllMocks();
	scans.clear();
});

describe('the layers of a source', () => {
	it('sums a layer over every level, the heaviest first', () => {
		const all = combine(contents, null);
		expect(all.map((l) => [l.name, l.bytes, l.features])).toEqual([
			['roads', 2000, 20],
			['water', 800, 10],
			['pois', 80, 10]
		]);
		expect(all[0].geometryBytes).toBe(1000);
	});

	it('reads one level alone', () => {
		expect(combine(contents, 13).map((l) => l.name)).toEqual(['water', 'roads']);
		expect(combine(contents, 7)).toEqual([]);
	});

	/** Summing must not reach back into the answer it summed: the next sum would count twice. */
	it('leaves the scan as it found it', () => {
		combine(contents, null);
		expect(contents.levels[0].layers[1].bytes).toBe(400);
	});

	it('remembers a scan with its build, and keeps it through a failed rescan', async () => {
		ipc.scanContents.mockResolvedValueOnce(contents).mockRejectedValueOnce(new Error('not drawn'));
		await scans.scan(1, 'build-1', false);
		expect(ipc.scanContents).toHaveBeenCalledWith(1, false);
		expect(scans.stale(1, 'build-1')).toBe(false);
		expect(scans.stale(1, 'build-2')).toBe(true);
		await scans.scan(1, 'build-2', true);
		expect(scans.of(1)).toMatchObject({ contents, error: 'not drawn', running: false, build: 'build-1' });
		expect(scans.of(2).contents).toBeNull();
	});
});
