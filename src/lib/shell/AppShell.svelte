<script lang="ts">
	import type { Snippet } from 'svelte';
	import PaneResizer from './PaneResizer.svelte';

	// One surface, not four modes (Q22): the left pane holds the chain from data to pixels, the map
	// sits in the middle, the right pane reports on the selection. Each region is optional and the
	// grid rebuilds around whichever are present — with nothing open, that leaves the map full
	// width, which is what Explore used to be.
	//
	// There is no in-app title bar. The window has native decorations, so one would have repeated
	// the OS title verbatim; which document a window holds is said in the window title instead, the
	// way a document application says it. The strip at the top is the application bar, which arrived
	// at S4 holding the mode tabs and now holds what is about Studio or the project ([Q39]).
	//
	// The bottom row is the status and job bar (Q24).
	let {
		leftPane,
		leftWidth = 264,
		onLeftResize,
		rightWidth = 304,
		onRightResize,
		mapPane,
		rightPane,
		statusBar,
		appBar
	}: {
		/** The Map · Assets bar, above everything (Q22, S4.1). */
		appBar?: Snippet;
		leftPane?: Snippet;
		/** CSS pixels. The core clamps it, so this is already in range. */
		leftWidth?: number;
		/** `done` is false while dragging and true on release, so only the last one is persisted. */
		onLeftResize?: (width: number, done: boolean) => void;
		/** CSS pixels. Clamped by the core, like the left one. */
		rightWidth?: number;
		onRightResize?: (width: number, done: boolean) => void;
		mapPane: Snippet;
		rightPane?: Snippet;
		statusBar?: Snippet;
	} = $props();
</script>

<div
	class="shell"
	class:has-left={leftPane}
	class:has-right={rightPane}
	style:--left-width="{leftWidth}px"
	style:--right-width="{rightWidth}px"
>
	{#if appBar}<div class="bar">{@render appBar()}</div>{/if}
	{#if leftPane}
		<aside class="left">{@render leftPane()}</aside>
		<PaneResizer side="left" width={leftWidth} onResize={(w, done) => onLeftResize?.(w, done)} />
	{/if}
	<div class="map">{@render mapPane()}</div>
	{#if rightPane}
		<aside class="right">{@render rightPane()}</aside>
		<PaneResizer side="right" width={rightWidth} onResize={(w, done) => onRightResize?.(w, done)} />
	{/if}
	{#if statusBar}<footer class="status">{@render statusBar()}</footer>{/if}
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: 1fr;
		/* A row for the application bar above everything. It is `auto`, so with no bar the row
		   collapses to nothing and the layout is what it was (Q22, S4.1). */
		grid-template-rows: auto 1fr auto;
		grid-template-areas: 'bar' 'map' 'status';
		height: 100vh;
		color: var(--ink);
		background: var(--chrome);

		&.has-right {
			grid-template-columns: 1fr clamp(180px, var(--right-width), 640px);
			grid-template-areas: 'bar bar' 'map right' 'status status';
		}

		&.has-left.has-right {
			grid-template-columns: clamp(180px, var(--left-width), 640px) 1fr clamp(180px, var(--right-width), 640px);
			grid-template-areas: 'bar bar bar' 'left map right' 'status status status';
		}

		&.has-left {
			grid-template-columns: clamp(180px, var(--left-width), 640px) 1fr;
			grid-template-areas: 'bar bar' 'left map' 'status status';
		}
	}

	/* `clamp` mirrors the range the core enforces on save (`store::Layout`), which stays the
	   authority — this only keeps a live drag from overshooting before it is stored. */

	.bar {
		grid-area: bar;
	}

	/* Both panes clip; their content scrolls. Keeping the scroll inside the content means a pane can
	   hold a sticky header or a footer later without the aside fighting it — and it is one rule
	   rather than two arrangements that happen to look the same. */
	.left,
	.right {
		min-width: 0;
		overflow: hidden;
	}

	.left {
		grid-area: left;
		border-right: 1px solid var(--rule);
	}

	.map {
		grid-area: map;
		position: relative;
		min-width: 0;
		/* Everything the map floats — controls, the view list, the feature popup — is positioned
		   against this box, and nothing of it belongs over the panes beside it. The popup is the one
		   that reached: it is anchored to a point that can sit at the very edge. */
		overflow: hidden;
	}

	.right {
		grid-area: right;
		border-left: 1px solid var(--rule);
		background: var(--surface);
	}

	/* **Above everything.** The grid already reserves the row, so nothing can push the bar off
	   screen — but a positioned child of the map can paint over it, and one did: the landing screen
	   sits at `z-index: 6` and used to spill its overflow across the bar. The bar carries what the
	   application is doing, including the error a spilling element is often the cause of, so it wins
	   against every other layer here: 4 map controls, 5 popups and resizers, 6 the landing screen,
	   40 the parameter help. A modal dialog, when one arrives, goes above this. */
	.status {
		grid-area: status;
		position: relative;
		z-index: 50;
		border-top: 1px solid var(--rule);
		background: var(--surface);
	}

	:global(:root) {
		--ink: var(--ink);
		--ink-2: var(--ink-2);
		--rule: var(--rule);
		--surface: var(--surface);
		--chrome: var(--chrome);
		--accent: var(--accent);
	}
</style>
