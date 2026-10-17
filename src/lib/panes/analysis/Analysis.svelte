<script lang="ts">
	import Group from '../../common/Group.svelte';
	import Note from '../../common/Note.svelte';
	import { bytes, count, kilobytes } from '../../common/format';
	import LayerShares from './LayerShares.svelte';
	import type { Measurement } from '../../state/analysis.svelte';
	import type { Scan } from '../../state/contents.svelte';

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
		onShowTile,
		onInspectTile,
		heatOn = false,
		onToggleHeat,
		scan,
		scanStale = false,
		onScan
	}: {
		/** The selected source's name, or `null` when none is selected. */
		graph: string | null;
		measurement: Measurement;
		/** Whether the figures were measured against a build the map no longer draws. */
		stale?: boolean;
		onMeasure: () => void;
		/** Frames a tile on the map. */
		onShowTile: (z: number, x: number, y: number) => void;
		/** Opens the tile dialog on a tile (S14.5). */
		onInspectTile: (z: number, x: number, y: number) => void;
		/** Whether the heat map is on - the same switch as the one on the map (S14.3). */
		heatOn?: boolean;
		onToggleHeat?: () => void;
		/** What the source's layers hold, as far as they have been read (S14.7). */
		scan: Scan;
		/** Whether they were read from a build the map no longer draws. */
		scanStale?: boolean;
		/** Reads the layers - a sample, unless `full`. */
		onScan: (full: boolean) => void;
	} = $props();

	/** The budget a vector tile is usually held to - and the line a row is marked for crossing. */
	const BUDGET = 500_000;

	const sizes = $derived(measurement.sizes);
</script>

{#snippet read()}
	<button type="button" class="quiet" disabled={scan.running} onclick={() => onScan(false)}>
		{scan.contents ? 'Read again' : 'Read layers'}
	</button>
{/snippet}

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
			{#if onToggleHeat}
				<!-- Here as well as on the map: this is where the question is asked, and the map is where
				     the answer is drawn. -->
				<button type="button" class="link alone" aria-pressed={heatOn} onclick={onToggleHeat}>
					{heatOn ? 'Hide the heat map' : 'Show the heat map'}
				</button>
			{/if}
		</Group>

		{#if sizes && sizes.biggest.length > 0}
			<Group title="Biggest tiles">
				<table class="figures" aria-label="Biggest tiles">
					<thead>
						<tr
							><th scope="col">Tile</th><th scope="col">Size</th><th scope="col"
								><span class="visually-hidden">Inspect</span></th
							></tr
						>
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
								<td>
									<button
										type="button"
										class="link"
										aria-label="Inspect {tile.z}/{tile.x}/{tile.y}"
										onclick={() => onInspectTile(tile.z, tile.x, tile.y)}>Inspect</button
									>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</Group>
		{/if}

		<Group title="Layers" action={read}>
			{#if scan.running}
				<Note live>Decoding tiles…</Note>
			{/if}
			{#if scan.error}
				<Note tone="problem">{scan.error}</Note>
			{/if}
			{#if scan.contents}
				{#if scanStale}
					<Note tone="aside">Read before the last change to this source.</Note>
				{/if}
				<LayerShares contents={scan.contents} />
				{#if scan.contents.sampled && !scan.running}
					<button type="button" class="link alone" onclick={() => onScan(true)}>Read every tile</button>
				{/if}
			{:else if !scan.running && !scan.error}
				<Note>Read layers decodes a sample of the tiles the map draws, and splits each layer's bytes.</Note>
			{/if}
		</Group>
	{/if}
</div>

<style>
	/* What this pane decides for itself: which figure is over the budget. */
	.over {
		color: var(--error);
	}

	/* A link on a line of its own, not stretched across the pane by the group's column. */
	.alone {
		align-self: flex-start;
	}
</style>
