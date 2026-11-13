<script lang="ts">
	import { untrack } from 'svelte';
	import { Marker, type Map as MaplibreMap, type MapSourceDataEvent } from 'maplibre-gl';
	import type { FeatureCollection } from 'geojson';
	import { tiles } from '../state/tiles.svelte';
	import { coveringLevels, tileRing, type CoveringSource } from './tile-grid';
	import { SCHEME } from './tile-queue';
	import { mapOverlay, type Overlay } from './overlay';
	import { token } from '../styles/tokens';
	import { role } from './theme';

	// Which tiles the map is still waiting for, and which it gave up on (S2.16, C3).
	//
	// The status bar says how many; this says which. On a slow pipeline the two answer different
	// questions - "is anything happening" and "is it the tile I am looking at" - and the second is
	// the one that tells you whether panning somewhere else would help.
	//
	// **Drawn from the queue, not from MapLibre.** Studio fetches these tiles itself, so it knows a
	// tile's coordinate and its state at the same time; MapLibre reports both halves as "loading"
	// (see `tile-queue.ts`).
	//
	// **Only the tiles of the level being drawn.** A request from the zoom before is still in the
	// queue until MapLibre lets it go, and a spinner for it would sit at the middle of a square four
	// times the size of the ones on screen, saying the map waits for something it will not draw.
	//
	// **Waiting is a spinner at the middle; giving up is an edge around the square.** A wash over a
	// waiting tile hid the previous tile underneath, which is usually still perfectly readable while
	// its replacement is on the way - so waiting covers almost nothing. A failed tile is the opposite
	// case: nothing is coming, and what matters is *which area* is missing, which a dot at its middle
	// does not say. A red line just inside its edge does, and leaves the square itself clear.
	//
	// The spinners are markers, which are not part of the style, so a restyle leaves them alone. The
	// edges are a layer, kept on the map by `mapOverlay` ([Q46]).

	let { map }: { map: MaplibreMap | undefined } = $props();

	const SOURCE = 'studio:failed-tiles';

	/// One marker per tile coordinate, so a redraw while the same tiles are still waiting leaves
	/// them where they are - taking them down and putting them back would restart every spinner
	/// mid-turn, which reads as a stutter rather than as progress.
	///
	/// A plain `Map`: this is bookkeeping about the map's own DOM, never read reactively, so a
	/// reactive one would track changes nothing subscribes to.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const markers = new Map<string, Marker>();

	/// The zoom levels the map draws Studio's tiles at right now. Nothing until the map says.
	let levels = $state<number[]>([]);

	/// The tiles worth marking: those of a level the map is drawing.
	const shown = $derived(tiles.busy.filter((tile) => levels.includes(tile.coord.z)));

	/// The edges, as lines rather than polygons: a line is drawn in the order it is written, so an
	/// offset to its right is always inside the square - a polygon's ring could be rewound.
	const edges = $derived<FeatureCollection>({
		type: 'FeatureCollection',
		features: shown
			.filter((tile) => tile.state === 'failed')
			.map(({ coord }) => ({
				type: 'Feature',
				properties: {},
				geometry: { type: 'LineString', coordinates: tileRing(coord.x, coord.y, coord.z)[0] }
			}))
	});

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

	const TITLE = {
		queued: 'Waiting for a slot',
		rendering: 'Rendering this tile'
	};

	// Which levels are drawn follows the zoom and the sources. The sources are read when the style
	// or a source changes, not on every frame of a zoom: `getStyle` copies the whole style.
	$effect(() => {
		const m = map;
		if (!m) return;

		let sources: CoveringSource[] = [];
		const readSources = () => {
			try {
				sources = Object.values(m.getStyle()?.sources ?? {}).filter(
					(source) => 'tiles' in source && !!source.tiles?.[0]?.startsWith(`${SCHEME}://`)
				);
			} catch {
				// No style yet; the next `styledata` brings us round.
				sources = [];
			}
		};
		const update = () => {
			const next = coveringLevels(m.getZoom(), sources);
			// Assigned only when it differs, so a zoom within a level re-runs nothing.
			if (next.join() !== untrack(() => levels).join()) levels = next;
		};
		const restyled = () => {
			readSources();
			update();
		};
		// A source being added or replaced says so as `metadata`; the rest are tiles arriving.
		const sourced = (event: MapSourceDataEvent) => {
			if (event.sourceDataType === 'metadata') restyled();
		};

		m.on('styledata', restyled);
		m.on('sourcedata', sourced);
		m.on('zoom', update);
		restyled();
		return () => {
			m.off('styledata', restyled);
			m.off('sourcedata', sourced);
			m.off('zoom', update);
		};
	});

	$effect(() => {
		const m = map;
		if (!m) return;

		// A plain Set: a local working set inside one run, never held in `$state`.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const seen = new Set<string>();

		for (const { key, center, state } of shown) {
			if (state === 'failed') continue;
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

	/// Held so a change in which tiles failed redraws rather than rebuilding the layer.
	let overlay = $state<Overlay | null>(null);

	$effect(() => {
		const m = map;
		if (!m) return;
		const mounted = mapOverlay(m, {
			source: SOURCE,
			label: 'failed tiles',
			layers: () => [
				{
					id: `${SOURCE}:edge`,
					type: 'line',
					source: SOURCE,
					metadata: role('failed-edge'),
					// Square caps close the corner where the line starts and ends.
					layout: { 'line-cap': 'square', 'line-join': 'miter' },
					// Offset by half its width, so the whole line falls inside the square and two
					// failed neighbours show two edges rather than one line shared between them.
					paint: { 'line-color': token('--map-failed'), 'line-width': 2, 'line-offset': 1 }
				}
			],
			// `untrack`, because this is read from map events as well as from the effect below.
			data: () => untrack(() => edges)
		});
		overlay = mounted;
		return () => {
			mounted.dispose();
			overlay = null;
		};
	});

	$effect(() => {
		void edges;
		overlay?.draw();
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
		/* By its plain name: `-global-` belongs only on the `@keyframes` below, which Svelte strips
		   it from. Written here as well, the name matched nothing and the ring stood still. */
		animation: tile-busy-spin 900ms linear infinite;
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
