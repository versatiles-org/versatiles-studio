/**
 * What the map is waiting for, for the status bar (S2.16, C3).
 *
 * Studio serves its own pipeline tiles through a MapLibre protocol handler rather than letting the
 * browser fetch them directly, which is what makes the two numbers below meaningful - see
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
import { tileCenter } from '../map/tile-grid';

/**
 * How long the map may be busy before the bar mentions it.
 *
 * Long enough that panning around a quick pipeline never produces a message, short enough that a
 * slow one is explained before it feels broken. Tuned by watching it: a second read as unresponsive
 * before it said anything.
 */
export const PATIENCE = 300;

/**
 * How long before the map itself marks the tiles it is waiting for.
 *
 * **Longer than [`PATIENCE`], because the two interrupt differently.** A line of text in the status
 * bar is quiet: it sits where messages already are, and reading it is optional. A marker sits on top
 * of the map, over the very thing being looked at, so it waits until a tile is *late* rather than
 * merely slow. Panning across a pipeline that answers in half a second leaves the map alone
 * entirely, which is the ordinary case and should look like nothing happened.
 */
export const MAP_PATIENCE = 1000;

let rendering = $state(0);
let queued = $state(0);

/** What a pending tile is doing. */
type Doing = 'queued' | 'rendering';

/**
 * One square on the map, and every request currently keeping it there.
 *
 * **The square is per coordinate; the waiting is per request.** Those used to be the same thing,
 * and the difference only shows when one coordinate has two requests in flight at once - which is
 * exactly what replacing a source's tiles in place does: the outgoing request for `3/4/2` is still
 * settling while the incoming one starts. Sharing one entry, whichever finished first took the
 * square away and dropped the count, so the overlay went quiet while the map was still waiting.
 *
 * Two stacked squares would be the other wrong answer - the same coordinate asked for twice is one
 * tile on screen. So the entry stays keyed by `z/x/y` and leaves when its last request does.
 */
interface Pending {
	coord: TileCoord;
	/** By request, since no URL is unique: a reload can ask for the same one twice. */
	doing: Record<string, Doing>;
}

let waiting = $state<Record<string, Pending>>({});

/// Tells one request from another. A counter rather than the URL, because a reload that does not
/// change the URL - a layer added to a vector source - asks for the identical one.
let requests = 0;

/// Reassigned rather than mutated: this is read by a getter that builds GeoJSON, and mutating in
/// place would leave it holding the previous frame's squares.
function mark(key: string, request: string, coord: TileCoord, state: Doing) {
	const entry = waiting[key];
	waiting = { ...waiting, [key]: { coord, doing: { ...entry?.doing, [request]: state } } };
}

/// Drops one request's claim on a square, and the square with the last of them.
function unmark(key: string, request: string) {
	const entry = waiting[key];
	if (!entry || !(request in entry.doing)) return;
	const { [request]: _gone, ...doing } = entry.doing;
	if (Object.keys(doing).length > 0) {
		waiting = { ...waiting, [key]: { coord: entry.coord, doing } };
		return;
	}
	const { [key]: _dropped, ...rest } = waiting;
	waiting = rest;
}

/// What a square says while several requests own it.
///
/// **`rendering` wins.** The two states answer "is anyone working on this tile", and one request
/// waiting for a slot does not make that false while another is being served.
const doingOf = (entry: Pending): Doing => (Object.values(entry.doing).includes('rendering') ? 'rendering' : 'queued');
/// Whether the wait has gone on long enough to be worth saying. Separate from the counts, so the
/// numbers stay live while the decision to show them does not flicker.
let patient = $state(false);
/// The same decision for the map, which waits longer ([`MAP_PATIENCE`]).
let marked = $state(false);

let timer: ReturnType<typeof setTimeout> | undefined;
let mapTimer: ReturnType<typeof setTimeout> | undefined;

