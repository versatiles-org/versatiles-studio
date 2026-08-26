/**
 * Swapping a source's tiles instead of the source it belongs to.
 *
 * **The map went black on every rebuild, and the diff is why.** A style handed to `setStyle` is
 * diffed against the live one, and `diffSources` has an in-place path for exactly one source type -
 * GeoJSON. For a vector or raster source whose `tiles` array differs it emits `removeLayer` for
 * every layer of that source, `removeSource`, `addSource`, and then adds the layers back. Every
 * rendered tile is discarded in one frame and refetched, and a rebuild always differs: the server
 * puts a revision in the tile URL so no cache can serve tiles from the pipeline as it was.
 *
 * **MapLibre already replaces tiles in place - just never for a URL change.** `setTiles` reaches
 * `SourceCache.reload`, which walks the tiles in view and reloads each one *keeping what it has*
 * until the replacement arrives. That is the behaviour a rebuild wants, and this module is how a
 * change gets routed to it.
 *
 * **One rule: when in doubt, full.** [`planSwap`] answers "is this change nothing but tile URLs?"
 * and says no to everything it is not certain of - a layer added, an operation that changes which
 * layers a graph produces, a preset, a source arriving or leaving, a background. Those go the way
 * they always have. Getting the answer wrong in that direction costs a flash; the other direction
 * would cost a wrong map, which is why the comparison below is exhaustive rather than clever.
 */

import type { Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';

/** A source that should read from somewhere new. */
export interface TileUpdate {
	source: string;
	tiles: string[];
}

/**
 * What applying one style over another amounts to.
 *
 * `none` is worth telling from `tiles` with an empty list: a style that changes nothing must not
 * reach `setStyle` at all, because a diff with no operations to perform never announces itself -
 * see `restyle.ts` for what that costs.
 */
export type Swap = { kind: 'none' } | { kind: 'tiles'; updates: TileUpdate[] } | { kind: 'full' };

const FULL: Swap = { kind: 'full' };

/** Structural equality, for values that came from JSON and hold no cycles. */
function same(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;

	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((item, index) => same(item, b[index]));
	}

	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	return keys.every((key) => key in right && same(left[key], right[key]));
}

/** The style's own fields, minus the two this looks at in detail. */
function rest(style: StyleSpecification): Record<string, unknown> {
	const {
		sources: _sources,
		layers: _layers,
		...others
	} = style as unknown as Record<string, unknown> & {
		sources: unknown;
		layers: unknown;
	};
	return others;
}

/**
 * Whether the two sources differ in their tiles and nothing else.
 *
 * Every other field is compared rather than listed, so a `minzoom`, a `bounds` or an `encoding`
 * that changed is a difference this refuses to call a tile swap - none of them has a setter, and
 * `setTiles` would leave the map claiming a range the source no longer has.
 */
function tilesOnly(before: unknown, after: unknown): string[] | null {
	if (typeof before !== 'object' || typeof after !== 'object' || !before || !after) return null;

	const left = before as Record<string, unknown>;
	const right = after as Record<string, unknown>;
	const tiles = right.tiles;
	if (!Array.isArray(tiles) || !tiles.every((tile) => typeof tile === 'string')) return null;
	if (!Array.isArray(left.tiles)) return null;
	if (same(left.tiles, tiles)) return null;

	const { tiles: _left, ...restBefore } = left;
	const { tiles: _right, ...restAfter } = right;
	return same(restBefore, restAfter) ? (tiles as string[]) : null;
}

/**
 * What it would take to get from `previous` to `next`.
 *
 * `previous` is the style **on the map**, not the last one anybody composed - a style that was
 * superseded before it was applied never described what is being looked at, and comparing against
 * it would swap tiles into sources the map may not have. `restyle.ts` is what knows the difference,
 * which is why this takes it as an argument rather than remembering it.
 */
export function planSwap(previous: StyleSpecification | null, next: StyleSpecification): Swap {
	if (!previous) return FULL;

	// Everything that is not a source or a layer: version, sprite, glyphs, and whatever else a
	// background style brought with it. Compared as a whole so a field nobody thought of here is a
	// reason to take the slow path rather than a difference that goes unnoticed.
	if (!same(rest(previous), rest(next))) return FULL;

	// Layers are all or nothing. Adding, removing or reordering one is what `setStyle` is for, and
	// a paint change is a difference this deliberately does not try to be clever about.
	if (!same(previous.layers, next.layers)) return FULL;

	const before = previous.sources;
	const after = next.sources;
	const ids = Object.keys(after);
	if (ids.length !== Object.keys(before).length) return FULL;

	const updates: TileUpdate[] = [];
	for (const id of ids) {
		if (!(id in before)) return FULL;
		if (same(before[id], after[id])) continue;
		const tiles = tilesOnly(before[id], after[id]);
		if (!tiles) return FULL;
		updates.push({ source: id, tiles });
	}

	return updates.length === 0 ? { kind: 'none' } : { kind: 'tiles', updates };
}

/** A source that can be pointed somewhere new without being taken off the map. */
interface Swappable {
	setTiles?: (tiles: string[]) => unknown;
}

/**
 * Points each source at its new tiles, or reports that it could not.
 *
 * **Everything is checked before anything is applied**, so a source that turns out to be missing
 * leaves the map exactly as it was and the caller can fall back to a whole style without having
 * half-changed it first. A `setTiles` that throws is the one case that gets past that, and the
 * fallback repairs it: a full style is a description of the end state, not a patch.
 */
export function swapTiles(map: MaplibreMap, updates: TileUpdate[]): boolean {
	const sources = updates.map((update) => map.getSource(update.source) as Swappable | undefined);
	if (sources.some((source) => typeof source?.setTiles !== 'function')) return false;

	try {
		sources.forEach((source, index) => source?.setTiles?.(updates[index].tiles));
		return true;
	} catch {
		return false;
	}
}
