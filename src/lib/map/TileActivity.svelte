<script lang="ts">
	import { Marker, type Map as MaplibreMap } from 'maplibre-gl';
	import { tiles } from '../state/tiles.svelte';

	// Which tiles the map is still waiting for (S2.16, C3).
	//
	// The status bar says how many; this says which. On a slow pipeline the two answer different
	// questions - "is anything happening" and "is it the tile I am looking at" - and the second is
	// the one that tells you whether panning somewhere else would help.
	//
	// **Drawn from the queue, not from MapLibre.** Studio fetches these tiles itself, so it knows a
	// tile's coordinate and its state at the same time; MapLibre reports both halves as "loading"
	// (see `tile-queue.ts`).
	//
	// **A marker, not a wash over the square.** This used to shade the whole tile through a GeoJSON
	// overlay, which put grey over the part of the map being looked at - and the tile underneath is
	// usually the previous one, still perfectly readable while its replacement is on the way. So the
	// shading hid the very thing it was reporting on. A spinner at the middle of the tile says the
	// same thing, covers almost nothing, and being animated says *waiting* rather than *broken*.
	//
	// **Markers rather than layers**, which also takes a whole class of bug with it: a marker is not
	// part of the style, so a restyle does not destroy it and nothing has to put it back or lift it
	// above the layers drawn later. That was the entire reason this file reached for `mapOverlay`
	// ([Q46]); with no source and no layers there is nothing left to lose.

	let { map }: { map: MaplibreMap | undefined } = $props();

	/// One marker per tile coordinate, so a redraw while the same tiles are still waiting leaves
	/// them where they are - taking them down and putting them back would restart every spinner
	/// mid-turn, which reads as a stutter rather than as progress.
	///
	/// A plain `Map`: this is bookkeeping about the map's own DOM, never read reactively, so a
	/// reactive one would track changes nothing subscribes to.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const markers = new Map<string, Marker>();

	/// The marker's own element. MapLibre positions *this* with a transform, so the part that spins
	/// has to be a child of it - animating the same element would fight the placement every frame.
	function element(): HTMLElement {
		const holder = document.createElement('div');
		holder.className = 'tile-busy';
		const ring = document.createElement('div');
		ring.className = 'tile-busy-ring';
		holder.append(ring);
		return holder;
	}

	const TITLE = { queued: 'Waiting for a slot', rendering: 'Rendering this tile' };

	$effect(() => {
		const m = map;
		if (!m) return;

		const busy = tiles.busy;
		// A plain Set: a local working set inside one run, never held in `$state`.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const seen = new Set<string>();

		for (const { key, center, state } of busy) {
			seen.add(key);
			let marker = markers.get(key);
			if (!marker) {
				marker = new Marker({ element: element() }).setLngLat(center).addTo(m);
				markers.set(key, marker);
			}
			// Re-read every pass: a tile that was queued starts rendering without moving, and the
			// marker is the only place that difference is visible on the map.
			const node = marker.getElement();
			node.dataset.state = state;
			node.title = TITLE[state];
		}

		for (const [key, marker] of markers) {
			if (seen.has(key)) continue;
			marker.remove();
			markers.delete(key);
		}
	});

	// Its own effect, so it tears down when the map goes rather than on every tile that arrives.
	$effect(() => {
		if (!map) return;
		return () => {
			for (const marker of markers.values()) marker.remove();
			markers.clear();
		};
	});
</script>

<style>
	/*
	 * The marker's elements are built in script, so they are outside this component's scope - hence
	 * `:global`. The class names are the contract between the two halves.
	 */
	:global(.tile-busy) {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		/* It reports; it is not a control. Clicks belong to the map underneath. */
		pointer-events: none;
	}

	:global(.tile-busy-ring) {
		width: 16px;
		height: 16px;
		border: 2px solid var(--map-pending);
		/* One quarter left open is what makes the rotation legible - a whole ring spinning looks
		   perfectly still. */
		border-top-color: transparent;
		border-radius: 50%;
		animation: -global-tile-busy-spin 900ms linear infinite;
	}

	/*
	 * Queued and rendering, told apart the way the shading used to: quieter and slower for the tile
	 * nothing has started on yet, so a screenful of them does not read as a screenful of work.
	 */
	:global(.tile-busy[data-state='queued'] .tile-busy-ring) {
		opacity: 0.45;
		animation-duration: 1800ms;
	}

	@keyframes -global-tile-busy-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/*
	 * Still a marker, still where the tile is - it just stops turning. A busy indicator that cannot
	 * animate should say "here" quietly rather than pulse, which is the same interruption by another
	 * route.
	 */
	@media (prefers-reduced-motion: reduce) {
		:global(.tile-busy-ring) {
			animation: none;
			border-top-color: var(--map-pending);
			opacity: 0.6;
		}
	}
</style>
