<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { PaneState } from '../ipc/commands';
	import { paneTitle } from '../panes/catalogue';
	import Pane from './Pane.svelte';

	// One sidebar: a list of panes, in the order the layout says (Q31).
	//
	// The point of this component is that it is uninteresting. It knows nothing about pipelines,
	// styles or containers - it takes the panes belonging to its side and renders each one's
	// content by id. Adding the byte breakdown (B2) is then an entry in the core's catalogue, a
	// title, and one arm of the caller's `content` snippet; nothing here changes, and neither does
	// the other sidebar.
	//
	// Reordering by dragging is deliberately not here yet ([Q31]) - the list is what makes it
	// additive when it arrives.
	let {
		panes,
		onToggle,
		content
	}: {
		/** Already filtered to this side, in layout order. */
		panes: PaneState[];
		onToggle: (id: string, open: boolean) => void;
		/** Renders one pane's contents. Called per pane; may render nothing for an id it has no
		 *  component for, which is how a pane can exist in the core before it exists here. */
		content: Snippet<[string]>;
	} = $props();
</script>

<div class="sidebar">
	{#each panes as pane (pane.id)}
		<Pane title={paneTitle(pane.id)} open={pane.open} onToggle={(open) => onToggle(pane.id, open)}>
			{@render content(pane.id)}
		</Pane>
	{/each}
</div>

<style>
	/* Scrolls as one column rather than per pane: with several open, a scrollbar each would mean
	   hunting for the one that moves. `min-width: 0` because the chain from the grid down has to
	   carry it - a long path in any pane would otherwise widen the sidebar past its column. */
	.sidebar {
		display: flex;
		flex-direction: column;
		min-width: 0;
		height: 100%;
		overflow-y: auto;
	}
</style>
