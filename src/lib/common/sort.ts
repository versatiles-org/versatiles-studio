/**
 * Sorting a table by a column (the kit, S14.5).
 *
 * **Three states, not two.** A click sorts, a second reverses, a third puts the rows back as they
 * came. The order they came in usually means something - the tile dialog's layers are in the order
 * they are stored and painted - and a table that can only be sorted has lost it for good.
 *
 * **Numbers start with the largest**, because a column of sizes is opened to find the biggest; names
 * start at A. Names compare as people read them, so `#10` comes after `#9`, and rows that compare
 * equal keep the order they came in.
 */

export type Direction = 'ascending' | 'descending';

export interface Sort {
	/** The column, by the name its header was given. */
	by: string;
	direction: Direction;
}

/** What a click on `column`'s header leads to, from `current`; `first` is where that column starts. */
export function nextSort(current: Sort | null, column: string, first: Direction): Sort | null {
	if (current?.by !== column) return { by: column, direction: first };
	if (current.direction === first) return { by: column, direction: first === 'ascending' ? 'descending' : 'ascending' };
	return null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * `rows` in the order `sort` asks, by what `value` reads from each row for the sorted column - or
 * as they came, without one. A missing value goes last whichever way round.
 */
export function sortRows<T>(
	rows: readonly T[],
	sort: Sort | null,
	value: (row: T, column: string) => string | number | null | undefined
): T[] {
	if (!sort) return [...rows];
	const sign = sort.direction === 'ascending' ? 1 : -1;
	return rows
		.map((row, index) => ({ row, index, key: value(row, sort.by) }))
		.sort((a, b) => {
			if (a.key == null || b.key == null) {
				return (a.key == null ? 1 : 0) - (b.key == null ? 1 : 0) || a.index - b.index;
			}
			const order =
				typeof a.key === 'number' && typeof b.key === 'number'
					? a.key - b.key
					: collator.compare(String(a.key), String(b.key));
			return sign * order || a.index - b.index;
		})
		.map(({ row }) => row);
}
