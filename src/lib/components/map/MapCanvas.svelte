<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { untrack } from 'svelte';
	import * as maplibre from 'maplibre-gl';
	import type { StyleSpecification } from 'maplibre-gl';
	import { applyMapTheme } from '../../map/theme';
	import { theme } from '../../styles/theme.svelte';

	// Since v6 MapLibre loads its worker from a separate file, which bundlers cannot resolve via
	// `import.meta.url` once they have inlined `maplibre-gl.mjs` into a chunk. We ship a
	// self-contained copy (scripts/bundle_worker.ts) from `public/`, which Vite copies verbatim, and
	// point MapLibre at it by path.
	maplibre.setWorkerUrl('/maplibre-gl-worker.js');

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

	// Paint values are copied into a layer when it is added, so the map does not follow the system
	// theme the way the CSS does — it has to be told. Reading `theme.dark` is what subscribes this
	// effect; the value itself is not needed, since the tokens are re-read from the document.
	//
	// `untrack` around the map: reading it as a dependency would re-run the effect that creates it.
	$effect(() => {
		theme.dark;
		const instance = untrack(() => map);
		if (!instance) return;
		applyMapTheme(instance);
	});

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
	/*
	 * MapLibre's own controls, which ship light-only — on a dark map the attribution is a bright
	 * white pill in the corner. Scoped `:global` because these elements are MapLibre's, not ours.
	 * The colours are tokens, so this follows the theme like everything else.
	 */
	.map :global(.maplibregl-ctrl-attrib) {
		background: var(--float-bg);
		color: var(--ink-2);
	}
	.map :global(.maplibregl-ctrl-attrib a) {
		color: var(--ink-2);
	}
	.map :global(.maplibregl-ctrl-attrib-button) {
		background-color: var(--float-bg);
	}

	.map {
		width: 100%;
		height: 100%;
	}
	/* MapLibre paints its own background; give it a ground so the canvas never flashes white. */
	.map :global(.maplibregl-canvas-container) {
		background: var(--map-bg);
	}
</style>
