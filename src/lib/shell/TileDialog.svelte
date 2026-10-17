<script lang="ts">
	import Modal from '../common/Modal.svelte';
	import Icon from '../common/Icon.svelte';
	import Tabs from '../common/Tabs.svelte';
	import Note from '../common/Note.svelte';
	import Field from '../common/Field.svelte';
	import JsonTree from '../common/JsonTree.svelte';
	import TileDrawing from './TileDrawing.svelte';
	import { bytes, kilobytes, count } from '../common/format';
	import type { Dissection } from '../ipc/commands';
	import { children, neighbour, parent, parseAddress, type TileAt } from '../state/tile-dialog.svelte';

	// One tile, taken apart (S14.5, A4, [Q72]).
	//
	// **The tile beside its numbers.** The drawing on the left is what the map would hide; the tabs
	// on the right are what the bytes are spent on. A row picked in a tab is the feature outlined in
	// the drawing, and a feature clicked in the drawing is the row - one selection, two views of it.
	//
	// **Moving without closing.** Parent, children and neighbours are a click each, and the address
	// takes one typed; the selection is about one tile and goes with it.
	//
	// Every way in - Inspect in the Analysis pane, a heat-map square, the native menu - opens this
	// with a source and a tile, and the dialog does the rest.

	let {
		at,
		dissection,
		error,
		loading,
		onGo,
		onShowOnMap,
		onClose
	}: {
		at: TileAt;
		dissection: Dissection | null;
		error: string | null;
		loading: boolean;
		onGo: (z: number, x: number, y: number) => void;
		onShowOnMap: () => void;
		onClose: () => void;
	} = $props();

	/** The most rows a feature list renders: a table of five thousand is not something to read. */
	const ROWS = 300;
	/** The size a tile is held to, as in the Analysis pane. */
	const BUDGET = 500_000;

	let tab = $state('layers');
	let focus = $state<number | null>(null);
	let selected = $state<{ layer: number; index: number } | null>(null);
	let showVertices = $state(false);
	let address = $state('');

	// A new tile is a new subject: what was picked in the last one names nothing in this one.
	$effect(() => {
		address = `${at.z}/${at.x}/${at.y}`;
		focus = null;
		selected = null;
	});

	const typed = $derived(parseAddress(address));
	const up = $derived(parent(at.z, at.x, at.y));
	const down = $derived(children(at.z, at.x, at.y));
	const beside = (dx: number, dy: number) => neighbour(at.z, at.x, at.y, dx, dy);

	const vector = $derived(dissection !== null && dissection.layers.length > 0);
	const extent = $derived(dissection?.layers[focus ?? 0]?.extent ?? 4096);
	const listed = $derived((dissection?.features ?? []).filter((feature) => focus === null || feature.layer === focus));
	const picked = $derived(
		selected ? dissection?.features.find((f) => f.layer === selected?.layer && f.index === selected.index) : undefined
	);
	const attributesOf = $derived(dissection?.layers[focus ?? 0] ?? null);

	const layerName = (index: number) => dissection?.layers[index]?.name ?? '?';
	const layerIndex = (name: string) => dissection?.layers.findIndex((layer) => layer.name === name) ?? -1;

	function select(layer: number, index: number) {
		selected = { layer, index };
		tab = 'features';
	}

	function go(target: { z: number; x: number; y: number } | null) {
		if (target) onGo(target.z, target.x, target.y);
	}

	const tabs = $derived([
		{ id: 'layers', label: 'Layers' },
		{ id: 'attributes', label: 'Attributes' },
		{ id: 'features', label: 'Features' },
		{
			id: 'issues',
			label: 'Issues',
			badge: { count: dissection?.issues.length ?? 0, label: `${dissection?.issues.length ?? 0} issues` }
		}
	]);
</script>

