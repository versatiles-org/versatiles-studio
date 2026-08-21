/**
 * What the map is waiting for, for the status bar (S2.16, C3).
 *
 * Studio serves its own pipeline tiles through a MapLibre protocol handler rather than letting the
 * browser fetch them directly, which is what makes the two numbers below meaningful — see
 * `map/tile-queue.ts` for why neither is otherwise knowable.
 *
 * **Nothing is said about a fast pipeline.** Tiles that arrive promptly are the ordinary case and
 * announcing them would put a message in the bar on every pan, so the line appears only once the
 * wait has lasted [`PATIENCE`]. What it then says distinguishes the two states, because they mean
 * different things to whoever is waiting: tiles are *queued* because Studio is holding them back,
 * and *rendering* because an operation is taking its time over each one.
 */

import { addProtocol, type AddProtocolAction } from 'maplibre-gl';
import { coordFromUrl, SCHEME, TileQueue, type TileCoord } from '../map/tile-queue';
import { tileRing } from '../map/tile-grid';

/**
 * How long the map may be busy before the bar mentions it.
 *
 * Long enough that panning around a quick pipeline never produces a message, short enough that a
 * slow one is explained before it feels broken. Tuned by watching it: a second read as unresponsive
 * before it said anything.
 */
export const PATIENCE = 300;

let rendering = $state(0);
let queued = $state(0);

/**
 * Where the pending tiles are, so the map can show *which* ones are slow rather than only how many.
 *
 * Keyed by `z/x/y` because that is what a tile is: the same coordinate asked for twice — a repaint
 * after a style change, say — is one square on the map, not two stacked on each other.
 */
let waiting = $state<Record<string, { coord: TileCoord; state: 'queued' | 'rendering' }>>({});

/// Reassigned rather than mutated: this is read by a getter that builds GeoJSON, and mutating in
/// place would leave it holding the previous frame's squares.
function mark(key: string, coord: TileCoord, state: 'queued' | 'rendering') {
	waiting = { ...waiting, [key]: { coord, state } };
}

function unmark(key: string) {
	if (!(key in waiting)) return;
	const { [key]: _gone, ...rest } = waiting;
	waiting = rest;
}
/// Whether the wait has gone on long enough to be worth saying. Separate from the counts, so the
/// numbers stay live while the decision to show them does not flicker.
let patient = $state(false);

let timer: ReturnType<typeof setTimeout> | undefined;

const queue = new TileQueue(undefined, () => {
	rendering = queue.running;
	queued = queue.queued;

	if (rendering + queued === 0) {
		clearTimeout(timer);
		timer = undefined;
		patient = false;
		return;
	}
	// One timer for a continuous run of activity, not one per tile: a viewport's worth of tiles
	// starting a few milliseconds apart is one wait, and restarting the clock for each would mean a
	// steadily busy map never reached the threshold at all.
	if (timer === undefined) timer = setTimeout(() => (patient = true), PATIENCE);
});

export const tiles = {
	get rendering() {
		return rendering;
	},
	get queued() {
		return queued;
	},

	/**
	 * The pending tiles as map features, or none while there is nothing worth drawing.
	 *
	 * Behind the same patience as the message: a square flashing over every tile of every pan would
	 * be worse than the silence it replaced, and this exists for the pipeline that takes its time
	 * rather than the one that does not.
	 */
	get features() {
		if (!patient) return [];
		return Object.entries(waiting).map(([key, entry]) => ({
			type: 'Feature' as const,
			id: key,
			geometry: { type: 'Polygon' as const, coordinates: tileRing(entry.coord.x, entry.coord.y, entry.coord.z) },
			properties: { state: entry.state }
		}));
	},

	/** What the bar should say, or `null` while there is nothing worth saying. */
	get message(): string | null {
		if (!patient) return null;
		const parts: string[] = [];
		if (rendering > 0) parts.push(`rendering ${rendering}`);
		if (queued > 0) parts.push(`${queued} queued`);
		if (parts.length === 0) return null;
		return `Tiles: ${parts.join(', ')}`;
	}
};

/**
 * Points `studio://` at the embedded server, through the queue.
 *
 * Called once. The URL is the server's own with the scheme swapped, so nothing else has to know the
 * port — `tileUrl` from the core stays the single source of it.
 */
export function registerTileProtocol(): void {
	addProtocol(SCHEME, fetchTile);
}

/**
 * Fetches one tile through the queue.
 *
 * Exported so the counting and the patience above can be driven from a test — this is the only way
 * into them, and a mechanism whose whole job is to describe a wait is worth being sure about
 * without having to sit and watch a map.
 */
export const fetchTile: AddProtocolAction = async (params, controller) => {
	const url = params.url.replace(`${SCHEME}://`, 'http://');
	const coord = coordFromUrl(url);
	// A URL with no coordinates in it is still queued and still counted — it just cannot be drawn.
	// Nothing routed here should lack them, and inventing a square would be worse than the gap.
	const key = coord && `${coord.z}/${coord.x}/${coord.y}`;
	if (key && coord) mark(key, coord, 'queued');

	try {
		return await queue.run(async () => {
			if (key && coord) mark(key, coord, 'rendering');
			const response = await fetch(url, { signal: controller.signal });
			if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
			return {
				data: await response.arrayBuffer(),
				// Passed through rather than invented: the core puts a revision in the tile URL to
				// defeat caching, and overriding what it says here would fight that.
				cacheControl: response.headers.get('cache-control') ?? undefined,
				expires: response.headers.get('expires') ?? undefined
			};
		}, controller.signal);
	} finally {
		// Outside `run`, not inside it: a tile cancelled while still queued never enters the task,
		// so a cleanup in there would leave its square on the map for good.
		if (key) unmark(key);
	}
};
