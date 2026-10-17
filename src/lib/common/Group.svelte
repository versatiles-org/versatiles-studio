<script lang="ts">
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
	let {
		title,
		action,
		children
	}: {
		title: string;
		/** A `.quiet` button acting on the whole group, rendered beside the heading. */
		action?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section class="group">
	<h3>
		<span>{title}</span>
		{#if action}{@render action()}{/if}
	</h3>
	{@render children()}
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
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}
</style>
