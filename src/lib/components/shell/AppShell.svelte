<script lang="ts">
	import type { Snippet } from 'svelte';

	// One surface, not four modes (Q22): the left pane holds the chain from data to pixels, the map
	// sits in the middle, the right pane reports on the selection. Each region is optional and the
	// grid rebuilds around whichever are present — with nothing open, that leaves the map full
	// width, which is what Explore used to be.
	//
	// The job bar arrives at S3 and the mode bar at S4 (it waits for a second entry); both slot into
	// this grid without moving anything.
	let {
		leftPane,
		leftWidth = 264,
		mapPane,
		rightPane,
		commandBar
	}: {
		leftPane?: Snippet;
		/** CSS pixels. The core clamps it, so this is already in range. */
		leftWidth?: number;
		mapPane: Snippet;
		rightPane?: Snippet;
		commandBar?: Snippet;
	} = $props();
</script>

<div class="shell" class:has-left={leftPane} class:has-right={rightPane} style:--left-width="{leftWidth}px">
	<header class="titlebar"><span>VersaTiles Studio</span></header>
	{#if leftPane}<aside class="left">{@render leftPane()}</aside>{/if}
	<div class="map">{@render mapPane()}</div>
	{#if rightPane}<aside class="right">{@render rightPane()}</aside>{/if}
	{#if commandBar}<footer class="command">{@render commandBar()}</footer>{/if}
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: 1fr;
		grid-template-rows: auto 1fr auto;
		grid-template-areas: 'title' 'map' 'command';
		height: 100vh;
		font-family: system-ui, sans-serif;
		font-size: 0.82rem;
		color: var(--ink);
		background: var(--chrome);
	}
	.shell.has-right {
		grid-template-columns: 1fr var(--right-width, 19rem);
		grid-template-areas: 'title title' 'map right' 'command command';
	}
	.shell.has-left {
		grid-template-columns: var(--left-width) 1fr;
		grid-template-areas: 'title title' 'left map' 'command command';
	}
	.shell.has-left.has-right {
		grid-template-columns: var(--left-width) 1fr var(--right-width, 19rem);
		grid-template-areas: 'title title title' 'left map right' 'command command command';
	}
	.left {
		grid-area: left;
		border-right: 1px solid var(--rule);
		min-width: 0;
		overflow: hidden;
	}
	.titlebar {
		grid-area: title;
		padding: 0.3rem 0.7rem;
		border-bottom: 1px solid var(--rule);
		color: var(--ink-2);
		font-size: 0.75rem;
	}
	.map {
		grid-area: map;
		position: relative;
		min-width: 0;
	}
	.right {
		grid-area: right;
		border-left: 1px solid var(--rule);
		overflow-y: auto;
		background: var(--surface);
	}
	.command {
		grid-area: command;
		border-top: 1px solid var(--rule);
		background: var(--surface);
	}

	:global(:root) {
		--ink: #16201f;
		--ink-2: #66716f;
		--rule: #d6dcda;
		--surface: #fbfcfb;
		--chrome: #f2f4f3;
		--accent: #0e7c7b;
	}
</style>
