<script lang="ts">
	import Icon from './Icon.svelte';
	import { nextSort, type Direction, type Sort } from './sort';

	// A column header that sorts its table (the kit, S14.5).
	//
	// A `<th>` holding a button, so the header is still the column's header to assistive technology
	// and `aria-sort` says which way it is sorted; the arrow says the same to the eye. Which rows
	// that reorders is the caller's - `sortRows` does it - so this holds no rows and no state.
	let {
		label,
		column = label,
		sort,
		first = 'descending',
		onSort
	}: {
		label: string;
		/** The name `sortRows` is handed for this column; the label, unless two would clash. */
		column?: string;
		/** How the table is sorted now, by whichever column. */
		sort: Sort | null;
		/** Where a first click starts: the largest number, or the first name. */
		first?: Direction;
		onSort: (sort: Sort | null) => void;
	} = $props();

	const direction = $derived(sort?.by === column ? sort.direction : null);
</script>

<th scope="col" aria-sort={direction ?? 'none'}>
	<button type="button" class="sort" class:on={direction} onclick={() => onSort(nextSort(sort, column, first))}>
		{label}{#if direction}<span class="arrow" aria-hidden="true"
				><Icon name={direction === 'ascending' ? 'up' : 'down'} size="0.85em" /></span
			>{/if}
	</button>
</th>

<style>
	/* The header's own look - its colour, its alignment - with a hand over it to say it can be pressed. */
	.sort {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 0;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;

		&:hover,
		&.on {
			color: var(--ink);
		}
	}

	.arrow {
		display: inline-flex;
	}
</style>
