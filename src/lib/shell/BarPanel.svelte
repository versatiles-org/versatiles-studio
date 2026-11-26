<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '../common/Icon.svelte';
	import Note from '../common/Note.svelte';

	// A panel the status bar expands upward into (the kit, S13).
	//
	// **The shell the job list and the problem list share.** Both are a capped, scrolling list of
	// rows over the bar, each row led by a state dot and able to open a preformatted block under
	// itself - and both had written the whole of that, nearly line for line, in their own files.
	// What differs is what a row says, and that is the caller's: a row is `BarRow`, and what goes
	// in it is a snippet.
	//
	// `tools` is a strip above the list for what acts on the whole of it - the problem panel's
	// session tabs and its copy button; `footer` is the line under it - where the log file is.
	//
	// **Its own way out, in the corner.** The bar's button opens and closes it, but that button is
	// not always there to press: the problem count's goes once the list is cleared, and Help →
	// Problems… opens the panel in a session that has none. So every panel carries an ×, at the end
	// of a strip that stays put while the list under it scrolls - the panel's title stands in for the
	// tools when it has none.
	let {
		label,
		onClose,
		tools,
		empty = null,
		footer,
		list = $bindable(),
		children
	}: {
		/** What the panel is, for its title and its close button's name. */
		label: string;
		onClose?: () => void;
		tools?: Snippet;
		/** What the panel says instead of a list when there is nothing in it. */
		empty?: string | null;
		footer?: Snippet;
		/** The list element, for a caller that selects its text as the fallback to the clipboard. */
		list?: HTMLElement;
		children?: Snippet;
	} = $props();
</script>

<div class="panel" role="region" aria-label={label}>
	{#if tools || onClose}
		<div class="tools">
			{#if tools}{@render tools()}{:else}<span class="title">{label}</span>{/if}
			{#if onClose}
				<button type="button" class="icon close" aria-label="Close {label}" title="Close" onclick={onClose}>
					<Icon name="remove" />
				</button>
			{/if}
		</div>
	{/if}
	{#if empty !== null}
		<div class="blank"><Note tone="empty">{empty}</Note></div>
	{:else}
		<ul bind:this={list}>{@render children?.()}</ul>
	{/if}
	{#if footer}{@render footer()}{/if}
</div>

<style>
	.panel {
		max-height: 15rem;
		overflow-y: auto;
		overscroll-behavior: contain;
		border-bottom: 1px solid var(--rule);
	}

	/* Stuck to the top, so the × is in the corner however far the list has scrolled. */
	.tools {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--surface);
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-5);
		border-bottom: 1px solid var(--rule);
		font-size: var(--text-sm);
	}

	.title {
		flex: 1;
		color: var(--ink-2);
	}

	.close {
		margin-left: auto;
		font-size: var(--text-sm);
	}

	.blank {
		padding: var(--space-3) var(--space-5);
	}

	/* The rows are `BarRow`s and carry its scope, so the hairline between two is said from here. */
	ul > :global(li + li) {
		border-top: 1px solid var(--rule);
	}
</style>
