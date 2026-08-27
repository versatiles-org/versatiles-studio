/**
 * Putting the map's layers in a new order without rebuilding them
 * ([the layer stack](../../../docs/layers.md)).
 *
 * **`setStyle` cannot express a reorder.** The style specification's own diff has no `moveLayer`
 * command at all - `diffLayers` emits `removeLayer` and `addLayer` in pairs - so lifting one
 * category of `colorful` past a three-layer source comes out as 66 commands, and the whole category
 * of roads as 462. Worse than the count: re-adding a layer that was just removed makes MapLibre set
 * `_updatedSources[source] = "reload"` and pause the tile manager, so every loaded tile of that
 * source is sent back to the worker and re-tessellated. No refetch - the source never changed - but
 * a full rebuild of everything on screen for a change that moved nothing.
 *
 * `moveLayer` does none of that: it splices the layer's place in the order and asks for one
 * placement pass.
 *
 * **And the fewest moves are not the layers that were dragged.** Moving a run is the same picture as
 * moving everything it passed, so the cheaper of the two is what should be done - lifting the 33
 * label layers of `colorful` above a three-layer source is three calls, not thirty-three. The
 * layers that have to move are exactly the ones outside a longest increasing subsequence of the old
 * order read through the new one; everything in that subsequence is already in the right relative
 * place. Measured against the real presets: 3 calls where the diff would issue 66, and 51 where it
 * would issue 462.
 *
 * This is `tile-swap.ts`'s sibling, with the same rule: **when in doubt, full**. Anything that is
 * not exactly the same set of layers in a different order is somebody else's problem.
 */

import type { Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';

/** One `moveLayer` call: put `id` before `before`, or at the top when it is `null`. */
export interface Move {
	id: string;
	before: string | null;
}

/**
 * The fewest `moveLayer` calls that turn `before` into `after`.
 *
 * Both must hold the same ids; the caller has already established that.
 *
 * The subsequence is found by patience sorting on the positions of `before`'s ids in `after`, which
 * is `O(n log n)` - `colorful` twice over is 648 layers, and this runs on every drop.
 */
export function minimalMoves(before: string[], after: string[]): Move[] {
	const place = new Map(after.map((id, index) => [id, index]));
	const sequence = before.map((id) => place.get(id) ?? -1);

	// Patience sorting, keeping the predecessors so the subsequence itself can be recovered - the
	// length alone would say how many moves there are and not which.
	const piles: number[] = [];
	const from: number[] = new Array(sequence.length).fill(-1);
	const top: number[] = [];
	for (let index = 0; index < sequence.length; index++) {
		const value = sequence[index];
		let low = 0;
		let high = piles.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (piles[middle] < value) low = middle + 1;
			else high = middle;
		}
		piles[low] = value;
		top[low] = index;
		from[index] = low > 0 ? top[low - 1] : -1;
	}

	const staying = new Set<string>();
	for (let index = piles.length > 0 ? top[piles.length - 1] : -1; index >= 0; index = from[index]) {
		staying.add(before[index]);
	}

	// **Right to left, and applied in that order.** `moveLayer` takes the id to insert *before*, so
	// each move has to name a layer that is already where it will finally be. Walking backwards makes
	// that true by construction: everything to the right of the layer being moved is settled. Sorting
	// the result into any other order would break exactly that, which is what makes the direction
	// part of the plan rather than a detail of how it was computed.
	const moves: Move[] = [];
	for (let index = after.length - 1; index >= 0; index--) {
		const id = after[index];
		if (staying.has(id)) continue;
		moves.push({ id, before: after[index + 1] ?? null });
		staying.add(id);
	}
	return moves;
}

/**
 * Whether two styles are the same map in a different order, and what to do about it.
 *
 * `null` for anything else at all - a layer added, removed or changed, a source touched, a paint
 * property adjusted. Those are `setStyle`'s, which is what the caller does when this declines.
 */
export function planReorder(previous: StyleSpecification | null, next: StyleSpecification): { moves: Move[] } | null {
	if (!previous) return null;
	if (previous.layers.length !== next.layers.length) return null;
	if (JSON.stringify(previous.sources) !== JSON.stringify(next.sources)) return null;

	// Every layer must be present on both sides and identical in itself; only its place may differ.
	const was = new Map(previous.layers.map((layer) => [layer.id, JSON.stringify(layer)]));
	for (const layer of next.layers) {
		const before = was.get(layer.id);
		if (before === undefined || before !== JSON.stringify(layer)) return null;
	}

	const from = previous.layers.map((layer) => layer.id);
	const to = next.layers.map((layer) => layer.id);
	if (from.every((id, index) => id === to[index])) return null;

	return { moves: minimalMoves(from, to) };
}

/** Performs the moves, in the order they were planned. */
export function applyMoves(map: MaplibreMap, moves: Move[]): void {
	for (const { id, before } of moves) map.moveLayer(id, before ?? undefined);
}
