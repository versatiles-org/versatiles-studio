<script lang="ts">
	import MapCanvas from './lib/components/map/MapCanvas.svelte';
	import { defaultStyle } from './lib/map/default-style';
	import { serverBaseUrl } from './lib/ipc/commands';
	import type { StyleSpecification } from 'maplibre-gl';

	// The webview learns the port rather than assuming it — the server binds an ephemeral one (Q16).
	let style = $state<StyleSpecification | null>(null);
	let error = $state<string | null>(null);
	let view = $state<{ lng: number; lat: number; zoom: number } | null>(null);

	$effect(() => {
		serverBaseUrl()
			.then((url) => (style = defaultStyle(url)))
			.catch((e) => (error = String(e)));
	});
</script>

<main>
	{#if error}
		<p class="err">{error}</p>
	{:else if style}
		<MapCanvas {style} onMove={(v) => (view = { lng: v.lng, lat: v.lat, zoom: v.zoom })} />
		{#if view}
			<!-- Stands in for the command strip until S1.9. -->
			<div class="readout">
				{view.lat.toFixed(4)}, {view.lng.toFixed(4)} · z{view.zoom.toFixed(2)}
			</div>
		{/if}
	{:else}
		<p class="wait">Starting the tile server…</p>
	{/if}
</main>

<style>
	:global(body) {
		margin: 0;
	}
	main {
		position: relative;
		height: 100vh;
		font-family: system-ui, sans-serif;
	}
	.readout {
		position: absolute;
		left: 0.5rem;
		bottom: 0.5rem;
		background: rgb(255 255 255 / 0.9);
		padding: 0.25rem 0.5rem;
		border-radius: 3px;
		font:
			0.75rem ui-monospace,
			monospace;
	}
	.err,
	.wait {
		display: grid;
		place-content: center;
		height: 100%;
		color: #666;
	}
	.err {
		color: #b00;
	}
</style>
