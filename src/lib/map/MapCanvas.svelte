<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { untrack } from 'svelte';
	import * as maplibre from 'maplibre-gl';
	import type { StyleSpecification } from 'maplibre-gl';
	import { applyMapTheme } from './theme';
	import { restyler } from './restyle';
	import { record } from '../state/diagnostics.svelte';
	import { theme } from '../styles/theme.svelte';
	import type { Camera } from '../ipc/commands';

	// Since v6 MapLibre loads its worker from a separate file, which bundlers cannot resolve via
	// `import.meta.url` once they have inlined `maplibre-gl.mjs` into a chunk. We ship a
	// self-contained copy (scripts/bundle_worker.ts) from `public/`, which Vite copies verbatim, and
	// point MapLibre at it by path.
	maplibre.setWorkerUrl('/maplibre-gl-worker.js');

	let {
		style,
		map = $bindable(),
		initialView = null,
		onMove,
		onStyleLoad
	}: {
		style: StyleSpecification;
		/** The single `Map` instance for this window (Q16) - bound out so modes can reach it. */
		map?: maplibre.Map;
		/** Where the camera was when this window was last open; `null` on a first run, which leaves
		 *  the map free to fit whatever is opened rather than starting at null island. */
		initialView?: Camera | null;
		/** Fired after the camera settles, so the core can persist it (Q16). */
		onMove?: (view: Camera) => void;
		/** Fired once a new style is in place. Setting a style discards every layer added to the old
		 *  one, so whatever the caller drew has to be drawn again. */
		onStyleLoad?: () => void;
	} = $props();

	/** The style currently applied. A plain variable: reading it must not make the effect re-run. */
	let applied: StyleSpecification | undefined;

	/**
	 * Hands a style to the map when the map is ready for one - see `restyle.ts`.
	 *
	 * Built with the map, because it listens for `style.load` and has to hear the first one.
	 */
	let apply: ((style: StyleSpecification) => void) | undefined;

	/**
	 * Whether the stored camera has been honoured.
	 *
	 * The layout is fetched over IPC, so it can arrive either side of the map being built. Applied
	 * *once* either way: every later change to `initialView` is this component's own `onMove` coming
	 * back around, and flying to it would fight the pointer that caused it.
	 */
	let restored = false;

	let container: HTMLDivElement;

	// The layout lost the race with the map. Jump rather than rebuild - one frame at the default
	// view is cheaper than discarding a live map and every layer drawn on it.
	$effect(() => {
		const view = initialView;
		const instance = map;
		if (!instance || !view || restored) return;
		restored = true;
		instance.jumpTo({
			center: [view.lng, view.lat],
			zoom: view.zoom,
			bearing: view.bearing,
			pitch: view.pitch
		});
	});

	// Swapping the background replaces the whole style, which is MapLibre's only way to do it -
	// and takes every layer added to the previous one with it. `onStyleLoad` is how the caller
	// hears that it needs to put its own layers back.
	//
	// **Applied rather than set**, because a style set while the current one is still loading cannot
	// be diffed - MapLibre says so once, then rebuilds from scratch, refetching every source at the
	// one moment a map has the most to fetch. On every launch, as it turned out. See `restyle.ts`.
	$effect(() => {
		const next = style;
		if (!apply || applied === next) return;
		applied = next;
		apply(next);
	});

	// Paint values are copied into a layer when it is added, so the map does not follow the system
	// theme the way the CSS does - it has to be told. Reading `theme.dark` is what subscribes this
	// effect; the value itself is not needed, since the tokens are re-read from the document.
	//
	// `untrack` around the map: reading it as a dependency would re-run the effect that creates it.
	$effect(() => {
		// Read for the dependency, not the value - `void` says so, and satisfies the lint rule that
		// would otherwise see a statement with no effect.
		void theme.dark;
		const instance = untrack(() => map);
		if (!instance) return;
		applyMapTheme(instance);
	});

	// The effect must depend on `container` alone. Reading `map` here would make the effect
	// re-run on its own write to it - `effect_update_depth_exceeded`, which is exactly what
	// happened the first time this was written.
	$effect(() => {
		if (!container) return;

		applied = untrack(() => style);

		// Read untracked: this effect must depend on `container` alone, and a camera arriving later
		// is handled below rather than by rebuilding the map underneath the user.
		const stored = untrack(() => initialView);
		if (stored) restored = true;

		const instance = new maplibre.Map({
			container,
			style: applied,
			attributionControl: { compact: true },
			...(stored
				? {
						center: [stored.lng, stored.lat] as [number, number],
						zoom: stored.zoom,
						bearing: stored.bearing,
						pitch: stored.pitch
					}
				: {})
		});
		// Before anything can set a style: this listens for `style.load`, and the first of those is
		// the style the map was just constructed with.
		apply = restyler(instance, () => onStyleLoad?.());

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

		// **MapLibre reports rather than throws.** A source it cannot load, a tile it cannot decode
		// and a style it will not accept all arrive here as an event - nothing is thrown, so no
		// `catch` in this application can ever see one, and until this listener existed they went to
		// a console that a bundled build does not expose (S6.8). It is the class of failure that
		// leaves a blank map and no explanation.
		//
		// Not shown in the status bar: these arrive per tile, and a bar that flickered an error for
		// every one of a thousand would be unreadable. The core folds the repeats into a count.
		instance.on('error', (event) => {
			const error = (event as { error?: unknown }).error;
			const message = error instanceof Error ? error.message : String(error ?? 'map error');
			record({
				level: 'error',
				origin: 'map',
				message,
				detail: error instanceof Error ? (error.stack ?? null) : null
			});
		});

		return () => {
			// Destroyed, not hidden - WebGL evicts the oldest context silently, so a Map that is not
			// on screen must not hold one (Q16).
			instance.remove();
			apply = undefined;
			untrack(() => (map = undefined));
		};
	});
</script>

<div class="map" bind:this={container}></div>

<style>
	/*
	 * MapLibre's own controls, which ship light-only - on a dark map the attribution is a bright
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
