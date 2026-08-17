<script lang="ts">
	import type { Snippet } from 'svelte';

	// Explore mode: no left pane, no editor — the map runs wide and the inspector reports on it.
	// The job bar arrives at S3 and the mode bar at S4 (Q22 — it waits for a second entry); both slot
	// into this grid without moving anything.
	let {
		mapPane,
		rightPane,
		commandBar
	}: {
		mapPane: Snippet;
		rightPane?: Snippet;
		commandBar?: Snippet;
	} = $props();
</script>

<div class="shell" class:has-right={rightPane}>
	<header class="titlebar"><span>VersaTiles Studio</span></header>
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
