<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { untrack } from 'svelte';
	import * as maplibre from 'maplibre-gl';
	import type { StyleSpecification } from 'maplibre-gl';
	import { applyMapTheme } from './theme';
	import { theme } from '../styles/theme.svelte';

	// Since v6 MapLibre loads its worker from a separate file, which bundlers cannot resolve via
	// `import.meta.url` once they have inlined `maplibre-gl.mjs` into a chunk. We ship a
	// self-contained copy (scripts/bundle_worker.ts) from `public/`, which Vite copies verbatim, and
	// point MapLibre at it by path.
	maplibre.setWorkerUrl('/maplibre-gl-worker.js');

	let {
		style,
		map = $bindable(),
		onMove,
		onStyleLoad
	}: {
		style: StyleSpecification;
		/** The single `Map` instance for this window (Q16) — bound out so modes can reach it. */
		map?: maplibre.Map;
		/** Fired after the camera settles, so the core can persist it (Q16). */
		onMove?: (view: { lng: number; lat: number; zoom: number; bearing: number; pitch: number }) => void;
		/** Fired once a new style is in place. Setting a style discards every layer added to the old
		 *  one, so whatever the caller drew has to be drawn again. */
		onStyleLoad?: () => void;
	} = $props();

	/** The style currently applied. A plain variable: reading it must not make the effect re-run. */
	let applied: StyleSpecification | undefined;

	let container: HTMLDivElement;

	// Swapping the background replaces the whole style, which is MapLibre's only way to do it —
	// and takes every layer added to the previous one with it. `onStyleLoad` is how the caller
	// hears that it needs to put its own layers back.
	$effect(() => {
		const next = style;
		const instance = untrack(() => map);
		if (!instance || applied === next) return;
		applied = next;
		instance.setStyle(next);
		instance.once('styledata', () => onStyleLoad?.());
	});

	// Paint values are copied into a layer when it is added, so the map does not follow the system
	// theme the way the CSS does — it has to be told. Reading `theme.dark` is what subscribes this
	// effect; the value itself is not needed, since the tokens are re-read from the document.
	//
	// `untrack` around the map: reading it as a dependency would re-run the effect that creates it.
	$effect(() => {
		// Read for the dependency, not the value — `void` says so, and satisfies the lint rule that
		// would otherwise see a statement with no effect.
		void theme.dark;
		const instance = untrack(() => map);
		if (!instance) return;
		applyMapTheme(instance);
	});

	// The effect must depend on `container` alone. Reading `map` here would make the effect
	// re-run on its own write to it — `effect_update_depth_exceeded`, which is exactly what
	// happened the first time this was written.
	$effect(() => {
		if (!container) return;

		applied = untrack(() => style);
		const instance = new maplibre.Map({
			container,
			style: applied,
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

	.map {
		width: 100%;
		height: 100%;

		:global(.maplibregl-ctrl-attrib) {
			background: var(--float-bg);
			color: var(--ink-2);
		}

		:global(.maplibregl-ctrl-attrib a) {
			color: var(--ink-2);
		}

		:global(.maplibregl-ctrl-attrib-button) {
			background-color: var(--float-bg);
		}

		:global(.maplibregl-canvas-container) {
			background: var(--map-bg);
		}
	}

	/* MapLibre paints its own background; give it a ground so the canvas never flashes white. */
</style>
