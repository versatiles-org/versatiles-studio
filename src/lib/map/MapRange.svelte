<script lang="ts">
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import { absence, type Absence, type Extent } from './data-range';
	import { requestedZoom } from './tile-grid';

	// Says so when the camera is where the data is not, with one click back to it (#16).
	//
	// An empty map is two different answers that look the same: the pipeline produced nothing, or
	// the data is at another zoom or somewhere else. Only the second has a way out, and this is it.
	// The rules are in `data-range.ts`; this feeds them the camera and draws the answer.

	let {
		map,
		mount,
		extent,
		onShow
	}: {
		map: MaplibreMap | undefined;
		/** The source on the map whose tiles are asked for, which decides the level - see `requestedZoom`. */
		mount: string | null;
		/** What the edited graph last built, or `null` with nothing built to look for. */
		extent: Extent | null;
		/** Frames the data, as "Reset view" does. */
		onShow: () => void;
	} = $props();

	let found = $state<Absence | null>(null);

	$effect(() => {
		const m = map;
		const wanted = extent;
		const name = mount;
		if (!m || !wanted) {
			found = null;
			return;
		}
		// From `moveend` rather than every frame, like `Views`: mid-gesture the answer is changing
		// anyway, and a notice flickering in and out under a drag says nothing.
		const check = () => {
			const spec = (name ? m.getSource(name) : undefined) as { type: string; tileSize?: number } | undefined;
			const bounds = m.getBounds();
			found = absence(
				requestedZoom(m.getZoom(), spec),
				[bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
				wanted
			);
		};
		check();
		m.on('moveend', check);
		return () => void m.off('moveend', check);
	});
</script>

{#if found}
	<div class="range" role="status" data-reason={found.reason}>
		<span>{found.message}</span>
		<button type="button" class="button" onclick={onShow}>Show the data</button>
	</div>
{/if}

<style>
	/* Bottom centre, on the surface the map's controls share, so it reads as the map talking. */
	.range {
		position: absolute;
		bottom: var(--space-5);
		left: 50%;
		transform: translateX(-50%);
		z-index: 6;
		/* A grid rather than a flex row, so a long message wraps and the button keeps its width. */
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: var(--space-3);
		max-width: calc(100% - 2 * var(--space-4));
		padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
		background: var(--float-bg);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		color: var(--ink);
		font-size: var(--text-sm);
	}
</style>
