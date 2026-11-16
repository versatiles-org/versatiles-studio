<script lang="ts">
	import Icon from './Icon.svelte';
	import Note from './Note.svelte';
	import { nextSort, sortRows, type Direction, type Sort } from './sort';
	import type { BrowseEntry, BrowseListing } from '../ipc/commands';

	// One folder, a row per thing in it (the file dialog): folders first, then files.
	//
	// **One tab stop, and the arrows walk it** - a listbox, as a file list is everywhere else. Enter
	// opens a folder or chooses a file, Backspace goes up. A click selects and a double-click opens,
	// which is what a hand reaching for a file list expects.
	//
	// **Its own scroller at a fixed height**, so a folder of three files and one of three hundred
	// leave the dialog the same size - nothing around it moves when the folder changes.
	//
	// **A file that cannot be chosen is shown, dimmed**, rather than left out: a folder that seems to
	// hold nothing reads as the wrong folder, and the reason is the file's kind, not its absence.
	//
	// **Sorted by any column, folders still first** - the kit's three clicks (`sort.ts`): a column, the
	// other way, and back to by name. Folders stay above the files whichever column it is, as they do
	// in every file manager: sorting by size is a question about files. Not `SortHeader`, which is a
	// table's `<th>`; this is a list of options, so the headers are a row of buttons above it, kept
	// for the next folder.

	let {
		listing,
		selected,
		accepts,
		label,
		onSelect,
		onOpen,
		onUp
	}: {
		listing: BrowseListing | null;
		/** The location of the row picked, or `null`. */
		selected: string | null;
		/** Whether a file is one this dialog may hand back. Folders always open. */
		accepts: (entry: BrowseEntry) => boolean;
		label: string;
		onSelect: (entry: BrowseEntry) => void;
		/** A folder to go into, or a file to choose. */
		onOpen: (entry: BrowseEntry) => void;
		onUp: () => void;
	} = $props();

	const COLUMNS: { column: string; label: string; first: Direction }[] = [
		{ column: 'name', label: 'Name', first: 'ascending' },
		{ column: 'size', label: 'Size', first: 'descending' },
		{ column: 'modified', label: 'Modified', first: 'descending' }
	];
	let sort = $state<Sort | null>({ by: 'name', direction: 'ascending' });

	const value = (entry: BrowseEntry, column: string) =>
		column === 'size' ? entry.size : column === 'modified' ? entry.modified : entry.name;
	const entries = $derived.by(() => {
		const all = listing?.entries ?? [];
		return [
			...sortRows(
				all.filter((entry) => entry.folder),
				sort,
				value
			),
			...sortRows(
				all.filter((entry) => !entry.folder),
				sort,
				value
			)
		];
	});
	const at = $derived(entries.findIndex((entry) => entry.location === selected));
	const usable = (entry: BrowseEntry) => entry.folder || accepts(entry);

	let list = $state<HTMLElement>();

	function step(by: number, from = at): void {
		for (let index = from + by; index >= 0 && index < entries.length; index += by) {
			if (usable(entries[index])) {
				onSelect(entries[index]);
				list?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
				return;
			}
		}
	}

	function key(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown') step(1);
		else if (event.key === 'ArrowUp') step(-1);
		else if (event.key === 'Home') step(1, -1);
		else if (event.key === 'End') step(-1, entries.length);
		else if (event.key === 'Enter' && at >= 0) onOpen(entries[at]);
		else if (event.key === 'Backspace') onUp();
		else return;
		event.preventDefault();
	}

	/// Sizes as a file manager writes them: the unit that suits each, one decimal past the bytes.
	function size(bytes: number): string {
		if (bytes < 1e3) return `${bytes} B`;
		const [unit, scale] = bytes < 1e6 ? ['kB', 1e3] : bytes < 1e9 ? ['MB', 1e6] : ['GB', 1e9];
		return `${(bytes / scale).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit}`;
	}

	/// When a file last changed, to the minute and in this computer's time: `2026-11-16 14:32`. The
	/// day alone could not tell this morning's export from last night's.
	function when(seconds: number): string {
		const at = new Date(seconds * 1000);
		const two = (value: number) => String(value).padStart(2, '0');
		return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
	}