<Modal title="Tile {at.z}/{at.x}/{at.y}" width="64rem" {onClose}>
	<div class="moves" role="group" aria-label="Move to another tile">
		<form
			class="address"
			onsubmit={(event) => {
				event.preventDefault();
				go(typed);
			}}
		>
			<Field label="Tile">
				<input type="text" bind:value={address} aria-invalid={typed === null} spellcheck="false" />
			</Field>
			<button type="submit" class="button" disabled={typed === null}>Go</button>
		</form>
		<button type="button" class="button" disabled={!up} onclick={() => go(up)}>Parent</button>
		<div class="quads" role="group" aria-label="Children">
			{#each down as child, i (i)}
				<button
					type="button"
					class="button"
					aria-label="Child {['north-west', 'north-east', 'south-west', 'south-east'][i]}"
					title="{child.z}/{child.x}/{child.y}"
					onclick={() => go(child)}>{['NW', 'NE', 'SW', 'SE'][i]}</button
				>
			{/each}
		</div>
		<div class="compass" role="group" aria-label="Neighbours">
			{#each [{ label: 'West', icon: 'left', dx: -1, dy: 0 }, { label: 'North', icon: 'up', dx: 0, dy: -1 }, { label: 'South', icon: 'down', dx: 0, dy: 1 }, { label: 'East', icon: 'right', dx: 1, dy: 0 }] as const as move (move.label)}
				{@const target = beside(move.dx, move.dy)}
				<button
					type="button"
					class="icon"
					aria-label={move.label}
					title={target ? `${move.label}: ${target.z}/${target.x}/${target.y}` : move.label}
					disabled={!target}
					onclick={() => go(target)}><Icon name={move.icon} /></button
				>
			{/each}
		</div>
	</div>

	{#if error}
		<Note tone="problem">{error}</Note>
	{:else if loading && !dissection}
		<Note tone="empty" live>Taking the tile apart…</Note>
	{:else if !dissection}
		<Note tone="empty">This source has no tile at {at.z}/{at.x}/{at.y}.</Note>
	{:else}
		<dl class="facts sizes">
			<dt>Format</dt>
			<dd>{dissection.format}, {dissection.compression}</dd>
			<dt>Stored</dt>
			<dd class:over={dissection.storedBytes > BUDGET}>{kilobytes(dissection.storedBytes)}</dd>
			<dt>Decompressed</dt>
			<dd>{kilobytes(dissection.rawBytes)}</dd>
		</dl>

		{#if !vector}
			<Note tone="aside">A raster tile has nothing to take apart beyond its size.</Note>
		{:else}
			{#if dissection.truncated}
				<Note tone="aside">
					This tile has more than {count(5000)} features or {count(200000)} vertices, so only the first {count(
						dissection.features.length
					)} are drawn and listed. The Layers and Attributes tabs count all of them.
				</Note>
			{/if}
			<div class="split">
				<figure>
					<TileDrawing
						features={dissection.features}
						{extent}
						{selected}
						{focus}
						vertices={showVertices}
						onSelect={select}
					/>
					<figcaption>
						<label><input type="checkbox" bind:checked={showVertices} /> Vertices</label>
						<span>Dashed: the tile's edge and a hole. Red: a ring that encloses nothing.</span>
					</figcaption>
				</figure>

				<div class="contents">
					<Tabs items={tabs} selected={tab} onSelect={(id) => (tab = id)} label="What the tile holds" />

					{#if tab === 'layers'}
						<table class="figures" aria-label="Layers">
							<thead>
								<tr
									><th scope="col">Layer</th><th scope="col">Features</th><th scope="col">Vertices</th><th scope="col"
										>Size</th
									></tr
								>
							</thead>
							<tbody>
								{#each dissection.layers as layer, i (layer.name)}
									<tr class:focused={focus === i}>
										<th scope="row">
											<button
												type="button"
												class="link"
												aria-pressed={focus === i}
												onclick={() => (focus = focus === i ? null : i)}>{layer.name}</button
											>
										</th>
										<td>{count(layer.features)}</td>
										<td>{count(layer.vertices)}</td>
										<td>{kilobytes(layer.bytes)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
						{#if focus !== null && dissection.layers[focus]}
							{@const layer = dissection.layers[focus]}
							<dl class="facts" aria-label="Where {layer.name}'s bytes go">
								<dt>Geometry</dt>
								<dd>{kilobytes(layer.geometryBytes)}</dd>
								<dt>Tags</dt>
								<dd>{kilobytes(layer.tagBytes)}</dd>
								<dt>Keys</dt>
								<dd>{kilobytes(layer.keyBytes)}</dd>
								<dt>Values</dt>
								<dd>{kilobytes(layer.valueBytes)}</dd>
								<dt>Ids</dt>
								<dd>{kilobytes(layer.idBytes)}</dd>
								<dt>Other</dt>
								<dd>{kilobytes(layer.otherBytes)}</dd>
								<dt>Extent</dt>
								<dd>{layer.extent ?? 'missing'}</dd>
								<dt>Version</dt>
								<dd>{layer.version ?? 'missing'}</dd>
							</dl>
						{:else}
							<Note>Pick a layer to see where its bytes go, and to draw it alone.</Note>
						{/if}
					{:else if tab === 'attributes'}
						<Field label="Layer">
							<select
								value={focus ?? 0}
								onchange={(event) => (focus = Number((event.currentTarget as HTMLSelectElement).value))}
							>
								{#each dissection.layers as layer, i (layer.name)}
									<option value={i}>{layer.name}</option>
								{/each}
							</select>
						</Field>
						{#if attributesOf && attributesOf.attributes.length > 0}
							<table class="figures" aria-label="Attributes">
								<thead>
									<tr
										><th scope="col">Key</th><th scope="col">Features</th><th scope="col">Distinct</th><th scope="col"
											>Size</th
										></tr
									>
								</thead>
								<tbody>
									{#each attributesOf.attributes as attribute (attribute.key)}
										<tr>
											<th scope="row">{attribute.key}</th>
											<td>{count(attribute.features)}</td>
											<td>{count(attribute.distinct)}</td>
											<td>{bytes(attribute.bytes)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{:else}
							<Note tone="empty">This layer's features carry no properties.</Note>
						{/if}
					{:else if tab === 'features'}
						<table class="figures" aria-label="Features">
							<thead>
								<tr
									><th scope="col">Feature</th><th scope="col">Type</th><th scope="col">Vertices</th><th scope="col"
										>Size</th
									></tr
								>
							</thead>
							<tbody>
								{#each listed.slice(0, ROWS) as feature (`${feature.layer}/${feature.index}`)}
									<tr>
										<th scope="row">
											<button
												type="button"
												class="link"
												aria-pressed={selected?.layer === feature.layer && selected.index === feature.index}
												onclick={() => select(feature.layer, feature.index)}
												>{layerName(feature.layer)} #{feature.index}</button
											>
										</th>
										<td>{feature.kind}</td>
										<td>{count(feature.vertices)}</td>
										<td>{bytes(feature.geometryBytes)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
						{#if listed.length > ROWS}
							<Note>The first {ROWS} of {count(listed.length)}. Pick a layer, or a feature in the drawing.</Note>
						{/if}
						{#if picked}
							<dl class="facts" aria-label="The picked feature">
								<dt>Id</dt>
								<dd>{picked.id ?? 'none'}</dd>
								<dt>Parts</dt>
								<dd>{picked.parts.length}{picked.malformed ? ', then the geometry stops making sense' : ''}</dd>
							</dl>
							<JsonTree value={picked.properties} name="properties" open />
						{/if}
					{:else if dissection.issues.length === 0}
						<Note tone="empty">Every layer and feature follows the vector tile spec.</Note>
					{:else}
						<table class="figures" aria-label="Issues">
							<thead>
								<tr><th scope="col">Layer</th><th scope="col">Feature</th><th scope="col">Issue</th></tr>
							</thead>
							<tbody>
								{#each dissection.issues as issue, i (i)}
									{@const layer = layerIndex(issue.layer)}
									<tr>
										<th scope="row">{issue.layer}</th>
										<td>
											{#if issue.feature !== null && layer >= 0}
												<button type="button" class="link" onclick={() => select(layer, issue.feature ?? 0)}
													>#{issue.feature}</button
												>
											{:else}
												layer
											{/if}
										</td>
										<td class="issue" title={issue.kind}>{issue.label}</td>
									</tr>
								{/each}
							</tbody>
						</table>
						{#if dissection.repair}
							<Note tone="aside">
								A repair would leave {kilobytes(dissection.repair.rawBytes)} decompressed, and {dissection.repair
									.issuesLeft === 0
									? 'no issues'
									: `${dissection.repair.issuesLeft} issues it cannot fix`}.
							</Note>
						{/if}
					{/if}
				</div>
			</div>
		{/if}
	{/if}

	{#snippet actions()}
		<button type="button" class="button" onclick={onShowOnMap}>Show on map</button>
		<button type="button" class="button primary" onclick={onClose}>Close</button>
	{/snippet}
</Modal>

<style>
	.moves {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.address {
		display: flex;
		align-items: center;
		gap: var(--space-2);

		input {
			width: 10rem;
			font-family: var(--font-mono);
		}
	}

	.quads,
	.compass {
		display: flex;
		gap: var(--space-1);
	}

	.sizes {
		grid-template-columns: repeat(3, auto minmax(0, 1fr));
	}

	.over {
		color: var(--error);
	}

	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-5);
		min-height: 0;

		@media (width < 48rem) {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	figure {
		margin: 0;
	}

	figcaption {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		margin-top: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-2);
	}

	.contents {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}

	.focused th {
		font-weight: 600;
	}

	.issue {
		text-align: left;
	}
</style>
