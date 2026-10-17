<script lang="ts">
	import type { Snippet } from 'svelte';

	// A tooltip of several lines, for what a native `title` cannot hold: it is one line, it waits a
	// second before it appears, and it never appears on keyboard focus.
	//
	// **Nothing in it to click.** It says something about the control it hangs from and nothing more,
	// so `pointer-events: none` - a pointer passing over it reaches the map, and it cannot steal the
	// hover that keeps it open. The owner decides when it is shown and where it sits; this draws the
	// surface.
	//
	// **Always in the document, hidden when not shown**, so the owner's `aria-describedby` has
	// something to point at: a screen reader reads a description from a hidden element too.
	//
	// In `map/` while the search field is its only owner; `common/` is for more than one.

	let { id, shown, children }: { id: string; shown: boolean; children: Snippet } = $props();
</script>

<div {id} class="tooltip" role="tooltip" hidden={!shown}>
	{@render children()}
</div>

<style>
	.tooltip {
		padding: var(--space-2) var(--space-3);
		background: var(--float-bg);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		color: var(--ink-2);
		font-size: var(--text-sm);
		line-height: 1.6;
		pointer-events: none;

		&[hidden] {
			display: none;
		}
	}
</style>
