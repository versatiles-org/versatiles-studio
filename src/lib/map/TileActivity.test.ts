// @vitest-environment jsdom

/**
 * The busy markers (S2.16, C3).
 *
 * **A marker per waiting tile, not a wash over it.** The overlay this replaced shaded the whole
 * square, which covered the tile someone was looking at - and a stale tile is usually still worth
 * reading while its replacement is on the way. What matters here is the bookkeeping: one marker per
 * coordinate, gone the moment the tile is, and none left behind when the map goes.
 *
 * Driven through the real queue rather than a stubbed list, because the thing being asserted is
 * that the three parts agree: a request goes in, the state module decides it is late, and a marker
 * appears for it. A fake in the middle would let all three drift.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const added: FakeMarker[] = [];

/** Enough of `Marker` to record what was put on the map and where. */
class FakeMarker {
	element: HTMLElement;
	lngLat: [number, number] | null = null;
	removed = false;

	constructor(options: { element?: HTMLElement }) {
		this.element = options.element ?? document.createElement('div');
	}
	setLngLat(lngLat: [number, number]) {
		this.lngLat = lngLat;
		return this;
	}
	addTo() {
		added.push(this);
		return this;
	}
	getElement() {
		return this.element;
	}
	remove() {
		this.removed = true;
		return this;
	}
}

vi.mock('maplibre-gl', async (original) => ({
	...((await original()) as object),
	Marker: FakeMarker
}));

const { cleanup, render } = await import('@testing-library/svelte');
const { flushSync } = await import('svelte');
const { default: TileActivity } = await import('./TileActivity.svelte');
const { MAP_PATIENCE, fetchTile } = await import('../state/tiles.svelte');
const { SCHEME } = await import('./tile-queue');

/** A tile request the test decides when to answer. */
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

const request = (n: number) =>
	fetchTile(
		{ url: `${SCHEME}://127.0.0.1:1/tiles/g/2/${n}/1` } as never,
		new AbortController() as never
	) as Promise<unknown>;

/** The markers still on the map. */
const live = () => added.filter((marker) => !marker.removed);

const map = { on: () => {}, off: () => {} } as never;

beforeEach(() => {
	added.length = 0;
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	cleanup();
});

describe('the busy markers', () => {
	it('puts nothing on the map while nothing is late', async () => {
		const tile = pending();
		vi.stubGlobal('fetch', tile.fetch);
		const inFlight = request(1);

		render(TileActivity, { map });
		await vi.advanceTimersByTimeAsync(MAP_PATIENCE - 1);
		flushSync();
		expect(live(), 'a slow tile is not yet a late one').toHaveLength(0);

		tile.deliver();
		await inFlight;
	});

	it('marks each waiting tile once, where the tile is', async () => {
		const tile = pending();
		vi.stubGlobal('fetch', tile.fetch);
		const all = [request(1), request(2)];

		render(TileActivity, { map });
		await vi.advanceTimersByTimeAsync(MAP_PATIENCE);
		flushSync();

		expect(live()).toHaveLength(2);
		const [lng, lat] = live()[0].lngLat!;
		expect(Number.isFinite(lng) && Number.isFinite(lat)).toBe(true);

		tile.deliver();
		await Promise.all(all);
	});

	/**
	 * The point of keying by coordinate: a redraw while the same tile is still waiting must not take
	 * its marker down and put a new one back, which would restart the spinner mid-turn.
	 */
	it('leaves a marker alone while its tile is still waiting', async () => {
		const tile = pending();
		vi.stubGlobal('fetch', tile.fetch);
		const first = request(1);

		render(TileActivity, { map });
		await vi.advanceTimersByTimeAsync(MAP_PATIENCE);
		flushSync();
		const marker = live()[0];

		const second = request(2);
		await vi.advanceTimersByTimeAsync(1);
		flushSync();

		expect(live()).toHaveLength(2);
		expect(live()[0], 'the first tile kept the marker it had').toBe(marker);
		expect(marker.removed).toBe(false);

		tile.deliver();
		await Promise.all([first, second]);
	});

	it('takes the marker away when the tile arrives', async () => {
		const tile = pending();
		vi.stubGlobal('fetch', tile.fetch);
		const inFlight = request(1);

		render(TileActivity, { map });
		await vi.advanceTimersByTimeAsync(MAP_PATIENCE);
		flushSync();
		expect(live()).toHaveLength(1);

		tile.deliver();
		await inFlight;
		flushSync();

		expect(live()).toHaveLength(0);
		expect(added[0].removed).toBe(true);
	});

	// The status bar counts; this says which - so a marker has to carry the state it is in, and a
	// spinner rather than an empty box.
	it('carries the tile’s state and something that spins', async () => {
		const tile = pending();
		vi.stubGlobal('fetch', tile.fetch);
		const inFlight = request(1);

		render(TileActivity, { map });
		await vi.advanceTimersByTimeAsync(MAP_PATIENCE);
		flushSync();

		const node = live()[0].getElement();
		expect(node.dataset.state).toBe('rendering');
		expect(node.querySelector('.tile-busy-ring')).toBeTruthy();

		tile.deliver();
		await inFlight;
	});

	// A marker is not part of the style, so nothing else takes it down.
	it('clears up after itself', async () => {
		const tile = pending();
		vi.stubGlobal('fetch', tile.fetch);
		const inFlight = request(1);

		const view = render(TileActivity, { map });
		await vi.advanceTimersByTimeAsync(MAP_PATIENCE);
		flushSync();
		expect(live()).toHaveLength(1);

		view.unmount();
		expect(live()).toHaveLength(0);

		tile.deliver();
		await inFlight;
	});
});
