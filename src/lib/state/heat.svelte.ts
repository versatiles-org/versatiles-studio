/**
 * The heat map: whether it is on, which source and detail level it draws, and where it is served
 * (S14.3, [Q72]).
 *
 * **It follows the selection**, like the Analysis pane it belongs with: switched on, it draws the
 * selected source, and selecting another redraws it for that one at that one's deepest level. A
 * detail level walked away from the deepest is kept for as long as the source stays selected.
 *
 * Every answer is checked against the request that is newest: selecting three sources quickly sends
 * three mounts, and the one that lands last need not be the one asked last.
 *
 * [Q72]: ../../../docs/decisions.md
 */

import { mountHeat, unmountHeat, type HeatMount } from '../ipc/commands';
import { token } from '../styles/tokens';

/** What is on the map: the source, the level, and where its tiles are. */
interface Drawn {
	graph: number;
	/** The build it was drawn from - a rebuild may read another container. */
	build: string | null;
	detail: number;
	mount: HeatMount;
}

let on = $state(false);
let drawn = $state<Drawn | null>(null);
let error = $state<string | null>(null);
/** The newest request; an answer to any other is dropped. */
let asked = 0;

/** The band colours, read from the theme each time - the core draws the pixels, the theme picks. */
const colours = () => ([1, 2, 3, 4] as const).map((band) => token(`--map-heat-${band}`));

async function draw(graph: number, build: string | null, detail: number): Promise<void> {
	const ticket = ++asked;
	try {
		const mount = await mountHeat(graph, detail, colours());
		if (ticket !== asked) return;
		drawn = { graph, build, detail, mount };
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

	/** Where the tiles are, and the levels they cover; `null` while there is nothing to draw. */
	get mount(): HeatMount | null {
		return drawn?.mount ?? null;
	},

	/** The detail level being drawn, and which source it is of. */
	get drawn(): { graph: number; detail: number } | null {
		return drawn ? { graph: drawn.graph, detail: drawn.detail } : null;
	},

	/** Why the selected source has no heat map, when it has none. */
	get error(): string | null {
		return error;
	},

	/**
	 * Switches it on for a source, at `deepest` - the source's own deepest level - unless it is
	 * already drawing that source at a level someone chose.
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

	/** Walks the detail level by `by`, within `min` and `max`. */
	async step(by: number, min: number, max: number): Promise<void> {
		if (!drawn) return;
		const detail = Math.min(max, Math.max(min, drawn.detail + by));
		if (detail !== drawn.detail) await draw(drawn.graph, drawn.build, detail);
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
