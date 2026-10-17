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
	/* **Quieter than anything that can be clicked**: no shadow to lift it off the map, a surface the
	   map shows through, and small secondary text. A result list or a menu stands out from the map;
	   this should read as a note beside the control, not as a second control.

	   **The blur does the reading, not the opacity.** At 72% a road or a label behind it competed with
	   12px secondary text, and over a light map the dark theme's box turned a muddy grey. A heavy blur
	   turns whatever is behind into a wash of its colour, so the surface can stay see-through - and
	   passive - at 86%, and the text keeps its contrast over a city or an image. */
	.tooltip {
		padding: var(--space-1) var(--space-2);
		background: color-mix(in srgb, var(--surface) 86%, transparent);
		backdrop-filter: blur(12px) saturate(0.7);
		border-radius: var(--radius);
		color: var(--ink-2);
		font-size: var(--text-xs);
		line-height: 1.6;
		pointer-events: none;

		&[hidden] {
			display: none;
		}
	}
</style>