const queue = new TileQueue(undefined, () => {
	rendering = queue.running;
	queued = queue.queued;

	if (rendering + queued === 0) {
		clearTimeout(timer);
		clearTimeout(mapTimer);
		timer = undefined;
		mapTimer = undefined;
		patient = false;
		marked = false;
		return;
	}
	// One timer for a continuous run of activity, not one per tile: a viewport's worth of tiles
	// starting a few milliseconds apart is one wait, and restarting the clock for each would mean a
	// steadily busy map never reached the threshold at all.
	if (timer === undefined) timer = setTimeout(() => (patient = true), PATIENCE);
	if (mapTimer === undefined) mapTimer = setTimeout(() => (marked = true), MAP_PATIENCE);
});

export const tiles = {
	get rendering() {
		return rendering;
	},
	get queued() {
		return queued;
	},

	/**
	 * Where the map should mark that it is waiting, and for what - empty while nothing is late.
	 *
	 * **A point per tile, not the tile.** This used to shade the whole square, which put a grey
	 * wash over the map precisely where someone was looking and made a slow pipeline look like a
	 * broken one - the tile underneath was often still perfectly readable, and the shading hid it.
	 * A marker at the middle says the same thing while covering almost nothing.
	 *
	 * Behind a longer patience than the message ([`MAP_PATIENCE`]).
	 */
	get busy(): { key: string; center: [number, number]; state: Doing }[] {
		if (!marked) return [];
		return Object.entries(waiting).map(([key, entry]) => ({
			key,
			center: tileCenter(entry.coord.x, entry.coord.y, entry.coord.z),
			state: doingOf(entry)
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
 * port - `tileUrl` from the core stays the single source of it.
 */
export function registerTileProtocol(): void {
	addProtocol(SCHEME, fetchTile);
}

/**
 * What a tile request failed with, carrying the status MapLibre reads.
 *
 * **`status` is not decoration.** MapLibre branches on it twice - `if (err.status !== 404) throw` in
 * the worker source, and `if (err.status !== 404) fire(ErrorEvent)` in the tile cache - so an error
 * without one is a missing tile reported as a broken map. Its own `AJAXError` carries the same
 * field; this is that shape, for a protocol handler that does its own fetching.
 */
class TileError extends Error {
	readonly status: number;

	constructor(response: Response, url: string) {
		super(`${response.status} ${response.statusText} for ${url}`);
		this.name = 'TileError';
		this.status = response.status;
	}
}

/**
 * Fetches one tile through the queue.
 *
 * **A 404 is an answer, not a failure.** A tile set is sparse by nature: a Berlin extract has
 * nothing at `1/0/0`, and the server says so the way every tile server does. MapLibre knows this and
 * fills the gap from a parent tile - but only if the error says `404`, which is why the throw below
 * carries a status. Without it, panning a sparse source produced one recorded problem per empty
 * tile, forty of them in a session, and the map lost its overzoom fill as well.
 *
 * Exported so the counting and the patience above can be driven from a test - this is the only way
 * into them, and a mechanism whose whole job is to describe a wait is worth being sure about
 * without having to sit and watch a map.
 */
export const fetchTile: AddProtocolAction = async (params, controller) => {
	const url = params.url.replace(`${SCHEME}://`, 'http://');
	const coord = coordFromUrl(url);
	// A URL with no coordinates in it is still queued and still counted - it just cannot be drawn.
	// Nothing routed here should lack them, and inventing a square would be worse than the gap.
	const key = coord && `${coord.z}/${coord.x}/${coord.y}`;
	const request = String((requests += 1));
	if (key && coord) mark(key, request, coord, 'queued');

	try {
		return await queue.run(async () => {
			if (key && coord) mark(key, request, coord, 'rendering');
			const response = await fetch(url, { signal: controller.signal });
			if (!response.ok) throw new TileError(response, url);
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
		//
		// **This request's claim, not the square.** Another request may have taken the same
		// coordinate over while this one was on its way out, and it is still waiting.
		if (key) unmark(key, request);
	}
};
