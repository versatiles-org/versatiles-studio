/** Sorting a table by a column: three clicks round, names as people read them, ties kept in order. */

import { describe, expect, it } from 'vitest';
import { nextSort, sortRows } from './sort';

describe('nextSort', () => {
	it('starts where the column starts, reverses, then goes back to unsorted', () => {
		const first = nextSort(null, 'Size', 'descending');
		expect(first).toEqual({ by: 'Size', direction: 'descending' });
		const second = nextSort(first, 'Size', 'descending');
		expect(second).toEqual({ by: 'Size', direction: 'ascending' });
		expect(nextSort(second, 'Size', 'descending')).toBeNull();
	});

	it('starts afresh on another column', () => {
		expect(nextSort({ by: 'Size', direction: 'ascending' }, 'Layer', 'ascending')).toEqual({
			by: 'Layer',
			direction: 'ascending'
		});
	});
});

describe('sortRows', () => {
	const rows = [
		{ name: 'b #10', size: 3 },
		{ name: 'a', size: 1 },
		{ name: 'b #9', size: 3 },
		{ name: 'c', size: null }
	];
	const value = (row: (typeof rows)[number], by: string) => (by === 'name' ? row.name : row.size);

	it('keeps the order rows came in without a sort', () => {
		expect(sortRows(rows, null, value)).toEqual(rows);
	});

	it('compares names as people read them', () => {
		const sorted = sortRows(rows, { by: 'name', direction: 'ascending' }, value);
		expect(sorted.map((row) => row.name)).toEqual(['a', 'b #9', 'b #10', 'c']);
	});

	it('keeps ties in order and a missing value last, whichever way round', () => {
		const down = sortRows(rows, { by: 'size', direction: 'descending' }, value);
		expect(down.map((row) => row.name)).toEqual(['b #10', 'b #9', 'a', 'c']);
		const up = sortRows(rows, { by: 'size', direction: 'ascending' }, value);
		expect(up.map((row) => row.name)).toEqual(['a', 'b #10', 'b #9', 'c']);
	});
});
