<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { untrack } from 'svelte';
	import * as maplibre from 'maplibre-gl';
	import type { StyleSpecification } from 'maplibre-gl';

	// Since v6 MapLibre loads its worker from a separate file, which bundlers cannot resolve via
	// `import.meta.url` once they have inlined `maplibre-gl.mjs` into a chunk. We ship a
	// self-contained copy (scripts/bundle_worker.ts) and point MapLibre at it. A plain `new URL`
	// keeps this readable by every bundler — a Vite-only `?worker&url` import breaks Vite's own
	// dependency pre-bundling.
	maplibre.setWorkerUrl(new URL('../../../maplibre-gl-worker.js', import.meta.url).href);

	let {
		style,
		map = $bindable(),
		onMove
	}: {
		style: StyleSpecification;
		/** The single `Map` instance for this window (Q16) — bound out so modes can reach it. */
		map?: maplibre.Map;
		/** Fired after the camera settles, so the core can persist it (Q16). */
		onMove?: (view: { lng: number; lat: number; zoom: number; bearing: number; pitch: number }) => void;
	} = $props();

	let container: HTMLDivElement;

	// The effect must depend on `container` alone. Reading `map` here would make the effect
	// re-run on its own write to it — `effect_update_depth_exceeded`, which is exactly what
	// happened the first time this was written.
	$effect(() => {
		if (!container) return;

		const instance = new maplibre.Map({
			container,
			style: untrack(() => style),
			attributionControl: { compact: true }
		});
		untrack(() => (map = instance));

		const report = () => {
			const c = instance.getCenter();
			onMove?.({
				lng: c.lng,
				lat: c.lat,
				zoom: instance.getZoom(),
				bearing: instance.getBearing(),
				pitch: instance.getPitch()
			});
		};
		instance.on('moveend', report);

		return () => {
			// Destroyed, not hidden — WebGL evicts the oldest context silently, so a Map that is not
			// on screen must not hold one (Q16).
			instance.remove();
			untrack(() => (map = undefined));
		};
	});
</script>

<div class="map" bind:this={container}></div>

<style>
	.map {
		width: 100%;
		height: 100%;
	}
	/* MapLibre paints its own background; give it a ground so the canvas never flashes white. */
	.map :global(.maplibregl-canvas-container) {
		background: var(--map-bg, #eee);
	}
</style>
