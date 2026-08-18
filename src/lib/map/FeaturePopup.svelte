<script lang="ts">
	import type { Map as MaplibreMap, MapGeoJSONFeature, LngLat, MapMouseEvent } from 'maplibre-gl';
	import JsonTree from '../common/JsonTree.svelte';
	import { inspectTile, type TileInspection } from '../ipc/commands';
	import { tileForLngLat } from './tile-grid';

	// A8 — every attribute of the feature under the cursor. Deliberately shows all of them: the point
	// is answering "what is actually in this tile", which a curated subset would defeat.
	let { map, source }: { map: MaplibreMap | undefined; source: string | null } = $props();

	let anchor = $state<LngLat | null>(null);
	let features = $state<MapGeoJSONFeature[]>([]);
	let screen = $state<{ x: number; y: number } | null>(null);
	// A4 — what tile did that click land in, and what is inside it?
	let tile = $state<TileInspection | null>(null);

	$effect(() => {
		if (!map) return;
		const m = map;

		const reposition = () => {
			screen = anchor ? m.project(anchor) : null;
		};

		const onClick = (event: MapMouseEvent) => {
			const hits = m.queryRenderedFeatures(event.point);
			if (hits.length === 0) {
				anchor = null;
				screen = null;
				return;
			}
			// Cap it: a dense tile can return dozens under one pixel, and a popup listing all of them
			// is not a popup.
			features = hits.slice(0, 8);
			anchor = event.lngLat;
			reposition();

			tile = null;
			if (source) {
				const z = Math.floor(m.getZoom());
				const { x, y } = tileForLngLat(event.lngLat.lng, event.lngLat.lat, z);
				void inspectTile(source, z, x, y)
					.then((result) => (tile = result))
					.catch(() => (tile = null));
			}
		};

		// Hover feedback costs one query per move, which MapLibre already does for its own hit-testing.
		const onMove = (event: MapMouseEvent) => {
			const over = m.queryRenderedFeatures(event.point).length > 0;
			m.getCanvas().style.cursor = over ? 'pointer' : '';
		};

		m.on('click', onClick);
		m.on('mousemove', onMove);
		m.on('move', reposition);

		return () => {
			m.off('click', onClick);
			m.off('mousemove', onMove);
			m.off('move', reposition);
		};
	});

	const fmt = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`);

	function close() {
		anchor = null;
		screen = null;
		tile = null;
	}
</script>

{#if screen && features.length}
	<div class="popup" style="left: {screen.x}px; top: {screen.y}px">
		<button class="close" onclick={close} aria-label="Close">×</button>
		{#if tile}
			<article class="tile">
				<h3>tile {tile.z}/{tile.x}/{tile.y} <span class="id">{fmt(tile.storedBytes)}</span></h3>
				<ul class="layers">
					{#each tile.layers as layer (layer.name)}
						<li>
							<span class="lname truncate">{layer.name}</span>
							<span class="bytes">{fmt(layer.encodedBytes)}</span>
							<span class="feats">{layer.featureCount}&thinsp;f</span>
						</li>
					{/each}
				</ul>
			</article>
		{/if}

		{#each features as feature, i (i)}
			<article>
				<h3>
					{feature.sourceLayer ?? feature.source}
					{#if feature.id !== undefined}<span class="id">#{feature.id}</span>{/if}
				</h3>
				{#if Object.keys(feature.properties ?? {}).length}
					<JsonTree value={feature.properties} />
				{:else}
					<p class="none">no properties</p>
				{/if}
			</article>
		{/each}
	</div>
{/if}

<style>
	.lname {
		font-family: var(--font-mono);
	}
	.popup {
		position: absolute;
		transform: translate(-50%, calc(-100% - 10px));
		max-width: 20rem;
		max-height: 18rem;
		overflow-y: auto;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: var(--space-4) var(--space-4);
		font-size: var(--text-sm);
		pointer-events: auto;
		z-index: 5;
	}
	/* The tail, so it reads as attached to the point rather than floating near it. */
	.popup::after {
		content: '';
		position: absolute;
		left: 50%;
		bottom: -6px;
		margin-left: -6px;
		border: 6px solid transparent;
		border-top-color: var(--rule);
		border-bottom: 0;
	}
	.close {
		position: absolute;
		top: 0.15rem;
		right: 0.3rem;
		border: 0;
		background: none;
		font-size: var(--text-lg);
		line-height: 1;
		color: var(--ink-2);
	}
	article + article {
		border-top: 1px solid var(--rule);
		margin-top: var(--space-3);
		padding-top: var(--space-3);
	}
	h3 {
		margin: 0 0 var(--space-2);
		font-weight: 600;
	}
	.id {
		color: var(--ink-2);
		font-weight: 400;
		font-family: var(--font-mono);
	}
	.none {
		margin: 0;
		color: var(--ink-2);
	}
	.tile li {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: var(--space-4);
		font-family: var(--font-mono);
		line-height: 1.5;
	}
	.bytes {
		color: var(--accent);
	}
	.feats {
		color: var(--ink-2);
	}
</style>
