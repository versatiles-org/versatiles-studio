<script lang="ts">
	import Field from '../../common/Field.svelte';
	import Note from '../../common/Note.svelte';
	import SortHeader from '../../common/SortHeader.svelte';
	import { sortRows, type Sort } from '../../common/sort';
	import { bytes, count } from '../../common/format';
	import type { Contents } from '../../ipc/commands';
	import { combine } from '../../state/contents.svelte';

	// What a source's vector tiles are made of, layer by layer (S14.7, B2).
	//
	// **A share, then a split.** The table answers "which layer costs the most"; the bar under each
	// name answers "on what" - geometry, the key and value tables, each feature's tag references, ids.
	// The bars share one scale, the heaviest layer's, so their lengths compare down the column the
	// way the numbers do.
	//
	// **One level or all of them.** A layer that is cheap over the whole pyramid can be most of a
	// tile at the level where it is drawn, and that is the level a budget is broken at.
	//
	// **Sortable**, as the tile dialog's layers are. Unsorted is heaviest first already; a sort by name
	// finds a layer, one by features finds the layers made of many small things.
	let { contents }: { contents: Contents } = $props();

	let level = $state<number | null>(null);
	let sort = $state<Sort | null>(null);

	const layers = $derived(combine(contents, level));
	const rows = $derived(
		sortRows(
			layers,
			sort,
			(layer, by) => ({ Layer: layer.name, Share: layer.bytes, Size: layer.bytes, Features: layer.features })[by]
		)
	);
	const total = $derived(layers.reduce((sum, layer) => sum + layer.bytes, 0));
	const heaviest = $derived(Math.max(0, ...layers.map((layer) => layer.bytes)));
	const read = $derived(
		level === null
			? { read: contents.read, tiles: contents.levels.reduce((sum, at) => sum + at.tiles, 0) }
			: (contents.levels.find((at) => at.level === level) ?? { read: 0, tiles: 0 })
	);

	const PARTS = [
		{ key: 'geometryBytes', label: 'geometry', token: '--bytes-geometry' },
		{ key: 'propertyBytes', label: 'keys and values', token: '--bytes-properties' },
		{ key: 'tagBytes', label: 'tags', token: '--bytes-tags' },
		{ key: 'idBytes', label: 'ids', token: '--bytes-ids' }
	] as const;

	const percent = (part: number, whole: number) => (whole === 0 ? 0 : (part / whole) * 100);
	const share = (part: number) => `${Math.round(percent(part, total))}%`;
</script>

<Field label="Zoom">
	<select
		value={level ?? ''}
		onchange={(event) => {
			const value = (event.currentTarget as HTMLSelectElement).value;
			level = value === '' ? null : Number(value);
		}}
	>
		<option value="">All levels</option>
		{#each contents.levels as at (at.level)}
			<option value={at.level}>{at.level}</option>
		{/each}
	</select>
</Field>

<Note tone="aside">
	{#if read.read < read.tiles}
		A sample: {count(read.read)} of {count(read.tiles)} tiles read.
	{:else}
		Every tile read: {count(read.read)}.
	{/if}
	{#if contents.undecodable > 0}
		{count(contents.undecodable)} would not decode as vector tiles.
	{/if}
</Note>

{#if layers.length === 0}
	<Note tone="empty">No layers here.</Note>
{:else}
	<table class="figures" aria-label="Layers">
		<thead>
			<tr>
				<SortHeader label="Layer" first="ascending" {sort} onSort={(next) => (sort = next)} />
				<SortHeader label="Share" {sort} onSort={(next) => (sort = next)} />
				<SortHeader label="Size" {sort} onSort={(next) => (sort = next)} />
				<SortHeader label="Features" {sort} onSort={(next) => (sort = next)} />
			</tr>
		</thead>
		<tbody>
			{#each rows as layer (layer.name)}
				<tr>
					<th scope="row">
						<span class="name">{layer.name}</span>
						<!-- Decorative: the numbers beside it say the same, and the legend below names the parts. -->
						<span class="bar" style="width: {percent(layer.bytes, heaviest)}%" aria-hidden="true">
							{#each PARTS as part (part.key)}
								<span style="width: {percent(layer[part.key], layer.bytes)}%; background: var({part.token})"></span>
							{/each}
						</span>
					</th>
					<td>{share(layer.bytes)}</td>
					<td>{bytes(layer.bytes)}</td>
					<td>{count(layer.features)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<ul class="legend" aria-label="What the bars split">
		{#each PARTS as part (part.key)}
			<li><span class="swatch" style="background: var({part.token})"></span>{part.label}</li>
		{/each}
	</ul>
{/if}

<style>
	.name {
		display: block;
		overflow-wrap: anywhere;
	}

	/* A track under the name: the layer's length on the heaviest layer's scale, cut into its parts.
	   What is left of the length after the four parts is framing, and shows as the track. */
	.bar {
		display: flex;
		height: 4px;
		margin-top: 2px;
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--rule);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-xs);
		color: var(--ink-2);
	}

	.swatch {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		margin-right: var(--space-1);
		border-radius: var(--radius);
	}
</style>
