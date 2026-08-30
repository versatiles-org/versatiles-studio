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

/**
 * How long the map waits for one tile before giving up on it.
 *
 * **A tile request has no other end.** The embedded server answers when the pipeline answers, and
 * some pipelines take minutes over a single tile: an overview asked for a zoom far above its base
 * level costs `4^gap` source reads, which is seconds at a gap of five and unbounded at eight
 * ([vt#264]). Nothing between here and there stops it, so a map zoomed out over such a pipeline
 * simply never draws, with no error and nothing to click.
 *
 * Ten seconds because it has to be longer than a slow-but-working tile and shorter than a person's
 * patience with a blank square. Measured against the same pipeline: a gap of five answers in nine
 * and a half seconds, so this keeps what works and drops what does not.
 *
 * [vt#264]: https://github.com/versatiles-org/versatiles-rs/issues/264
 */
export const DEADLINE = 10_000;

let rendering = $state(0);
let queued = $state(0);

/** What a pending tile is doing, or that nobody is waiting for it any more. */
type Doing = 'queued' | 'rendering' | 'failed';

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

/**
 * Tiles that ran out of [`DEADLINE`], by `z/x/y`.
 *
 * Kept apart from `waiting`, which is what is *in flight*: a tile that was given up on is not being
 * waited for any more, and its marker should stay until something replaces it rather than vanishing
 * with the request.
 */
let refused = $state<Record<string, TileCoord>>({});

/**
 * Zoom levels that have already proved too slow, as `<source>@<zoom>`.
 *
 * **Because the map asks again.** MapLibre re-requests tiles on every pan, and cancelling one costs
 * nothing upstream - the work is abandoned rather than remembered, so the next request starts over.
 * Without this, sitting at a bad zoom burns ten seconds per tile per pan, for ever.
 *
 * Per zoom rather than per tile, because cost follows depth: if one tile at this level took too
 * long, its neighbours will too. Zooming in reaches cheaper levels and is unaffected.
 *
 * Keyed on the URL before the coordinate, which carries the mount and its revision - so editing the
 * pipeline mints a new key and everything is tried again, which is what an edit deserves.
 */
// A plain Set: nothing renders from this, so it needs no reactivity - it is read inside the request
// that consults it and never by a getter or a template.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const tooSlow = new Set<string>();

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
		// **A tile that was given up on is marked whatever the patience says.** `marked` exists so a
		// pipeline answering in half a second leaves the map alone; one that has already spent the
		// deadline is past that argument, and its square would otherwise stay blank with no reason
		// on screen for why.
		const failed = Object.entries(refused).map(([key, coord]) => ({
			key,
			center: tileCenter(coord.x, coord.y, coord.z),
			state: 'failed' as const
		}));
		if (!marked) return failed;

		const busy = Object.entries(waiting)
			.filter(([key]) => !(key in refused))
			.map(([key, entry]) => ({
				key,
				center: tileCenter(entry.coord.x, entry.coord.y, entry.coord.z),
				state: doingOf(entry)
			}));
		return [...busy, ...failed];
	},

	/**
	 * Test seam: the module is a singleton, and a judgement made in one case must not reach the next.
	 *
	 * **Only a seam, unlike the counts.** `waiting` empties itself as requests end and `refused`
	 * clears a coordinate that answers, so neither needs clearing in the application. `tooSlow` only
	 * grows - but it is bounded by mounts times zoom levels, and a mount that goes takes its `?v=`
	 * with it, so what is left is a handful of dead strings rather than a leak worth code.
	 */
	reset(): void {
		waiting = {};
		refused = {};
		tooSlow.clear();
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
	// The URL with its coordinate taken out: the mount and the `?v=` revision, which together are
	// "this source, as it is written right now".
	//
	// **Removed rather than truncated.** The revision is a query parameter, so it sits *after* the
	// coordinate - slicing at the coordinate drops it, and an edit that fixed the pipeline would
	// keep failing fast against a judgement made about the version before it.
	const slow = key ? `${url.replace(`/${key}`, '')}@${coord?.z}` : undefined;

	// **Already known to be hopeless.** Answering at once beats spending the deadline again on a
	// tile whose neighbour has just proved it cannot arrive.
	if (slow && key && coord && tooSlow.has(slow)) {
		refused = { ...refused, [key]: coord };
		throw new Error(`tile ${key} was given up on: this zoom takes longer than ${DEADLINE} ms to build`);
	}

	if (key && coord) mark(key, request, coord, 'queued');

	// Studio's own, so the deadline can end the wait without touching MapLibre's - which means
	// something different: a tile it aborts has left the viewport and nobody wants it any more.
	const own = new AbortController();
	const giveUp = () => controller.signal.removeEventListener('abort', abandon);
	const abandon = () => own.abort();
	controller.signal.addEventListener('abort', abandon);
	let expired = false;
	const deadline = setTimeout(() => {
		expired = true;
		own.abort();
	}, DEADLINE);

	try {
		return await queue.run(async () => {
			if (key && coord) mark(key, request, coord, 'rendering');
			const response = await fetch(url, { signal: own.signal });
			if (!response.ok) throw new TileError(response, url);
			// **Self-healing.** A coordinate that answers is no longer one that was given up on -
			// otherwise a marker left by a slow zoom would sit there after the edit that fixed it.
			if (key && key in refused) {
				const { [key]: _healed, ...rest } = refused;
				refused = rest;
			}
			return {
				data: await response.arrayBuffer(),
				// Passed through rather than invented: the core puts a revision in the tile URL to
				// defeat caching, and overriding what it says here would fight that.
				cacheControl: response.headers.get('cache-control') ?? undefined,
				expires: response.headers.get('expires') ?? undefined
			};
		}, controller.signal);
	} catch (error) {
		// **Told apart by which signal fired.** An abort from MapLibre is the ordinary case and says
		// nothing; one from the deadline is this tile failing, and is the only one worth marking.
		if (expired && key && coord && slow) {
			tooSlow.add(slow);
			refused = { ...refused, [key]: coord };
			throw new Error(`tile ${key} took longer than ${DEADLINE} ms to build`, { cause: error });
		}
		throw error;
	} finally {
		clearTimeout(deadline);
		giveUp();
		// Outside `run`, not inside it: a tile cancelled while still queued never enters the task,
		// so a cleanup in there would leave its square on the map for good.
		//
		// **This request's claim, not the square.** Another request may have taken the same
		// coordinate over while this one was on its way out, and it is still waiting.
		if (key) unmark(key, request);
	}
};
