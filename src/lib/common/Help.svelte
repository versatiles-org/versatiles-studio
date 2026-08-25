<script lang="ts">
	import { help, dismiss } from '../state/help.svelte';

	// The help popover, drawn beside the sidebar and over the map.
	//
	// One instance for the whole application: the sidebar scrolls and clips, so a box inside a node
	// cannot escape it, and `position: fixed` from the trigger's measured rect sidesteps that without
	// portals or per-node listeners.
	//
	// Not the Popover API, which would give the top layer and light dismiss for free: it needs
	// Safari 17+ and a recent WebKitGTK, and Linux versions vary. Not CSS anchor positioning either,
	// which would delete the arithmetic below - worth revisiting later as a drop-in simplification.

	/** Wide enough that a p90 parameter is four lines rather than seven, capped so it never takes
	 *  more than about a third of a small window. */
	const WIDTH = 26;
	const GAP = 8;

	const shown = $derived(help.current);

	/// Beside the sidebar, level with the trigger.
	///
	/// Flipped when the pane is on the right - sides are data since [Q31], so that is a real case
	/// rather than a hypothetical - and clamped so a row near the bottom of a long chain does not
	/// push the popover off-screen.
	const position = $derived.by(() => {
		if (!shown) return null;
		const width = Math.min(WIDTH * 16, window.innerWidth * 0.34);
		const onLeft = shown.container.left + shown.container.width / 2 < window.innerWidth / 2;
		const left = onLeft ? shown.container.right + GAP : Math.max(GAP, shown.container.left - GAP - width);
		// Level with the trigger, then pulled back inside the window if it would overflow.
		const top = Math.max(GAP, Math.min(shown.anchor.top - 6, window.innerHeight - GAP - 160));
		return { left, top, width };
	});
</script>

<!-- A peek follows the pointer away on its own; a scroll invalidates the measured anchor, so the
     honest response is to close rather than to chase it. -->
<svelte:window onscroll={dismiss} onresize={dismiss} />

{#if shown && position}
	<div
		class="help"
		role={shown.pinned ? 'dialog' : 'tooltip'}
		aria-label="About {shown.content.title}"
		style:left="{position.left}px"
		style:top="{position.top}px"
		style:width="{position.width}px"
	>
		<div class="head">
			<span class="name">{shown.content.title}</span>
			{#if shown.content.summary}<span class="summary">{shown.content.summary}</span>{/if}
			{#if shown.pinned}
				<button type="button" class="close" aria-label="Close help" onclick={dismiss}>×</button>
			{/if}
		</div>
		{#if shown.content.body}<p class="body">{shown.content.body}</p>{/if}
	</div>
{/if}

<style>
	.help {
		position: fixed;
		z-index: 40;
		max-height: 60vh;
		overflow-y: auto;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		background: var(--float-bg);
		backdrop-filter: blur(6px);
		box-shadow: var(--shadow);
		color: var(--ink-2);
		font-size: var(--text-sm);
		line-height: 1.5;
	}

	.head {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		min-width: 0;
	}

	.name {
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--ink);
	}

	/* The type, the bounds and whether it is required - often the whole answer, and the part the
	   prose tends to bury. */
	.summary {
		flex: 1;
		min-width: 0;
		font-size: var(--text-xs);
	}

	.close {
		flex: none;
		color: var(--ink-2);
		padding: 0 var(--space-1);
		line-height: 1;

		&:hover {
			color: var(--ink);
		}
	}

	.body {
		margin: var(--space-2) 0 0;
	}
</style>
