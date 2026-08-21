import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATIENCE, fetchTile, tiles } from './tiles.svelte';
import { SCHEME } from '../map/tile-queue';

/**
 * Tile requests the test decides when to answer.
 *
 * A fresh `Response` per call, not one shared: a body can only be read once, so handing the same
 * object to every request fails the second one for a reason that has nothing to do with queueing.
 */
function pending() {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	return {
		fetch: async () => {
			await gate;
			return new Response(new ArrayBuffer(8), { status: 200, headers: { 'cache-control': 'max-age=60' } });
		},
		deliver: () => release()
	};
}

function request(n: number) {
	return fetchTile(
		{ url: `${SCHEME}://127.0.0.1:1/tiles/g/1/${n}/1` } as never,
		new AbortController() as never
	) as Promise<unknown>;
}

describe('tile activity', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('says nothing about a pipeline that keeps up', async () => {
		const tile = pending();
		vi.stubGlobal('fetch', tile.fetch);

		const inFlight = request(1);
		await vi.advanceTimersByTimeAsync(PATIENCE - 100);

		expect(tiles.rendering).toBe(1);
		expect(tiles.message).toBeNull();

		tile.deliver();
		await inFlight;
		expect(tiles.message).toBeNull();
		expect([tiles.rendering, tiles.queued]).toEqual([0, 0]);
	});

	it('speaks up once the wait has lasted long enough', async () => {
		const tile = pending();
		vi.stubGlobal('fetch', tile.fetch);

		const inFlight = request(1);
		await vi.advanceTimersByTimeAsync(PATIENCE);

		expect(tiles.message).toBe('Tiles: rendering 1');

		tile.deliver();
		await inFlight;
		// And stops the moment the map has what it asked for.
		expect(tiles.message).toBeNull();
	});

	// The distinction is the whole point: queued means Studio is holding tiles back, rendering means
	// an operation is taking its time over each one.
	it('counts what is waiting separately from what is being rendered', async () => {
		const tile = pending();
		vi.stubGlobal('fetch', tile.fetch);

		const all = Array.from({ length: 9 }, (_, n) => request(n));
		await vi.advanceTimersByTimeAsync(PATIENCE);

		expect(tiles.rendering).toBe(6);
		expect(tiles.queued).toBe(3);
		expect(tiles.message).toBe('Tiles: rendering 6, 3 queued');

		tile.deliver();
		await Promise.all(all);
		expect([tiles.rendering, tiles.queued]).toEqual([0, 0]);
	});

	it('a failed tile is not counted forever', async () => {
		vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }));
		await expect(request(1)).rejects.toThrow(/500/);
		expect([tiles.rendering, tiles.queued]).toEqual([0, 0]);
		expect(tiles.message).toBeNull();
	});
});
