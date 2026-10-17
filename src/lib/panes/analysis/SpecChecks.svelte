<script lang="ts">
	import Note from '../../common/Note.svelte';
	import { count } from '../../common/format';
	import type { Checks } from '../../ipc/commands';

	// What is wrong with a source's tiles, and the button that fixes it (S14.8, B3).
	//
	// **Read in the same pass as the layers**, so there is no second button and no second wait: a
	// tile decoded to measure its layers has already been walked feature by feature.
	//
	// **The repair goes where the chain ends.** `vector_repair` after the last node mends whatever
	// everything before it produced, and it is an ordinary node - visible, switchable, removable -
	// rather than something done to the file behind the chain's back. Dropping features is a
	// different promise from mending them, so the button says which it will do.
	let {
		checks,
		sampled,
		endsInRepair,
		onInspect,
		onRepair
	}: {
		checks: Checks;
		/** Whether the tiles read were a sample - a clean sample is not a clean source. */
		sampled: boolean;
		/** Whether the chain already ends in `vector_repair`, so there is nothing to add. */
		endsInRepair: boolean;
		/** Opens the tile dialog on an example, with its feature picked. */
		onInspect: (z: number, x: number, y: number) => void;
		/** Appends `vector_repair`; `drop` asks it to drop what it cannot mend. */
		onRepair: (drop: boolean) => void;
	} = $props();

	const total = $derived(checks.issues.reduce((sum, check) => sum + check.count, 0));
	const drop = $derived(checks.issues.some((check) => check.fix === 'drop'));
</script>

{#if checks.tilejson}
	<Note tone="problem">TileJSON: {checks.tilejson}</Note>
{:else}
	<Note tone="aside">The TileJSON passes.</Note>
{/if}

{#if checks.issues.length === 0}
	<Note tone="empty">
		{sampled ? 'No violations of the vector tile spec in the tiles read.' : 'No violations of the vector tile spec.'}
	</Note>
{:else}
	<Note tone="problem">
		{count(total)} violations of the vector tile spec in {count(checks.tilesWithIssues)} tiles{sampled ? ' read' : ''}.
	</Note>
	<table class="figures" aria-label="Checks">
		<thead>
			<tr
				><th scope="col">Issue</th><th scope="col">Count</th><th scope="col">Tiles</th><th scope="col"
					><span class="visually-hidden">Example</span></th
				></tr
			>
		</thead>
		<tbody>
			{#each checks.issues as check (check.kind)}
				<tr>
					<th scope="row" title={check.kind}>
						{check.label}{#if check.fix === 'drop'}<span class="drop"> - dropped, not mended</span>{/if}
					</th>
					<td>{count(check.count)}</td>
					<td>{count(check.tiles)}</td>
					<td>
						<button
							type="button"
							class="link"
							aria-label="Inspect an example of: {check.label}"
							title="{check.example.z}/{check.example.x}/{check.example.y}, {check.example.layer}"
							onclick={() => onInspect(check.example.z, check.example.x, check.example.y)}>Inspect</button
						>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if endsInRepair}
		<Note>The chain already ends in vector_repair. Read again to see what it left.</Note>
	{:else}
		<button type="button" class="button primary repair" onclick={() => onRepair(drop)}>
			{drop ? 'Repair, dropping what cannot be mended' : 'Repair'}
		</button>
		<Note>Adds vector_repair{drop ? ' drop_offenders=true' : ''} at the end of the chain.</Note>
	{/if}
{/if}

<style>
	th {
		font-weight: normal;
	}

	.drop {
		color: var(--ink-2);
	}

	.repair {
		align-self: flex-start;
	}
</style>
