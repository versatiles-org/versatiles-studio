<script lang="ts">
	import Note from '../common/Note.svelte';
	import { kilobytes } from '../common/format';
	import type { LevelSizes } from '../ipc/commands';

	// What the heat map's colours mean, and what it is drawing (S14.3).
	//
	// **The bands are the core's numbers**, handed back with the mount, so the legend and the pixels
	// cannot disagree about where 200 kB is.
	let {
		source,
		bands,
		detail,
		minZoom,
		zoom,
		figures = null,
		error = null
	}: {
		/** The source's name. */
		source: string | null;
		/** Where the colour changes, in bytes. Empty while nothing is drawn. */
		bands: number[];
		detail: number | null;
		/** The lowest map zoom it is drawn at. */
		minZoom: number | null;
		/** The map's zoom now, to say when it is too far out to draw anything. */
		zoom: number;
		/** The detail level's own figures, when the source has been measured. */
		figures?: LevelSizes | null;
		error?: string | null;
	} = $props();

	const labels = $derived(
		bands.length === 3
			? [
					`under ${kilobytes(bands[0])}`,
					`under ${kilobytes(bands[1])}`,
					`under ${kilobytes(bands[2])}`,
					`${kilobytes(bands[2])} and over`
				]
			: []
	);
</script>

<div class="legend popover" role="group" aria-label="Heat map legend">
	{#if error}
		<Note tone="problem">{error}</Note>
	{:else if detail !== null}
		<p class="what">
			{#if source}<strong>{source}</strong>,{/if} each square a tile of zoom {detail}
		</p>
		<ul>
			{#each labels as label, index (label)}
				<li><span class="swatch" style="background: var(--map-heat-{index + 1})"></span>{label}</li>
			{/each}
		</ul>
		{#if figures}
			<dl class="facts">
				<dt>Median</dt>
				<dd>{kilobytes(figures.p50)}</dd>
				<dt>95%</dt>
				<dd>{kilobytes(figures.p95)}</dd>
				<dt>Largest</dt>
				<dd>{kilobytes(figures.max)}</dd>
			</dl>
		{/if}
		{#if minZoom !== null && zoom < minZoom}
			<Note>Zoom in to {minZoom} or closer to see the squares.</Note>
		{/if}
	{:else}
		<Note live>Drawing…</Note>
	{/if}
</div>

<style>
	.legend {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: 13rem;
		padding: var(--space-3);
		font-size: var(--text-xs);
	}

	.what {
		margin: 0;
		color: var(--ink-2);
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	/* The colour at the opacity it is drawn at, so the swatch and the square look alike. */
	.swatch {
		width: 0.9em;
		height: 0.9em;
		border-radius: var(--radius);
		opacity: 0.75;
	}
</style>
