<script lang="ts">
	import Icon from './Icon.svelte';
	import Note from './Note.svelte';
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

	const entries = $derived(listing?.entries ?? []);
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

<style>
	.list {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto auto;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-1) var(--space-3);
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

	.size {
		min-width: 5rem;
	}

	.vacant {
		padding: var(--space-3);
	}
</style>
