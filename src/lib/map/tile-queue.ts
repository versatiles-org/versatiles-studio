/**
 * The queue every pipeline tile passes through (S2.16, C3).
 *
 * **Studio owns this queue so it can count it.** A VPL operation can take real time per tile, and a
 * map that simply sits there says nothing about whether anything is happening. Neither of the
 * obvious places to look can tell "waiting" from "working": MapLibre reports a tile as loading the
 * moment it *issues* a fetch, which is before the browser has a connection for it, and a counter
 * inside the mounted tile source would only ever see the handful the browser let through.
 *
 * With the queue here, both halves are exact. `running` are tiles the server has and is rendering;
 * `queued` are tiles nobody has started. That holds only while [`LIMIT`] stays at or below the
 * browser's own cap — above it, our "running" would include tiles still waiting for a socket, and
 * the number would quietly start lying.
 *
 * Plain logic rather than anything MapLibre-shaped, so the ordering and the counting can be tested
 * without a map.
 */

/**
 * How many tiles may be in flight at once.
 *
 * Browsers allow six connections per origin over HTTP/1.1, which is what the embedded server speaks
 * — it is loopback and unencrypted, so there is no HTTP/2 to multiplex over. Six is therefore not a
 * throttle: it is the number that makes "in flight" mean "actually being served" rather than
 * "somewhere between here and a socket".
 */
export const LIMIT = 6;

/** The scheme that routes a tile through Studio's queue. */
export const SCHEME = 'studio';

/**
 * A tile URL routed through the queue.
 *
 * Only Studio's own tiles get this. A background map's tiles come from versatiles.org, and putting
 * those in the same queue would report someone else's network as this pipeline being slow.
 */
export function throughQueue(tileUrl: string): string {
	return tileUrl.replace(/^https?:\/\//, `${SCHEME}://`);
}

interface Waiter {
	resolve: () => void;
	reject: (error: unknown) => void;
	cancel: () => void;
}

/** The error a cancelled tile rejects with. MapLibre treats an `AbortError` as "never mind". */
function aborted(): DOMException {
	return new DOMException('Tile request aborted', 'AbortError');
}

export class TileQueue {
	#running = 0;
	#waiting: Waiter[] = [];
	#changed: () => void;

	constructor(
		private readonly limit = LIMIT,
		onChange: () => void = () => {}
	) {
		this.#changed = onChange;
	}

	/** Tiles the server has and is working on. */
	get running(): number {
		return this.#running;
	}

	/** Tiles nobody has started yet. */
	get queued(): number {
		return this.#waiting.length;
	}

	/** Runs `task` once a slot is free, releasing it however the task ends. */
	async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		await this.#take(signal);
		try {
			return await task();
		} finally {
			this.#release();
		}
	}

	#take(signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) return Promise.reject(aborted());

		if (this.#running < this.limit) {
			this.#running += 1;
			this.#changed();
			return Promise.resolve();
		}

		return new Promise<void>((resolve, reject) => {
			// **First in, first out.** A map aborts the tiles that leave the viewport, so the queue
			// empties of stale work on its own and does not need a policy for preferring new
			// requests over old ones — which would starve the edge of a viewport being panned along.
			const waiter: Waiter = {
				resolve,
				reject,
				cancel: () => {
					const index = this.#waiting.indexOf(waiter);
					if (index >= 0) this.#waiting.splice(index, 1);
					this.#changed();
					reject(aborted());
				}
			};
			this.#waiting.push(waiter);
			signal?.addEventListener('abort', waiter.cancel, { once: true });
			this.#changed();
		});
	}

	#release() {
		this.#running -= 1;
		const next = this.#waiting.shift();
		if (next) {
			this.#running += 1;
			next.resolve();
		}
		this.#changed();
	}
}
