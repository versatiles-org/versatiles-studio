<script lang="ts">
	import Icon from './Icon.svelte';
	import type { Snippet } from 'svelte';

	// A group of controls inside a pane, with its heading (the kit, S12).
	//
	// **The second of two heading levels, and the last.** The pane's title is the uppercase label in
	// its header; this is the sentence-case heading under it, and nothing below this carries a
	// heading - a field has a label, a note has a tone ([Q70]). Seven uppercase labels in one pane
	// read as seven panes, which is what this replaces.
	//
	// The action is for the one control that acts on the whole group - reset, clear - and sits on
	// the heading's line so it is found where the group is named rather than at its foot.
	//
	// **A group may fold.** Given `onToggle`, the heading becomes a disclosure - a real button with a
	// real `aria-expanded`, the same shape as a pane's header one level in - and `summary` is what the
	// folded group says about itself in one line. The crop is the case: four numbers nobody needs to
	// see once they are set.
	let {
		title,
		open = true,
		onToggle,
		summary = null,
		action,
		children
	}: {
		title: string;
		/** Whether a foldable group is open. Ignored without `onToggle`. */
		open?: boolean;
		/** Makes the heading a disclosure. The durable copy of `open` is the caller's. */
		onToggle?: (open: boolean) => void;
		/** What the folded group amounts to, shown while it is closed. */
		summary?: string | null;
		/** A `.quiet` button acting on the whole group, rendered beside the heading. */
		action?: Snippet;
		children: Snippet;
	} = $props();

	const shown = $derived(!onToggle || open);
	const id = $derived(`group-${title.toLowerCase().replace(/\s+/g, '-')}`);
</script>

<section class="group">
	<h3>
		{#if onToggle}
			<button
				type="button"
				class="disclosure"
				aria-expanded={shown}
				aria-controls={id}
				onclick={() => onToggle(!shown)}
			>
				<span class="chevron" class:open={shown} aria-hidden="true"><Icon name="chevron" size="1em" /></span>
				<span>{title}</span>
				{#if !shown && summary}<span class="summary">{summary}</span>{/if}
			</button>
		{:else}
			<span>{title}</span>
		{/if}
		{#if action}{@render action()}{/if}
	</h3>
	{#if shown}
		<div class="body" {id}>{@render children()}</div>
	{/if}
</section>

<style>
	.group {
		display: flex;
		flex-direction: column;
		gap: var(--gap-group);
		min-width: 0;
	}

	/* Sentence case at body size, a step heavier than the text under it - and never uppercase, which
	   is the pane title's and nobody else's. */
	h3 {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		margin: 0;
		min-width: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	/* The whole heading line is the target, in the heading's own type. */
	.disclosure {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		flex: 1;
		min-width: 0;
		text-align: left;
		font-weight: inherit;

		&:hover .chevron {
			color: var(--ink);
		}
	}

	/* What the group comes to while its controls are folded away: quiet, at the far end. */
	.summary {
		margin-left: auto;
		font-size: var(--text-xs);
		font-weight: 400;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--gap-group);
		min-width: 0;
	}
</style>
