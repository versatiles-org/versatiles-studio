<script lang="ts">
	import { untrack } from 'svelte';
	import type { Map as MaplibreMap, MapMouseEvent } from 'maplibre-gl';
	import { tileForLngLat } from './tile-grid';
	import { kilobytes } from '../common/format';
	import { tileBytes, type HeatMount } from '../ipc/commands';
	import { squareLevel } from '../state/heat.svelte';

	// The heat map on the map (S14.3, B1, [Q72]): a raster the core draws, a pixel per tile six
	// levels below each heat tile, and what the tile under the pointer weighs.
	//
	// **Squares stay squares.** Nearest resampling, or MapLibre blurs four pixels of four different
	// tiles into one smear that is no tile at all. And no fade: the heat map is a measurement, and a
	// measurement that eases in reads as one that is still arriving.
	//
	// **Its own source and layer, re-added when the style is rebuilt** - a restyle replaces every
	// layer the style does not name, and this is not in the style. On top of the data, at an opacity
	// the reader sets, and with the data's own layers hidden when they ask for the heat map alone:
	// a red road under a red square is two readings of one colour. The basemap stays, so there is
	// still a place to recognise.
	let {
		map,
		mount,
		graph,
		deepest,
		opacity = 0.75,
		only = false,
		layers = [],
		onPick
	}: {
		map: MaplibreMap | undefined;
		/** Where the tiles are; `null` while there is nothing to draw. */
		mount: HeatMount | null;
		/** The source being drawn, to ask its sizes. */
		graph: number | null;
		/** The deepest level a square stands for. */
		deepest: number | null;
		/** How opaque the squares are, 0 to 1. */
		opacity?: number;
		/** Hide `layers`, so only the squares and the basemap show. */
		only?: boolean;
		/** The ids of the layers the source draws - the composed stack's, not its own style's. */
		layers?: string[];
		/** A square was clicked: the tile it stands for. */
		onPick?: (z: number, x: number, y: number) => void;
	} = $props();

	const SOURCE = 'studio:heat';
	const LAYER = 'studio:heat:squares';

	/** What the pointer is over, once it has paused there. */
	let hovered = $state<{ x: number; y: number; label: string; bytes: number | null | undefined } | null>(null);

	$effect(() => {
		if (!map || !mount) return;
		const m = map;
		const { tileUrl, deepest } = mount;

		const ensure = () => {
			try {
				if (!m.getSource(SOURCE)) {
					m.addSource(SOURCE, { type: 'raster', tiles: [tileUrl], tileSize: 512, minzoom: 0, maxzoom: deepest });
				}
				if (!m.getLayer(LAYER)) {
					m.addLayer({
						id: LAYER,
						type: 'raster',
						source: SOURCE,
						paint: {
							'raster-resampling': 'nearest',
							'raster-opacity': untrack(() => opacity),
							'raster-fade-duration': 0
						}
					});
				}
			} catch {
				// Mid-restyle: the next `styledata` puts it back.
			}
		};
		ensure();
		m.on('styledata', ensure);

		return () => {
			m.off('styledata', ensure);
			if (m.getLayer(LAYER)) m.removeLayer(LAYER);
			if (m.getSource(SOURCE)) m.removeSource(SOURCE);
		};
	});

	// The opacity on its own: setting it must not take the layer down and draw every tile again.
	$effect(() => {
		const value = opacity;
		if (!map || !mount) return;
		if (map.getLayer(LAYER)) map.setPaintProperty(LAYER, 'raster-opacity', value);
	});

	// The heat map alone: the source's layers hidden, and only those this hid put back - a layer the
	// reader hid in the Layers pane stays hidden. A restyle draws them again, so it is done again on
	// each.
	$effect(() => {
		if (!map || !mount || !only || layers.length === 0) return;
		const m = map;
		const ids = layers;
		const hidden: string[] = [];

		const hide = () => {
			for (const id of ids) {
				if (!m.getLayer(id) || m.getLayoutProperty(id, 'visibility') === 'none') continue;
				if (!hidden.includes(id)) hidden.push(id);
				m.setLayoutProperty(id, 'visibility', 'none');
			}
		};
		hide();
		m.on('styledata', hide);

		return () => {
			m.off('styledata', hide);
			for (const id of hidden) {
				if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'visible');
			}
		};
	});

	// The size under the pointer, asked once it pauses: every move would be a question per pixel. The
	// tile is the one the square under it stands for, so it changes with the zoom as the squares do.
	$effect(() => {
		if (!map || !mount || graph === null || deepest === null) {
			hovered = null;
			return;
		}
		const m = map;
		const bottom = deepest;
		const source = graph;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let asked = 0;

		const under = (event: MapMouseEvent) => {
			const level = squareLevel(m.getZoom(), bottom);
			return { level, ...tileForLngLat(event.lngLat.lng, event.lngLat.lat, level) };
		};
		const onMove = (event: MapMouseEvent) => {
			clearTimeout(timer);
			const { level, x, y } = under(event);
			const label = `${level}/${x}/${y}`;
			if (hovered?.label !== label) hovered = { x: event.point.x, y: event.point.y, label, bytes: undefined };
			else hovered = { ...hovered, x: event.point.x, y: event.point.y };
			timer = setTimeout(() => {
				const ticket = ++asked;
				void tileBytes(source, level, x, y)
					.then((bytes) => {
						if (ticket === asked && hovered?.label === label) hovered = { ...hovered, bytes };
					})
					.catch(() => {});
			}, 150);
		};
		const onLeave = () => {
			clearTimeout(timer);
			hovered = null;
		};
		const onClick = (event: MapMouseEvent) => {
			const { level, x, y } = under(event);
			onPick?.(level, x, y);
		};

		m.on('mousemove', onMove);
		m.on('mouseout', onLeave);
		m.on('click', onClick);
		return () => {
			clearTimeout(timer);
			m.off('mousemove', onMove);
			m.off('mouseout', onLeave);
			m.off('click', onClick);
			hovered = null;
		};
	});
</script>

{#if hovered && mount}
	<!-- Beside the pointer rather than under it, so it never covers the square it is about. -->
	<div class="readout popover" style="left: {hovered.x + 14}px; top: {hovered.y + 14}px" role="status">
		<span class="tile">{hovered.label}</span>
		{#if hovered.bytes === undefined}
			<span class="size">…</span>
		{:else if hovered.bytes === null}
			<span class="size">no tile</span>
		{:else}
			<span class="size">{kilobytes(hovered.bytes)}</span>
		{/if}
	</div>
{/if}

<style>
	.readout {
		position: absolute;
		z-index: 2;
		display: flex;
		gap: var(--space-3);
		padding: var(--space-1) var(--space-3);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		pointer-events: none;
		white-space: nowrap;
	}

	.tile {
		font-family: var(--font-mono);
		color: var(--ink-2);
	}
</style>
