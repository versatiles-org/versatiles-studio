<script lang="ts" module>
	/** What the dot at the head of a row says. A job's states, and a problem's two levels. */
	export type RowState = 'queued' | 'running' | 'finished' | 'cancelled' | 'failed' | 'error' | 'warn';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	// One row in a `BarPanel`: a state dot, what the caller puts beside it, and a preformatted
	// block that opens under it - a job's log, a problem's stack.
	//
	// **State is carried by shape as much as colour**, so it survives a monochrome or colour-blind
	// reading: running is filled in the accent, an error filled in red, queued and a warning hollow,
	// and an ending that is neither filled in secondary ink.
	let {
		state,
		more = null,
		children
	}: {
		state: RowState;
		/** Opened under the row, preformatted and scrolling on its own axis: a log is full of paths
		 *  that would otherwise widen the whole bar. */
		more?: string | null;
		children: Snippet;
	} = $props();

	const failed = $derived(state === 'failed' || state === 'error');
</script>

<li class:failed>
	<div class="row">
		<span class="dot" data-state={state}></span>
		{@render children()}
	</div>
	{#if more !== null}
		<pre class="more">{more}</pre>
	{/if}
</li>

<style>
	.failed {
		background: var(--error-bg);
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
		padding: var(--space-2) var(--space-5);
		font-size: var(--text-sm);
	}

	.dot {
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--ink-2);

		&[data-state='running'] {
			background: var(--accent);
		}

		&[data-state='failed'],
		&[data-state='error'] {
			background: var(--error);
		}

		&[data-state='queued'],
		&[data-state='warn'] {
			background: none;
			box-shadow: inset 0 0 0 1px var(--ink-2);
		}
	}

	.more {
		margin: 0;
		padding: var(--space-3) var(--space-5);
		max-height: 12rem;
		overflow: auto;
		font-family: var(--font-mono);
		font-size: var(--text-mono-adjust);
		white-space: pre;
		color: var(--ink-2);
		background: var(--chrome);
	}
</style>
