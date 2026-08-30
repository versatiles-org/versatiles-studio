import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEADLINE, MAP_PATIENCE, PATIENCE, fetchTile, tiles } from './tiles.svelte';
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
		// **The signal is honoured**, because the real one is: a request MapLibre abandons rejects
		// rather than hanging, and a fake that ignores it cannot show what an abandoned tile does to
		// the squares on the map.
		fetch: async (_url: string, init?: { signal?: AbortSignal }) => {
			await Promise.race([
				gate,
				new Promise<never>((_resolve, reject) => {
					const signal = init?.signal;
					if (signal?.aborted) reject(new DOMException('aborted', 'AbortError'));
					signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
						once: true
					});
				})
			]);
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

/**
 * One coordinate, asked for at a given revision, with a controller the caller can abort.
 *
 * The revision is what a rebuild changes: replacing a source's tiles in place asks for the same
 * `z/x/y` again under a new `?v=`, while the outgoing request is still settling.
 */
function revision(n: number, v: number) {
	const controller = new AbortController();
	const done = fetchTile(
		{ url: `${SCHEME}://127.0.0.1:1/tiles/g/1/${n}/1?v=${v}` } as never,
		controller as never
	) as Promise<unknown>;
	return { done, abort: () => controller.abort() };
}

describe('tile activity', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		// The give-up records outlive a request on purpose, so a test that leaves one behind would
		// make the next one fail fast for a reason that has nothing to do with it.
		tiles.reset();
	});

	it('says nothing about a pipeline that keeps up', async () => {
		const tile = pending();
		vi.stubGlobal('fetch', tile.fetch);

		const inFlight = request(1);
		// One tick short of the threshold, whatever the threshold is - a fixed margin breaks the day
		// somebody lowers `PATIENCE` to watch the overlay, which is a reasonable thing to do.
		await vi.advanceTimersByTimeAsync(PATIENCE - 1);

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

	// The other half of the indicator: the markers draw these, so "nothing busy" and "no marker"
	// are the same bug seen from two ends.
	it('gives the map a point per pending tile, saying which state it is in', async () => {
		const tile = pending();
		vi.stubGlobal('fetch', tile.fetch);

		const all = Array.from({ length: 8 }, (_, n) => request(n));
		await vi.advanceTimersByTimeAsync(MAP_PATIENCE);

		const busy = tiles.busy;
		expect(busy).toHaveLength(8);
		expect(busy.map((t) => t.state).filter((state) => state === 'rendering')).toHaveLength(6);
		expect(busy.map((t) => t.state).filter((state) => state === 'queued')).toHaveLength(2);

		// Somewhere a marker can be put, rather than a ring to shade.
		const [lng, lat] = busy[0].center;
		expect(Number.isFinite(lng) && Number.isFinite(lat)).toBe(true);

		tile.deliver();
		await Promise.all(all);
		expect(tiles.busy).toHaveLength(0);
	});

	/**
	 * **Two waits, because they interrupt differently.** A line in the status bar is quiet enough to
	 * appear as soon as a wait is noticeable; a spinner sits on top of the map, over the thing being
	 * looked at, so it waits until the tile is late rather than merely slow. Panning a pipeline that
	 * answers in half a second should leave the map alone entirely.
	 */
	it('says something in the bar well before it marks the map', async () => {
		const tile = pending();
		vi.stubGlobal('fetch', tile.fetch);

		const all = Array.from({ length: 2 }, (_, n) => request(n));

		await vi.advanceTimersByTimeAsync(PATIENCE);
		expect(tiles.message, 'the bar speaks first').toBeTruthy();
		expect(tiles.busy, 'and the map stays clear').toHaveLength(0);

		await vi.advanceTimersByTimeAsync(MAP_PATIENCE - PATIENCE);
		expect(tiles.busy).toHaveLength(2);

		tile.deliver();
		await Promise.all(all);
	});

	/**
	 * **The overlay's job is to be believed.** Replacing a source's tiles in place - which is what a
	 * rebuild does rather than tearing the source down - leaves the outgoing request for a
	 * coordinate settling while the incoming one starts. The square belongs to the coordinate, but
	 * the *waiting* belongs to each request, and conflating the two made the first to finish take
	 * the square away from the second.
	 */
	describe('one coordinate asked for twice at once', () => {
		it('keeps the square while the newer request is still waiting', async () => {
			const tile = pending();
			vi.stubGlobal('fetch', tile.fetch);

			const old = revision(1, 1);
			const next = revision(1, 2);
			await vi.advanceTimersByTimeAsync(MAP_PATIENCE);
			expect(tiles.busy).toHaveLength(1);

			// The outgoing one is abandoned, as MapLibre abandons it when it reloads the tile.
			old.abort();
			await expect(old.done).rejects.toThrow();

			expect(tiles.busy, 'the newer request is still waiting for this tile').toHaveLength(1);
			expect(tiles.rendering).toBe(1);

			tile.deliver();
			await next.done;
			expect(tiles.busy).toHaveLength(0);
		});

		// Two requests, one tile: the map draws where it is, not how many times it was asked for.
		it('draws one square rather than two stacked on each other', async () => {
			const tile = pending();
			vi.stubGlobal('fetch', tile.fetch);

			const first = revision(1, 1);
			const second = revision(1, 2);
			await vi.advanceTimersByTimeAsync(MAP_PATIENCE);

			expect(tiles.busy).toHaveLength(1);
			// Both are being served, and the count is of requests - which is what the queue holds.
			expect(tiles.rendering).toBe(2);

			tile.deliver();
			await Promise.all([first.done, second.done]);
			expect(tiles.busy).toHaveLength(0);
		});

		// `rendering` and `queued` answer "is anyone working on this tile", so one request waiting
		// for a slot does not make that false while another is being served.
		it('says rendering while any of them is being served', async () => {
			const tile = pending();
			vi.stubGlobal('fetch', tile.fetch);

			// One slot for the outgoing request, five for other tiles, and the incoming ask for the
			// same coordinate is left waiting for a slot.
			const inFlight = revision(2, 1);
			const others = Array.from({ length: 5 }, (_, n) => request(n + 10));
			const queuedAgain = revision(2, 2);
			await vi.advanceTimersByTimeAsync(MAP_PATIENCE);

			expect([tiles.rendering, tiles.queued]).toEqual([6, 1]);
			const marker = tiles.busy.find((entry) => entry.key === '1/2/1');
			expect(marker?.state).toBe('rendering');

			tile.deliver();
			await Promise.all([...others, queuedAgain.done, inFlight.done]);
		});
	});

	it('says nothing to draw until the wait has lasted long enough', async () => {
		const tile = pending();
		vi.stubGlobal('fetch', tile.fetch);
		const inFlight = request(1);
		await vi.advanceTimersByTimeAsync(PATIENCE - 1);

		expect(tiles.rendering).toBe(1);
		expect(tiles.busy).toEqual([]);

		tile.deliver();
		await inFlight;
	});

	it('a failed tile is not counted forever', async () => {
		vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }));
		await expect(request(1)).rejects.toThrow(/500/);
		expect([tiles.rendering, tiles.queued]).toEqual([0, 0]);
		expect(tiles.message).toBeNull();
	});

	/**
	 * The bug this pair exists for: a tile set is sparse, so a 404 is the server answering rather
	 * than failing - and MapLibre only knows that if the error says so. It branches on `err.status`
	 * twice, in the worker source and in the tile cache; without one, panning a Berlin extract
	 * recorded a problem per empty tile and lost the fill from the parent tile as well.
	 */
	it('says 404 in a way MapLibre can read, so an empty tile is not a broken map', async () => {
		vi.stubGlobal('fetch', async () => new Response(null, { status: 404, statusText: 'Not Found' }));

		const failure = (await request(1).catch((error: unknown) => error)) as { status?: number };
		expect(failure.status).toBe(404);
	});

	it('carries any other status too, rather than only the one it branches on', async () => {
		vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }));

		const failure = (await request(1).catch((error: unknown) => error)) as { status?: number };
		expect(failure.status, 'a real failure is still a failure, and still says which').toBe(500);
	});
});

