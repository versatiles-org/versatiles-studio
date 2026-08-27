/**
 * Moving a run of the stack, and what the recipe then says
 * ([the layer stack](../../../../docs/layers.md)).
 *
 * **The order is an interleaving of per-source sequences.** Within a source the relative order of
 * its layers is the style's, not the user's; a move changes only how the sources interleave. That is
 * the whole of the rule, and everything here is a consequence of it:
 *
 * * a run may be dropped anywhere **between the neighbouring runs of its own source**, and nowhere
 *   else - which is what makes `osm ▸ Labels` below `osm ▸ Roads & rails` unreachable rather than
 *   merely unusual;
 * * a project with one source has nothing to move, because there is nothing to interleave with;
 * * the segments are **derived from the result**, not edited towards it. Walk the rows the move
 *   produced, start a segment wherever the source changes, and the boundaries are ascending by
 *   construction. Editing the segment list directly would be a second place where the invariant
 *   could be broken.
 */

import type { Segment } from '../../ipc/commands';

/** What the mover needs of a row: which source drew it, and its id in that source's own style. */
export interface Placed {
	source: string;
	ownId: string;
}

/** A half-open range of rows - what a tree node covers. */
export type Range = [number, number];

/**
 * The segments a row order amounts to.
 *
 * A source's *first* run carries no boundary. It has to start at that source's first layer - runs
 * partition a source's layers and there is nowhere earlier - so naming one would be a fact that
 * could go stale for no gain.
 */
export function segmentsFrom(rows: Placed[]): Segment[] {
	const out: Segment[] = [];
	const seen = new Set<string>();
	for (const [index, row] of rows.entries()) {
		if (index > 0 && rows[index - 1].source === row.source) continue;
		out.push({ source: row.source, from: seen.has(row.source) ? row.ownId : null });
		seen.add(row.source);
	}
	return out;
}

/** Where each top-level run begins and ends - the gaps a move can land in. */
export function runs(rows: Placed[]): Range[] {
	const out: Range[] = [];
	for (const [index, row] of rows.entries()) {
		const last = out.at(-1);
		if (last && rows[last[0]].source === row.source && last[1] === index) last[1] = index + 1;
		else out.push([index, index + 1]);
	}
	return out;
}

/**
 * Whether a run may be dropped into the gap at `to`.
 *
 * Refuses a move that would put this source's layers out of their own order, and a move that lands
 * where the run already is - a gesture that changes nothing should not cost an undo entry.
 */
export function canMove(rows: Placed[], range: Range, to: number): boolean {
	const [start, end] = range;
	if (to >= start && to <= end) return false;
	if (to < 0 || to > rows.length) return false;

	const source = rows[start].source;
	// The nearest layer of the same source outside the run, on each side. The gap has to stay
	// between them, or this run would pass one of its own siblings.
	let above = rows.length;
	for (let index = end; index < rows.length; index++) {
		if (rows[index].source === source) {
			above = index;
			break;
		}
	}
	let below = -1;
	for (let index = start - 1; index >= 0; index--) {
		if (rows[index].source === source) {
			below = index;
			break;
		}
	}
	return to > below && to <= above;
}

/** The rows after moving `range` to the gap at `to`, in the order they will be painted. */
export function move(rows: Placed[], range: Range, to: number): Placed[] {
	const [start, end] = range;
	const taken = rows.slice(start, end);
	const rest = [...rows.slice(0, start), ...rows.slice(end)];
	const at = to <= start ? to : to - taken.length;
	return [...rest.slice(0, at), ...taken, ...rest.slice(at)];
}

/**
 * Where a run would go if it were sent one step up or down the stack.
 *
 * **The step is one whole run, not one row.** The gaps that matter are the ones between top-level
 * runs: dropping a category one layer into the middle of another source is expressible - and is what
 * dragging will offer - but as a keyboard step it would be a move nobody could see the point of.
 * `null` when there is nowhere to go, which is the ordinary state of a project with one source.
 */
export function step(rows: Placed[], range: Range, direction: 1 | -1): number | null {
	const gaps = [0, ...runs(rows).map(([, end]) => end)];
	const candidates = direction === 1 ? gaps.filter((gap) => gap > range[1]) : gaps.filter((gap) => gap < range[0]);
	const ordered = direction === 1 ? candidates : [...candidates].reverse();
	return ordered.find((gap) => canMove(rows, range, gap)) ?? null;
}
