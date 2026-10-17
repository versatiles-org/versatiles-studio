<script lang="ts">
	import Field from '../common/Field.svelte';
	import Note from '../common/Note.svelte';
	import { kilobytes } from '../common/format';
	import type { LevelSizes } from '../ipc/commands';
	import { squareLevel } from '../state/heat.svelte';

	// What the heat map's colours mean, what it is drawing, and how it sits over the map (S14.3).
	//
	// **The ramp runs from nought to the maximum**, and the maximum is a field: the same 30 kB tile is
	// dark against a vector tile's 500 kB budget and bright against a landcover layer's own 50 kB.
	// It is committed on change rather than on each keystroke, since each value redraws every square.
	//
	// **The level a square stands for moves with the zoom**, so the sentence that names it does too.
	let {
		source,
		deepest,
		zoom,
		max,
		opacity,
		only,
		figures = null,
		error = null,
		onMax = () => {},
		onOpacity = () => {},
		onOnly = () => {}
	}: {
		/** The source's name. */
		source: string | null;
		/** The deepest level a square stands for; `null` while nothing is drawn. */
		deepest: number | null;
		/** The map's zoom now, which picks the level a square is. */
		zoom: number;
		/** The size at the white end, in bytes. */
		max: number;
		/** How opaque the squares are, 0 to 1. */
		opacity: number;
		/** Whether the source's own layers are hidden. */
		only: boolean;
		/** The figures of the level a square is now, when the source has been measured. */
		figures?: LevelSizes | null;
		error?: string | null;
		onMax?: (bytes: number) => void;
		onOpacity?: (opacity: number) => void;
		onOnly?: (only: boolean) => void;
	} = $props();

	const level = $derived(deepest === null ? null : squareLevel(zoom, deepest));
</script>

<div class="legend popover" role="group" aria-label="Heat map legend">
	{#if error}
		<Note tone="problem">{error}</Note>
	{:else if level !== null}
		<p class="what">
			{#if source}<strong>{source}</strong>,{/if} each square a tile of zoom {level}
		</p>
		<div class="ramp" aria-hidden="true"></div>
		<div class="ends">
			<span>0</span>
			<span>{kilobytes(max)} and over</span>
		</div>
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
		{#snippet unit()}kB{/snippet}
		<Field label="Maximum" trail={unit}>
			<input
				type="number"
				min="1"
				step="10"
				value={Math.round(max / 1000)}
				onchange={(event) => {
					const kb = Number(event.currentTarget.value);
					if (kb > 0) onMax(kb * 1000);
					else event.currentTarget.value = String(Math.round(max / 1000));
				}}
			/>
		</Field>
		{#snippet percent()}{Math.round(opacity * 100)}%{/snippet}
		<Field label="Opacity" trail={percent}>
			<input
				type="range"
				min="0"
				max="100"
				step="5"
				value={Math.round(opacity * 100)}
				oninput={(event) => onOpacity(Number(event.currentTarget.value) / 100)}
			/>
		</Field>
		<label class="only">
			<input type="checkbox" checked={only} onchange={(event) => onOnly(event.currentTarget.checked)} />
			Heat map only
		</label>
	{:else}
		<Note live>Drawing…</Note>
	{/if}
</div>

<style>
	.legend {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: 15rem;
		padding: var(--space-3);
		font-size: var(--text-xs);
	}

	.what {
		margin: 0;
		color: var(--ink-2);
	}

	/* The ramp the core draws with, from the same tokens it was handed. */
	.ramp {
		height: 0.7rem;
		border-radius: var(--radius);
		background: linear-gradient(
			to right,
			var(--map-heat-1),
			var(--map-heat-2),
			var(--map-heat-3),
			var(--map-heat-4),
			var(--map-heat-5)
		);
	}

	.ends {
		display: flex;
		justify-content: space-between;
		margin-top: calc(-1 * var(--space-1));
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.only {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
</style>
