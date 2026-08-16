<script lang="ts">
	import { open } from '@tauri-apps/plugin-dialog';
	import type { Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';
	import MapCanvas from './lib/components/map/MapCanvas.svelte';
	import { defaultStyle } from './lib/map/default-style';
	import { addContainerToMap } from './lib/map/add-source';
	import { openContainer, serverBaseUrl, type ContainerInfo } from './lib/ipc/commands';

	let style = $state<StyleSpecification | null>(null);
	let map = $state<MaplibreMap | undefined>();
	let opened = $state<ContainerInfo[]>([]);
	let error = $state<string | null>(null);

	$effect(() => {
		serverBaseUrl()
			.then((url) => (style = defaultStyle(url)))
			.catch((e) => (error = String(e)));
	});

	async function pickContainer() {
		error = null;
		const picked = await open({
			multiple: false,
			directory: false,
			filters: [{ name: 'Tile containers', extensions: ['versatiles', 'mbtiles', 'pmtiles', 'tar'] }]
		});
		if (typeof picked !== 'string') return;
		await load(picked);
	}

	async function load(source: string) {
		try {
			const result = await openContainer(source);
			if (map) addContainerToMap(map, result);
			opened = [...opened.filter((o) => o.source !== result.info.source), result.info];
		} catch (e) {
			error = String(e);
		}
	}
</script>

<main>
	{#if style}
		<MapCanvas {style} bind:map />
	{/if}

	<div class="panel">
		<button onclick={pickContainer} disabled={!map}>Open a tile container…</button>
		{#if error}<p class="err">{error}</p>{/if}
		{#each opened as info (info.source)}
			<dl>
				<dt>container</dt>
				<dd>{info.container}</dd>
				<dt>tiles</dt>
				<dd>{info.tileFormat} · {info.tileCompression}</dd>
				<dt>zoom</dt>
				<dd>{info.minZoom}–{info.maxZoom}</dd>
			</dl>
		{/each}
	</div>
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
	.panel {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		width: 15rem;
		background: rgb(255 255 255 / 0.94);
		border-radius: 4px;
		padding: 0.75rem;
		font-size: 0.8rem;
		box-shadow: 0 1px 6px rgb(0 0 0 / 0.18);
	}
	button {
		width: 100%;
		padding: 0.4rem;
		font: inherit;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.15rem 0.6rem;
		margin: 0.6rem 0 0;
	}
	dt {
		color: #666;
	}
	dd {
		margin: 0;
		font-family: ui-monospace, monospace;
	}
	.err {
		color: #b00;
		margin: 0.5rem 0 0;
	}
</style>
