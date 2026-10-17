/**
 * The tile dialog: which tile of which source it shows, and that tile taken apart (S14.5, A4,
 * [Q72]).
 *
 * **The drawn tile.** The core reads it from the source the map draws, so a filter or an overzoom
 * upstream shows here as it shows on the map - which is what clicking a square, a list row or a
 * feature is asking about.
 *
 * Moving to a parent, a child or a neighbour keeps the dialog open and asks again; every answer is
 * checked against the newest request, because a dense tile takes longer than the one after it.
 *
 * [Q72]: ../../../docs/decisions.md
 */

import { dissectTile, type Dissection } from '../ipc/commands';

/** One tile of one source. */
export interface TileAt {
	graph: number;
	z: number;
	x: number;
	y: number;
}

/** The deepest level an address may name - the deepest a tile container can hold. */
export const DEEPEST = 30;

/** Whether `z/x/y` names a tile at all. */
export function valid(z: number, x: number, y: number): boolean {
	const n = 2 ** z;
	return [z, x, y].every(Number.isInteger) && z >= 0 && z <= DEEPEST && x >= 0 && y >= 0 && x < n && y < n;
}

/** Reads `z/x/y` as typed - spaces and a leading slash forgiven - or `null` for anything else. */
export function parseAddress(text: string): { z: number; x: number; y: number } | null {
	const match = /^\s*\/?\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(text);
	if (!match) return null;
	const [z, x, y] = match.slice(1).map(Number);
	return valid(z, x, y) ? { z, x, y } : null;
}

/** The tile one level up that holds this one, or `null` at the top. */
export function parent(z: number, x: number, y: number): { z: number; x: number; y: number } | null {
	return z === 0 ? null : { z: z - 1, x: x >> 1, y: y >> 1 };
}

/** The four tiles one level down, in reading order: north-west, north-east, south-west, south-east. */
export function children(z: number, x: number, y: number): { z: number; x: number; y: number }[] {
	if (z >= DEEPEST) return [];
	return [
		[0, 0],
		[1, 0],
		[0, 1],
		[1, 1]
	].map(([dx, dy]) => ({ z: z + 1, x: x * 2 + dx, y: y * 2 + dy }));
}

/**
 * The tile beside this one, `dx` across and `dy` down. East and west wrap round the antimeridian,
 * as the map does; north and south stop at the edge of the world.
 */
export function neighbour(
	z: number,
	x: number,
	y: number,
	dx: number,
	dy: number
): { z: number; x: number; y: number } | null {
	const n = 2 ** z;
	const ny = y + dy;
	if (ny < 0 || ny >= n) return null;
	return { z, x: (((x + dx) % n) + n) % n, y: ny };
}

let at = $state<TileAt | null>(null);
let dissection = $state<Dissection | null>(null);
let error = $state<string | null>(null);
let loading = $state(false);
/** The newest request; an answer to any other is dropped. */
let asked = 0;

async function load(next: TileAt): Promise<void> {
	const ticket = ++asked;
	at = next;
	loading = true;
	try {
		const found = await dissectTile(next.graph, next.z, next.x, next.y);
		if (ticket !== asked) return;
		dissection = found;
		error = null;
	} catch (failure) {
		if (ticket !== asked) return;
		dissection = null;
		error = failure instanceof Error ? failure.message : String(failure);
	} finally {
		if (ticket === asked) loading = false;
	}
}

export const tileDialog = {
	/** The tile shown, or `null` while the dialog is closed. */
	get at(): TileAt | null {
		return at;
	},

	/** The tile taken apart; `null` while it loads, when it failed, or where there is no tile. */
	get dissection(): Dissection | null {
		return dissection;
	},

	get error(): string | null {
		return error;
	},

	get loading(): boolean {
		return loading;
	},

	/** Opens the dialog on a tile of a source - or moves it there, when it is open already. */
	open(graph: number, z: number, x: number, y: number): Promise<void> {
		if (!valid(z, x, y)) return Promise.resolve();
		return load({ graph, z, x, y });
	},

	/** Moves to another tile of the same source. */
	go(z: number, x: number, y: number): Promise<void> {
		if (!at || !valid(z, x, y)) return Promise.resolve();
		return load({ graph: at.graph, z, x, y });
	},

	close(): void {
		asked++;
		at = null;
		dissection = null;
		error = null;
		loading = false;
	}
};
