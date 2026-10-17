/**
 * The heat map: whether it is on, which source it draws and how deep, the size at the white end of
 * its ramp, and how it sits over the map (S14.3, [Q72]).
 *
 * **It follows the selection**, like the Analysis pane it belongs with: switched on, it draws the
 * selected source, and selecting another redraws it for that one down to that one's deepest level.
 * A depth walked away from the deepest is kept for as long as the source stays selected.
 *
 * **The squares follow the zoom.** A heat tile draws the tiles [`LOOK`] levels below it, so the
 * level a square stands for depends on where the map is - [`squareLevel`] says which, for the legend
 * and the readout alike.
 *
 * **The maximum is the reader's.** 500 kB is the budget a vector tile is held to, but a layer that
 * will be merged into a bigger one wants its own 50 kB to span the ramp. Changing it redraws; the
 * opacity and "heat map only" are the map's business and do not.
 *
 * Every answer is checked against the request that is newest: selecting three sources quickly sends
 * three mounts, and the one that lands last need not be the one asked last.
 *
 * [Q72]: ../../../docs/decisions.md
 */

import { mountHeat, unmountHeat, type HeatMount } from '../ipc/commands';
import { requestedZoom } from '../map/tile-grid';
import { token } from '../styles/tokens';

/** How many levels below a heat tile its squares are - the core's `heat::LOOK`. */
export const LOOK = 6;

/** The size at the white end of the ramp until someone says otherwise: a vector tile's budget. */
export const DEFAULT_MAX = 500_000;

/** The level each square stands for at map zoom `zoom`, when the squares go no deeper than `deepest`. */
export function squareLevel(zoom: number, deepest: number): number {
	return Math.min(deepest, requestedZoom(zoom, { type: 'raster', tileSize: 512 }) + LOOK);
}

/** What is on the map: the source, how deep, and where its tiles are. */
interface Drawn {
	graph: number;
	/** The build it was drawn from - a rebuild may read another container. */
	build: string | null;
	deepest: number;
	mount: HeatMount;
}

let on = $state(false);
let drawn = $state<Drawn | null>(null);
let error = $state<string | null>(null);
let max = $state(DEFAULT_MAX);
let opacity = $state(0.75);
let only = $state(false);
/** The newest request; an answer to any other is dropped. */
let asked = 0;

/** The ramp's colours, read from the theme each time - the core draws the pixels, the theme picks. */
const colours = () => ([1, 2, 3, 4, 5] as const).map((stop) => token(`--map-heat-${stop}`));

async function draw(graph: number, build: string | null, deepest: number): Promise<void> {
	const ticket = ++asked;
	try {
		const mount = await mountHeat(graph, deepest, colours(), max);
		if (ticket !== asked) return;
		drawn = { graph, build, deepest, mount };
		error = null;
	} catch (failure) {
		if (ticket !== asked) return;
		drawn = null;
		error = failure instanceof Error ? failure.message : String(failure);
	}
}

export const heat = {
	get on(): boolean {
		return on;
	},

	/** Where the tiles are; `null` while there is nothing to draw. */
	get mount(): HeatMount | null {
		return drawn?.mount ?? null;
	},

	/** Which source is drawn, and the deepest level its squares go to. */
	get drawn(): { graph: number; deepest: number } | null {
		return drawn ? { graph: drawn.graph, deepest: drawn.deepest } : null;
	},

	/** Why the selected source has no heat map, when it has none. */
	get error(): string | null {
		return error;
	},

	/** The size at the white end of the ramp, in bytes. */
	get max(): number {
		return max;
	},

	/** How opaque the squares are over the map, 0 to 1. */
	get opacity(): number {
		return opacity;
	},

	set opacity(value: number) {
		opacity = Math.min(1, Math.max(0, value));
	},

	/** Whether the source's own layers are hidden, so only the squares and the basemap show. */
	get only(): boolean {
		return only;
	},

	set only(value: boolean) {
		only = value;
	},

	/** Sets the size at the white end of the ramp, and redraws if it changed. */
	async setMax(bytes: number): Promise<void> {
		if (!Number.isFinite(bytes) || bytes <= 0) return;
		const rounded = Math.round(bytes);
		if (rounded === max) return;
		max = rounded;
		if (drawn) await draw(drawn.graph, drawn.build, drawn.deepest);
	},

	/**
	 * Switches it on for a source, down to `deepest` - the source's own deepest level - unless it is
	 * already drawing that source to a depth someone chose.
	 */
	async show(graph: number, build: string | null, deepest: number): Promise<void> {
		on = true;
		if (drawn?.graph === graph && drawn.build === build) return;
		await draw(graph, build, deepest);
	},

	/** Switches it off, and takes its mount down. */
	async hide(): Promise<void> {
		on = false;
		asked++;
		const was = drawn;
		drawn = null;
		error = null;
		if (was) await unmountHeat(was.graph).catch(() => {});
	},

	/** Walks the deepest level by `by`, within `min` and `max`. */
	async step(by: number, min: number, max: number): Promise<void> {
		if (!drawn) return;
		const deepest = Math.min(max, Math.max(min, drawn.deepest + by));
		if (deepest !== drawn.deepest) await draw(drawn.graph, drawn.build, deepest);
	},

	/**
	 * Keeps it on whatever is selected, as it is now built. `graph` and `deepest` are the selection
	 * and its deepest level, `null` when nothing is selected or it has not built.
	 */
	async follow(graph: number | null, build: string | null, deepest: number | null): Promise<void> {
		if (!on) return;
		if (graph === null || deepest === null) {
			asked++;
			drawn = null;
			return;
		}
		if (drawn?.graph !== graph || drawn.build !== build) await draw(graph, build, deepest);
	}
};