/**
 * Giving up on a tile that will not arrive (S2.16).
 *
 * **A tile request has no other end.** The server answers when the pipeline answers, and an overview
 * asked for a zoom far above its base level can take minutes over one tile ([vt#264]) - so without
 * this the map has a square that stays blank for ever, with nothing on screen to say why.
 *
 * [vt#264]: https://github.com/versatiles-org/versatiles-rs/issues/264
 */
describe('a tile that never arrives', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		tiles.reset();
	});

	/** Requests a tile and swallows the rejection, which is the caller's business rather than this. */
	function ask(url: string) {
		const done = (fetchTile({ url } as never, new AbortController() as never) as Promise<unknown>).catch(
			(error: unknown) => error
		);
		return done;
	}

	it('gives up once the deadline passes, and says so on the map', async () => {
		vi.stubGlobal('fetch', pending().fetch);

		const done = ask(`${SCHEME}://127.0.0.1:1/tiles/g/3/1/1`);
		await vi.advanceTimersByTimeAsync(DEADLINE - 1);
		expect(tiles.busy.some((mark) => mark.state === 'failed')).toBe(false);

		await vi.advanceTimersByTimeAsync(2);
		expect(await done).toBeInstanceOf(Error);

		const failed = tiles.busy.filter((mark) => mark.state === 'failed');
		expect(failed.map((mark) => mark.key)).toEqual(['3/1/1']);
		// Nothing is still counted as in flight: the wait is over, however it ended.
		expect([tiles.rendering, tiles.queued]).toEqual([0, 0]);
	});

	/**
	 * **The second tile does not wait again.** MapLibre re-requests on every pan and a cancelled
	 * request is not remembered upstream, so without this, sitting at a bad zoom burns the deadline
	 * per tile for ever.
	 */
	it('refuses the rest of a zoom that has already proved too slow', async () => {
		vi.stubGlobal('fetch', pending().fetch);

		const first = ask(`${SCHEME}://127.0.0.1:1/tiles/g/3/1/1`);
		await vi.advanceTimersByTimeAsync(DEADLINE + 1);
		await first;

		// No timers advanced: if this waited at all, it would still be pending here.
		expect(await ask(`${SCHEME}://127.0.0.1:1/tiles/g/3/2/1`)).toBeInstanceOf(Error);
		expect(
			tiles.busy
				.filter((mark) => mark.state === 'failed')
				.map((mark) => mark.key)
				.sort()
		).toEqual(['3/1/1', '3/2/1']);
	});

	/** Cost follows depth, so a judgement about one zoom says nothing about another. */
	it('leaves other zooms alone', async () => {
		const tile = pending();
		vi.stubGlobal('fetch', tile.fetch);

		const slow = ask(`${SCHEME}://127.0.0.1:1/tiles/g/3/1/1`);
		await vi.advanceTimersByTimeAsync(DEADLINE + 1);
		await slow;

		const deeper = ask(`${SCHEME}://127.0.0.1:1/tiles/g/9/1/1`);
		await vi.advanceTimersByTimeAsync(1);
		expect(tiles.rendering).toBe(1);

		tile.deliver();
		expect(await deeper).not.toBeInstanceOf(Error);
	});

	/**
	 * **An abort from MapLibre is not a failure.** It means the tile left the viewport, which happens
	 * on every pan - marking those would put error rings all over an ordinary map.
	 */
	it('does not mark a tile the map abandoned', async () => {
		vi.stubGlobal('fetch', pending().fetch);

		const controller = new AbortController();
		const done = (
			fetchTile({ url: `${SCHEME}://127.0.0.1:1/tiles/g/3/1/1` } as never, controller as never) as Promise<unknown>
		).catch((error: unknown) => error);

		await vi.advanceTimersByTimeAsync(MAP_PATIENCE + 1);
		controller.abort();
		await done;

		expect(tiles.busy.filter((mark) => mark.state === 'failed')).toEqual([]);
		// And the zoom is not condemned either, so the next pan over it is tried properly.
		const tile = pending();
		vi.stubGlobal('fetch', tile.fetch);
		const again = ask(`${SCHEME}://127.0.0.1:1/tiles/g/3/2/1`);
		await vi.advanceTimersByTimeAsync(1);
		expect(tiles.rendering).toBe(1);
		tile.deliver();
		await again;
	});

	/** A coordinate that answers is no longer one that was given up on. */
	it('clears the marker when the tile finally arrives', async () => {
		vi.stubGlobal('fetch', pending().fetch);

		const gaveUp = ask(`${SCHEME}://127.0.0.1:1/tiles/g/3/1/1`);
		await vi.advanceTimersByTimeAsync(DEADLINE + 1);
		await gaveUp;
		expect(tiles.busy.some((mark) => mark.state === 'failed')).toBe(true);

		// A new revision is what an edit produces, and it is tried afresh.
		const tile = pending();
		vi.stubGlobal('fetch', tile.fetch);
		const retried = ask(`${SCHEME}://127.0.0.1:1/tiles/g/3/1/1?v=2`);
		tile.deliver();
		await retried;

		expect(tiles.busy.filter((mark) => mark.state === 'failed')).toEqual([]);
	});
});
