<script lang="ts">
	import type { Map as MaplibreMap, MapGeoJSONFeature, LngLat, MapMouseEvent } from 'maplibre-gl';
	import JsonTree from '../common/JsonTree.svelte';

	// A8 — every attribute of the feature under the cursor. Deliberately shows all of them: the point
	// is answering "what is actually in this tile", which a curated subset would defeat.
	let { map }: { map: MaplibreMap | undefined } = $props();

	let anchor = $state<LngLat | null>(null);
	let features = $state<MapGeoJSONFeature[]>([]);
	let screen = $state<{ x: number; y: number } | null>(null);

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

	function close() {
		anchor = null;
		screen = null;
	}
</script>

{#if screen && features.length}
	<div class="popup" style="left: {screen.x}px; top: {screen.y}px">
		<button class="close" onclick={close} aria-label="Close">×</button>
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
	.popup {
		position: absolute;
		transform: translate(-50%, calc(-100% - 10px));
		max-width: 20rem;
		max-height: 18rem;
		overflow-y: auto;
		background: var(--surface, #fff);
		border: 1px solid var(--rule, #d6dcda);
		border-radius: 4px;
		box-shadow: 0 2px 10px rgb(0 0 0 / 0.18);
		padding: 0.5rem 0.6rem;
		font-size: 0.75rem;
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
		border-top-color: var(--rule, #d6dcda);
		border-bottom: 0;
	}
	.close {
		position: absolute;
		top: 0.15rem;
		right: 0.3rem;
		border: 0;
		background: none;
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
		color: var(--ink-2, #667);
	}
	article + article {
		border-top: 1px solid var(--rule, #eee);
		margin-top: 0.45rem;
		padding-top: 0.45rem;
	}
	h3 {
		margin: 0 0 0.2rem;
		font-size: 0.75rem;
		font-weight: 600;
	}
	.id {
		color: var(--ink-2, #667);
		font-weight: 400;
		font-family: ui-monospace, monospace;
	}
	.none {
		margin: 0;
		color: var(--ink-2, #667);
	}
</style>
