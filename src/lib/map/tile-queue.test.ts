import { describe, expect, it, vi } from 'vitest';
import { coordFromUrl, SCHEME, throughQueue, TileQueue } from './tile-queue';

/** A task that finishes when told to. */
function held() {
	let finish!: () => void;
	const done = new Promise<void>((resolve) => (finish = resolve));
	return { task: () => done, finish };
}

describe('TileQueue', () => {
	it('runs up to the limit and queues the rest', async () => {
		const queue = new TileQueue(2);
		const a = held();
		const b = held();
		const c = held();

		void queue.run(a.task);
		void queue.run(b.task);
		void queue.run(c.task);
		await Promise.resolve();

		expect(queue.running).toBe(2);
		expect(queue.queued).toBe(1);
	});

	// The two numbers are the whole feature: "rendering" must mean the server has it, and a tile
	// that has not started must be counted as waiting rather than as work.
	it('a finished tile hands its slot to the one that was waiting', async () => {
		const queue = new TileQueue(1);
		const a = held();
		const b = held();
		const first = queue.run(a.task);
		void queue.run(b.task);
		await Promise.resolve();

		expect([queue.running, queue.queued]).toEqual([1, 1]);
		a.finish();
		await first;
		expect([queue.running, queue.queued]).toEqual([1, 0]);
	});

	it('is empty again once everything has finished', async () => {
		const queue = new TileQueue(2);
		await Promise.all([queue.run(async () => 1), queue.run(async () => 2)]);
		expect([queue.running, queue.queued]).toEqual([0, 0]);
	});

	it('releases the slot when a task fails, or one failure would wedge the map', async () => {
		const queue = new TileQueue(1);
		await expect(queue.run(async () => Promise.reject(new Error('502')))).rejects.toThrow('502');
		expect(queue.running).toBe(0);
		await expect(queue.run(async () => 'next')).resolves.toBe('next');
	});

	describe('cancelling', () => {
		it('drops a waiting tile out of the queue', async () => {
			const queue = new TileQueue(1);
			const a = held();
			void queue.run(a.task);
			const controller = new AbortController();
			const waiting = queue.run(async () => 'never', controller.signal);
			await Promise.resolve();
			expect(queue.queued).toBe(1);

			controller.abort();
			await expect(waiting).rejects.toThrow(/abort/i);
			expect(queue.queued).toBe(0);
			// The slot the running tile holds is untouched by someone else's cancellation.
			expect(queue.running).toBe(1);
		});

		it('refuses a tile that was already abandoned before its turn came', async () => {
			const queue = new TileQueue(1);
			const controller = new AbortController();
			controller.abort();
			await expect(queue.run(async () => 'never', controller.signal)).rejects.toThrow(/abort/i);
			expect([queue.running, queue.queued]).toEqual([0, 0]);
		});

		/**
		 * A tile that waited and then got its slot is no longer the queue's business.
		 *
		 * MapLibre aborts a tile's signal as soon as it leaves the viewport, which is routine and
		 * happens long after most tiles have been served. While the listener stayed attached that
		 * arrived as a cancellation of a waiter no longer in the queue: a `reject` on a promise that
		 * had already resolved, and a change notification reporting a count that had not changed.
		 */
		it('lets go of the signal once the tile has taken its slot', async () => {
			let changes = 0;
			const queue = new TileQueue(1, () => (changes += 1));
			const a = held();
			const b = held();
			const controller = new AbortController();

			void queue.run(a.task);
			const waited = queue.run(b.task, controller.signal);
			await Promise.resolve();
			expect(queue.queued).toBe(1);

			// `b` stops waiting and starts running.
			a.finish();
			await vi.waitFor(() => expect(queue.queued).toBe(0));

			const settled = changes;
			controller.abort();
			expect(changes, 'the queue is still listening to a signal that is no longer its business').toBe(settled);

			b.finish();
			await expect(waited).resolves.toBeUndefined();
		});

		it('a cancelled tile does not consume the slot it never took', async () => {
			const queue = new TileQueue(1);
			const a = held();
			void queue.run(a.task);
			const controller = new AbortController();
			void queue.run(async () => 'never', controller.signal).catch(() => {});
			const c = held();
			void queue.run(c.task);
			await Promise.resolve();

			controller.abort();
			a.finish();
			await vi.waitFor(() => expect(queue.running).toBe(1));
			// `c` was behind the cancelled one and gets the slot instead.
			expect(queue.queued).toBe(0);
		});
	});

	it('reports every change, so a status line never shows a stale count', async () => {
		const changes: [number, number][] = [];
		const queue = new TileQueue(1, () => changes.push([queue.running, queue.queued]));
		const a = held();
		void queue.run(a.task);
		void queue.run(async () => 'second');
		await Promise.resolve();
		a.finish();
		await vi.waitFor(() => expect(queue.running).toBe(0));

		expect(changes[0]).toEqual([1, 0]);
		expect(changes).toContainEqual([1, 1]);
		expect(changes.at(-1)).toEqual([0, 0]);
	});
});

describe('throughQueue', () => {
	it('keeps everything but the scheme, so the port and the revision survive', () => {
		expect(throughQueue('http://127.0.0.1:8080/tiles/berlin/{z}/{x}/{y}?r=3')).toBe(
			`${SCHEME}://127.0.0.1:8080/tiles/berlin/{z}/{x}/{y}?r=3`
		);
	});

	it('rewrites https too - a remote source mounted locally is still served locally', () => {
		expect(throughQueue('https://127.0.0.1:8080/t/{z}')).toBe(`${SCHEME}://127.0.0.1:8080/t/{z}`);
	});

	// The rewrite is anchored: a URL with the scheme somewhere in a query string is not a URL with
	// that scheme.
	it('only rewrites at the front', () => {
		expect(throughQueue('http://a/x?u=http://b')).toBe(`${SCHEME}://a/x?u=http://b`);
	});
});

describe('coordFromUrl', () => {
	it('reads the coordinates MapLibre substituted', () => {
		expect(coordFromUrl('http://127.0.0.1:8080/tiles/berlin/12/2200/1343')).toEqual({ z: 12, x: 2200, y: 1343 });
	});

	it('sees past an extension and a cache-defeating revision', () => {
		expect(coordFromUrl('http://h/t/3/4/5.pbf')).toEqual({ z: 3, x: 4, y: 5 });
		expect(coordFromUrl('http://h/t/3/4/5?r=7')).toEqual({ z: 3, x: 4, y: 5 });
		expect(coordFromUrl('http://h/t/3/4/5.png?r=7')).toEqual({ z: 3, x: 4, y: 5 });
	});

	it('is not fooled by a URL that merely ends in numbers', () => {
		// A sprite has two numeric segments, not three - the glyph and sprite URLs share this host.
		expect(coordFromUrl('http://h/assets/sprites/basics/1/2')).toBeNull();
		// Three numbers, but a zoom that cannot exist: a parse that happened to succeed on a date.
		expect(coordFromUrl('http://h/v/2024/11/30')).toBeNull();
		expect(coordFromUrl('http://h/tiles/berlin')).toBeNull();
	});
});
