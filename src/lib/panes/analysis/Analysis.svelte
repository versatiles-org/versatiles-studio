<script lang="ts">
	import Group from '../../common/Group.svelte';
	import Note from '../../common/Note.svelte';
	import { bytes, count, kilobytes } from '../../common/format';
	import type { Measurement } from '../../state/analysis.svelte';

	// What the selected source weighs (S14.2, B1, [Q72]).
	//
	// **The right pane says what things turn out to be**, and the Inspector says what the tiles are;
	// this says what they cost. A pane of its own rather than a part of the Inspector, which keeps
	// "nothing else" - and because this one is opt-in: nothing is measured until somebody asks, since
	// a walk over a planet is not something to start because a pane was unfolded.
	//
	// **Four columns at most.** The pane is about 300 px wide, and a fifth column is where a table
	// starts wrapping its numbers.
	let {
		graph,
		measurement,
		stale = false,
		onMeasure,
		onShowTile
	}: {
		/** The selected source's name, or `null` when none is selected. */
		graph: string | null;
		measurement: Measurement;
		/** Whether the figures were measured against a build the map no longer draws. */
		stale?: boolean;
		onMeasure: () => void;
		/** Frames a tile on the map. */
		onShowTile: (z: number, x: number, y: number) => void;
	} = $props();

	/** The budget a vector tile is usually held to - and the line a row is marked for crossing. */
	const BUDGET = 500_000;

	const sizes = $derived(measurement.sizes);
</script>

{#snippet measure()}
	<button type="button" class="quiet" disabled={measurement.running} onclick={onMeasure}>
		{sizes ? 'Measure again' : 'Measure'}
	</button>
{/snippet}

<div class="pane-body">
	{#if !graph}
		<Note tone="empty">No source selected.</Note>
	{:else}
		<Group title="Tile sizes" action={measure}>
			{#if measurement.running}
				<Note live>Reading every tile's size…</Note>
			{/if}
			{#if measurement.error}
				<Note tone="problem">{measurement.error}</Note>
			{/if}
			{#if sizes}
				{#if stale}
					<Note tone="aside">Measured before the last change to this source.</Note>
				{/if}
				<!-- Sizes as stored - compressed, where the container compresses - because that is what
				     crosses the wire, and what a tile budget is about. -->
				<dl class="facts">
					<dt>Tiles</dt>
					<dd>{count(sizes.tiles)}</dd>
					<dt>Total</dt>
					<dd>{bytes(sizes.bytes)}</dd>
					<dt>Median</dt>
					<dd>{kilobytes(sizes.p50)}</dd>
					<dt>95%</dt>
					<dd>{kilobytes(sizes.p95)}</dd>
					<dt>Largest</dt>
					<dd>{kilobytes(sizes.max)}</dd>
				</dl>

				<table class="figures" aria-label="Sizes per zoom level">
					<thead>
						<tr><th scope="col">Zoom</th><th scope="col">Tiles</th><th scope="col">Mean</th><th scope="col">Max</th></tr
						>
					</thead>
					<tbody>
						{#each sizes.levels as level (level.level)}
							<tr>
								<th scope="row">{level.level}</th>
								<td>{count(level.tiles)}</td>
								<td>{kilobytes(level.tiles === 0 ? 0 : level.bytes / level.tiles)}</td>
								<!-- Marked rather than coloured whole: the row is fine, one tile in it is not. -->
								<td class:over={level.max > BUDGET} title={level.max > BUDGET ? 'over 500 kB' : undefined}
									>{kilobytes(level.max)}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else if !measurement.running && !measurement.error}
				<Note>Measure reads every tile's size from the container's index - seconds, not minutes.</Note>
			{/if}
		</Group>

		{#if sizes && sizes.biggest.length > 0}
			<Group title="Biggest tiles">
				<table class="figures" aria-label="Biggest tiles">
					<thead>
						<tr><th scope="col">Tile</th><th scope="col">Size</th></tr>
					</thead>
					<tbody>
						{#each sizes.biggest as tile (`${tile.z}/${tile.x}/${tile.y}`)}
							<tr>
								<th scope="row">
									<button
										type="button"
										class="link"
										title="Show this tile on the map"
										onclick={() => onShowTile(tile.z, tile.x, tile.y)}>{tile.z}/{tile.x}/{tile.y}</button
									>
								</th>
								<td class:over={tile.bytes > BUDGET}>{kilobytes(tile.bytes)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</Group>
		{/if}
	{/if}
</div>

<style>
	/* What this pane decides for itself: which figure is over the budget. */
	.over {
		color: var(--error);
	}

	/* A row's name is a label, in the label's weight. */
	tbody th {
		font-weight: normal;
	}
</style>
