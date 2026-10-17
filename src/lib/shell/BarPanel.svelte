<script lang="ts">
	import type { Snippet } from 'svelte';
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
	let {
		tools,
		empty = null,
		footer,
		list = $bindable(),
		children
	}: {
		tools?: Snippet;
		/** What the panel says instead of a list when there is nothing in it. */
		empty?: string | null;
		footer?: Snippet;
		/** The list element, for a caller that selects its text as the fallback to the clipboard. */
		list?: HTMLElement;
		children?: Snippet;
	} = $props();
</script>

<div class="panel">
	{#if tools}<div class="tools">{@render tools()}</div>{/if}
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

	.tools {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-5);
		border-bottom: 1px solid var(--rule);
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