</script>

<div class="table">
	<div class="head" role="group" aria-label="Sort by">
		<span class="glyph" aria-hidden="true"><Icon name="file" /></span>
		{#each COLUMNS as { column, label: name, first } (column)}
			{@const on = sort?.by === column ? sort.direction : null}
			<button
				type="button"
				class="column {column}"
				class:on
				aria-pressed={on !== null}
				title="Sort by {name.toLowerCase()}"
				onclick={() => (sort = nextSort(sort, column, first))}
			>
				{name}{#if on}<span class="visually-hidden">, {on}</span><Icon
						name={on === 'ascending' ? 'up' : 'down'}
						size="0.85em"
					/>{/if}
			</button>
		{/each}
	</div>
	<div
		bind:this={list}
		class="list"
		role="listbox"
		tabindex="0"
		aria-label={label}
		aria-activedescendant={at >= 0 ? `entry-${at}` : undefined}
		onkeydown={key}
	>
		{#each entries as entry, index (entry.location)}
			<button
				type="button"
				id="entry-{index}"
				data-index={index}
				class="row"
				class:selected={index === at}
				role="option"
				aria-selected={index === at}
				aria-disabled={!usable(entry)}
				tabindex="-1"
				title={usable(entry) ? undefined : 'Not a kind of file this can open'}
				onclick={() => usable(entry) && onSelect(entry)}
				ondblclick={() => usable(entry) && onOpen(entry)}
			>
				<Icon name={entry.folder ? 'folder' : 'file'} />
				<span class="name truncate">{entry.name}</span>
				<span class="size">{entry.folder || entry.size === null ? '' : size(entry.size)}</span>
				<span class="when">{entry.modified === null ? '' : when(entry.modified)}</span>
			</button>
		{:else}
			{#if listing}<div class="vacant"><Note tone="empty">This folder is empty.</Note></div>{/if}
		{/each}
	</div>
</div>

<style>
	/* The headers above the list and the rows in it share one set of columns. Widths rather than
	   `auto`, because every row is a grid of its own and would otherwise size its columns to itself. */
	.table {
		--columns: auto minmax(0, 1fr) var(--size-width) var(--when-width);
		--size-width: 5.5rem;
		--when-width: 8.5rem;
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-height: 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}

	.head,
	.row {
		display: grid;
		grid-template-columns: var(--columns);
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-1) var(--space-3);
	}

	/* The scroller's gutter on both, so a scrollbar does not shift the rows out from under the headers. */
	.head {
		/* Never shrunk: a flex item with `overflow: hidden` may be squeezed below its content, and a
		   long folder in the list below took all but a few pixels of the headers' height. */
		flex: none;
		overflow: hidden;
		scrollbar-gutter: stable;
		border-bottom: 1px solid var(--rule);
		font-size: var(--text-xs);
		color: var(--ink-2);
	}

	.glyph {
		visibility: hidden;
	}

	.column {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-width: 0;

		&:hover,
		&.on {
			color: var(--ink);
		}

		&.size,
		&.modified {
			justify-content: flex-end;
		}
	}

	.list {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		scrollbar-gutter: stable;
	}

	.row {
		width: 100%;
		text-align: left;
		font-size: var(--text-sm);
		cursor: default;

		&:hover:not([aria-disabled='true']) {
			background: var(--chrome);
		}

		&.selected {
			background: color-mix(in srgb, var(--accent) 18%, var(--surface));
		}

		&[aria-disabled='true'] {
			opacity: var(--disabled-opacity);
		}
	}

	.size,
	.when {
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
	}

	.vacant {
		padding: var(--space-3);
	}
</style>
