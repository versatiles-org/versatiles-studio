import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dissection } from '../ipc/commands';

/**
 * The tile dialog's state, and the moves between tiles (S14.5).
 */

const ipc = vi.hoisted(() => ({ dissectTile: vi.fn() }));
vi.mock('../ipc/commands', () => ipc);

const { tileDialog, parseAddress, parent, children, neighbour } = await import('./tile-dialog.svelte');

const dissection = (z: number, x: number, y: number) => ({ z, x, y }) as Dissection;

beforeEach(() => {
	vi.clearAllMocks();
	ipc.dissectTile.mockImplementation((_graph: number, z: number, x: number, y: number) =>
		Promise.resolve(dissection(z, x, y))
	);
	tileDialog.close();
});

describe('moving between tiles', () => {
	it('reads an address as typed, and refuses one that names no tile', () => {
		expect(parseAddress(' /14/8800/5373 ')).toEqual({ z: 14, x: 8800, y: 5373 });
		expect(parseAddress('14 / 8800 / 5373')).toEqual({ z: 14, x: 8800, y: 5373 });
		expect(parseAddress('2/4/0')).toBeNull();
		expect(parseAddress('14/8800')).toBeNull();
		expect(parseAddress('31/0/0')).toBeNull();
	});

	it('goes up to the parent, and has none at the top', () => {
		expect(parent(14, 8801, 5373)).toEqual({ z: 13, x: 4400, y: 2686 });
		expect(parent(0, 0, 0)).toBeNull();
	});

	it('goes down to four children, in reading order', () => {
		expect(children(1, 1, 0)).toEqual([
			{ z: 2, x: 2, y: 0 },
			{ z: 2, x: 3, y: 0 },
			{ z: 2, x: 2, y: 1 },
			{ z: 2, x: 3, y: 1 }
		]);
	});

	it('wraps east and west round the world, and stops at the poles', () => {
		expect(neighbour(2, 3, 1, 1, 0)).toEqual({ z: 2, x: 0, y: 1 });
		expect(neighbour(2, 0, 1, -1, 0)).toEqual({ z: 2, x: 3, y: 1 });
		expect(neighbour(2, 0, 0, 0, -1)).toBeNull();
		expect(neighbour(2, 0, 3, 0, 1)).toBeNull();
	});
});

describe('the tile dialog', () => {
	it('opens on a tile of a source and takes it apart', async () => {
		await tileDialog.open(3, 14, 8800, 5373);
		expect(tileDialog.at).toEqual({ graph: 3, z: 14, x: 8800, y: 5373 });
		expect(ipc.dissectTile).toHaveBeenCalledWith(3, 14, 8800, 5373);
		expect(tileDialog.dissection).toEqual(dissection(14, 8800, 5373));
		expect(tileDialog.loading).toBe(false);
	});

	it('moves within the same source', async () => {
		await tileDialog.open(3, 14, 8800, 5373);
		await tileDialog.go(13, 4400, 2686);
		expect(ipc.dissectTile).toHaveBeenLastCalledWith(3, 13, 4400, 2686);
	});

	/** A dense tile answers after the light one asked next; the light one is the one wanted. */
	it('drops an answer that a newer request has overtaken', async () => {
		let slow: (value: Dissection) => void = () => {};
		ipc.dissectTile.mockImplementationOnce(() => new Promise((resolve) => (slow = resolve)));
		const first = tileDialog.open(3, 14, 1, 1);
		await tileDialog.go(14, 2, 1);
		slow(dissection(14, 1, 1));
		await first;
		expect(tileDialog.dissection).toEqual(dissection(14, 2, 1));
	});

	it('says why it could not, and forgets everything on close', async () => {
		ipc.dissectTile.mockRejectedValueOnce(new Error('this source has not been drawn yet'));
		await tileDialog.open(3, 14, 1, 1);
		expect(tileDialog.error).toBe('this source has not been drawn yet');
		tileDialog.close();
		expect(tileDialog.at).toBeNull();
		expect(tileDialog.error).toBeNull();
	});
});
