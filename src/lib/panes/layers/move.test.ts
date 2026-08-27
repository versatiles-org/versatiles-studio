import { describe, expect, it } from 'vitest';
import { canMove, move, runs, segmentsFrom, step, type Placed } from './move';

/** `aaabbb` reads as three rows of `a` under three of `b`, which is how a stack is written here. */
const stack = (spelling: string): Placed[] =>
	[...spelling].map((source, index) => ({ source, ownId: `${source}${index}` }));

const spell = (rows: Placed[]) => rows.map((row) => row.source).join('');

describe('segmentsFrom', () => {
	it('is one whole segment per source when nothing is interleaved', () => {
		expect(segmentsFrom(stack('aaabb'))).toEqual([
			{ source: 'a', from: null },
			{ source: 'b', from: null }
		]);
	});

	// The gesture the design exists for, read back off the result: a source drawn in two places names
	// itself twice, and the second run carries the layer it starts at.
	it('names the boundary of a source’s second run, and only of that one', () => {
		expect(segmentsFrom(stack('aabaa'))).toEqual([
			{ source: 'a', from: null },
			{ source: 'b', from: null },
			{ source: 'a', from: 'a3' }
		]);
	});
});

describe('runs', () => {
	it('finds each source’s consecutive block', () => {
		expect(runs(stack('aabbba'))).toEqual([
			[0, 2],
			[2, 5],
			[5, 6]
		]);
	});
});

describe('canMove', () => {
	const rows = stack('aaabbb');

	it('allows a run past another source', () => {
		expect(canMove(rows, [0, 3], 6)).toBe(true);
	});

	it('refuses a move that lands where the run already is', () => {
		expect(canMove(rows, [0, 3], 0)).toBe(false);
		expect(canMove(rows, [0, 3], 3)).toBe(false);
	});

	// The invariant, as the one thing a user cannot do: a source's own layers keep the style's order,
	// so a run may never pass a sibling of its own source.
	it('refuses a run passing another run of its own source', () => {
		const split = stack('aabaa');
		expect(canMove(split, [0, 2], 5)).toBe(false);
		expect(canMove(split, [3, 5], 0)).toBe(false);
		// But it may still move within the gap between its siblings.
		expect(canMove(split, [2, 3], 0)).toBe(true);
	});
});

describe('move', () => {
	it('lifts a run above what was over it', () => {
		expect(spell(move(stack('aaabbb'), [0, 3], 6))).toBe('bbbaaa');
	});

	it('drops a run below what was under it', () => {
		expect(spell(move(stack('aaabbb'), [3, 6], 0))).toBe('bbbaaa');
	});

	// The headline case: the top of one source lifted over a small one, leaving that source in two
	// places with the other between them.
	it('splits a source when something is put inside it', () => {
		const rows = stack('aaaab');
		const after = move(rows, [3, 4], 5);
		expect(spell(after)).toBe('aaaba');
		expect(segmentsFrom(after)).toEqual([
			{ source: 'a', from: null },
			{ source: 'b', from: null },
			{ source: 'a', from: 'a3' }
		]);
	});
});

describe('step', () => {
	it('sends a run past the next whole run, not one row', () => {
		const rows = stack('aaabbb');
		expect(step(rows, [0, 3], 1)).toBe(6);
		expect(step(rows, [3, 6], -1)).toBe(0);
	});

	it('has nowhere to go at the end of the stack', () => {
		const rows = stack('aaabbb');
		expect(step(rows, [3, 6], 1)).toBeNull();
		expect(step(rows, [0, 3], -1)).toBeNull();
	});

	// A project with one source has nothing to interleave with, so every step is refused rather than
	// silently rearranging a style whose order is not the user's to set.
	it('has nowhere to go with one source', () => {
		const rows = stack('aaaa');
		expect(step(rows, [0, 2], 1)).toBeNull();
		expect(step(rows, [2, 4], -1)).toBeNull();
	});
});
