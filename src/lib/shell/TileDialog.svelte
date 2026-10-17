<script lang="ts">
	import Modal from '../common/Modal.svelte';
	import Tabs from '../common/Tabs.svelte';
	import SortHeader from '../common/SortHeader.svelte';
	import { sortRows, type Sort } from '../common/sort';
	import Note from '../common/Note.svelte';
	import Field from '../common/Field.svelte';
	import JsonTree from '../common/JsonTree.svelte';
	import TileDrawing, { layerColour, reach } from './TileDrawing.svelte';
	import TileNavigator from './TileNavigator.svelte';
	import { bytes, kilobytes, count, ordinal } from '../common/format';
	import type { Dissection } from '../ipc/commands';
	import { parseAddress, type TileAt } from '../state/tile-dialog.svelte';

	// One tile, taken apart (S14.5, A4, [Q72]).
	//
	// **The tile beside its numbers.** The drawing on the left is what the map would hide; the tabs
	// on the right are what the bytes are spent on. A row picked in a tab is the feature outlined in
	// the drawing, and a feature clicked in the drawing is the row - one selection, two views of it.
	//
	// **Moving without closing.** `TileNavigator` puts the neighbours, children and parent a click
	// away, and the address in the title takes one typed; the selection is about one tile and goes
	// with it.
	//
	// **One size for every tile**, most of the window: the frame does not jump when a tile is
	// missing or small, so the grid stays under the pointer that is walking it. The title row holds
	// the address, the sizes and the way back to the map; the drawing is a square as tall as what is
	// left, and the tabs take the rest of the width.
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
	// What is typed, until the tile changes and it shows the new one.
	let address = $derived(`${at.z}/${at.x}/${at.y}`);
	const typed = $derived(parseAddress(address));

	// A new tile is a new subject: what was picked in the last one names nothing in this one.
	$effect(() => {
		void at;
		focus = null;
		selected = null;
	});

	const vector = $derived(dissection !== null && dissection.layers.length > 0);
	const total = $derived(dissection?.layers.reduce((sum, layer) => sum + layer.features, 0) ?? 0);
	const extent = $derived(dissection?.layers[focus ?? 0]?.extent ?? 4096);
	/** Features reaching past the buffer the drawing shows - counted, since they are not seen whole. */
	const beyond = $derived(dissection ? reach(dissection.features, extent).beyond : 0);
	const listed = $derived((dissection?.features ?? []).filter((feature) => focus === null || feature.layer === focus));
	const picked = $derived(
		selected ? dissection?.features.find((f) => f.layer === selected?.layer && f.index === selected.index) : undefined
	);
	const attributesOf = $derived(dissection?.layers[focus ?? 0] ?? null);

	const layerName = (index: number) => dissection?.layers[index]?.name ?? '?';

	// **Each table sorts by any of its columns**, and keeps that from one tile to the next: sorting
	// layers by size is a way of reading tiles, not one tile. Unsorted is the tile's own order - the
	// order its layers are stored and painted in.
	let sorts = $state<Record<'layers' | 'attributes' | 'features' | 'issues', Sort | null>>({
		layers: null,
		attributes: null,
		features: null,
		issues: null
	});
	const layerRows = $derived(
		sortRows(
			(dissection?.layers ?? []).map((layer, i) => ({ layer, i })),
			sorts.layers,
			({ layer }, by) =>
				({ Layer: layer.name, Features: layer.features, Vertices: layer.vertices, Size: layer.bytes })[by]
		)
	);
	const attributeRows = $derived(
		sortRows(
			attributesOf?.attributes ?? [],
			sorts.attributes,
			(attribute, by) =>
				({ Key: attribute.key, Features: attribute.features, Distinct: attribute.distinct, Size: attribute.bytes })[by]
		)
	);
	// Sorted before the first ROWS are cut, so "by size" lists the largest of all, not of the first few.
	const featureRows = $derived(
		sortRows(
			listed,
			sorts.features,
			(feature, by) =>
				({
					Feature: `${layerName(feature.layer)} #${feature.index}`,
					Type: feature.kind,
					Vertices: feature.vertices,
					Size: feature.geometryBytes
				})[by]
		)
	);
	const issueRows = $derived(
		sortRows(
			dissection?.issues ?? [],
			sorts.issues,
			(issue, by) => ({ Layer: issue.layer, Feature: issue.feature, Issue: issue.label })[by]
		)
	);
	const layerIndex = (name: string) => dissection?.layers.findIndex((layer) => layer.name === name) ?? -1;

	function select(layer: number, index: number) {
		selected = { layer, index };
		tab = 'features';
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

<Modal title="Tile {at.z}/{at.x}/{at.y}" heading="Tile" width="96rem" height="64rem" {onClose}>
	{#snippet header()}
		<form
			class="address"
			onsubmit={(event) => {
				event.preventDefault();
				if (typed) onGo(typed.z, typed.x, typed.y);
			}}
		>
			<input
				type="text"
				aria-label="Tile address"
				bind:value={address}
				aria-invalid={typed === null}
				spellcheck="false"
			/>
			<button type="submit" class="button" disabled={typed === null}>Go</button>
		</form>
		{#if dissection}
			<p class="sizes">
				{dissection.format} · {dissection.compression} ·
				<span class:over={dissection.storedBytes > BUDGET}>{kilobytes(dissection.storedBytes)} stored</span>
				· {kilobytes(dissection.rawBytes)} decompressed
			</p>
		{/if}
		<button type="button" class="button show" onclick={onShowOnMap}>Show on map</button>
	{/snippet}

	<div class="main">
		{#if dissection && vector && dissection.every > 1}
			<Note tone="aside">
				Every {ordinal(dissection.every)} feature of each layer is drawn and listed - {count(
					dissection.features.length
				)} of {count(total)}. The Layers and Attributes tabs count all of them.
			</Note>
		{/if}
		<div class="room">
			<div class="split">
				<!-- The square is there whatever is in it, so the grid in its corner stays under the pointer
				     from a tile to a missing one and back. -->
				<figure>
					<div class="stage">
						{#if dissection && vector}
							<TileDrawing
								features={dissection.features}
								{extent}
								{selected}
								{focus}
								vertices={showVertices}
								onSelect={select}
							/>
						{:else}
							<div class="blank">
								{#if error}
									<Note tone="problem">{error}</Note>
								{:else if loading && !dissection}
									<Note tone="empty" live>Taking the tile apart…</Note>
								{:else if !dissection}
									<Note tone="empty">This source has no tile at {at.z}/{at.x}/{at.y}.</Note>
								{:else}
									<Note tone="aside">A raster tile has nothing to take apart beyond its size.</Note>
								{/if}
							</div>
						{/if}
						<div class="corner"><TileNavigator {at} {onGo} /></div>
					</div>
					{#if dissection && vector}
						<figcaption>
							<label><input type="checkbox" bind:checked={showVertices} /> Vertices</label>
							<span>Dashed: the tile's edge and a hole. Red: a ring that encloses nothing.</span>
							{#if beyond > 0}<span
									>{count(beyond)} {beyond === 1 ? 'feature reaches' : 'features reach'} past the buffer shown.</span
								>{/if}
						</figcaption>
					{/if}
				</figure>

				{#if dissection && vector}
					<!-- A long list scrolls in its own panel, so the drawing and the tabs stay where they are. -->
					<div class="contents">
						<Tabs items={tabs} selected={tab} onSelect={(id) => (tab = id)} label="What the tile holds" />
						{#if tab === 'attributes'}
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
						{/if}
						<div class="panel">
							{#if tab === 'layers'}
								<table class="figures" aria-label="Layers">
									<thead>
										<tr>
											<SortHeader
												label="Layer"
												first="ascending"
												sort={sorts.layers}
												onSort={(next) => (sorts.layers = next)}
											/>
											<SortHeader label="Features" sort={sorts.layers} onSort={(next) => (sorts.layers = next)} />
											<SortHeader label="Vertices" sort={sorts.layers} onSort={(next) => (sorts.layers = next)} />
											<SortHeader label="Size" sort={sorts.layers} onSort={(next) => (sorts.layers = next)} />
										</tr>
									</thead>
									<tbody>
										{#each layerRows as { layer, i } (layer.name)}
											<tr class:focused={focus === i}>
												<th scope="row">
													<button
														type="button"
														class="link"
														aria-pressed={focus === i}
														onclick={() => (focus = focus === i ? null : i)}
														><span class="swatch" style:background={layerColour(i)}></span>{layer.name}</button
													>
												</th>
												<td>{count(layer.features)}</td>
												<td>{count(layer.vertices)}</td>
												<td>{kilobytes(layer.bytes)}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							{:else if tab === 'attributes'}
								{#if attributesOf && attributesOf.attributes.length > 0}
									<table class="figures" aria-label="Attributes">
										<thead>
											<tr>
												<SortHeader
													label="Key"
													first="ascending"
													sort={sorts.attributes}
													onSort={(next) => (sorts.attributes = next)}
												/>
												<SortHeader
													label="Features"
													sort={sorts.attributes}
													onSort={(next) => (sorts.attributes = next)}
												/>
												<SortHeader
													label="Distinct"
													sort={sorts.attributes}
													onSort={(next) => (sorts.attributes = next)}
												/>
												<SortHeader label="Size" sort={sorts.attributes} onSort={(next) => (sorts.attributes = next)} />
											</tr>
										</thead>
										<tbody>
											{#each attributeRows as attribute (attribute.key)}
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
										<tr>
											<SortHeader
												label="Feature"
												first="ascending"
												sort={sorts.features}
												onSort={(next) => (sorts.features = next)}
											/>
											<SortHeader
												label="Type"
												first="ascending"
												sort={sorts.features}
												onSort={(next) => (sorts.features = next)}
											/>
											<SortHeader label="Vertices" sort={sorts.features} onSort={(next) => (sorts.features = next)} />
											<SortHeader label="Size" sort={sorts.features} onSort={(next) => (sorts.features = next)} />
										</tr>
									</thead>
									<tbody>
										{#each featureRows.slice(0, ROWS) as feature (`${feature.layer}/${feature.index}`)}
											<tr>
												<th scope="row">
													<button
														type="button"
														class="link"
														aria-pressed={selected?.layer === feature.layer && selected.index === feature.index}
														onclick={() => select(feature.layer, feature.index)}
														><span class="swatch" style:background={layerColour(feature.layer)}></span>{layerName(
															feature.layer
														)} #{feature.index}</button
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
							{:else if dissection.issues.length === 0}
								<Note tone="empty">Every layer and feature follows the vector tile spec.</Note>
							{:else}
								<table class="figures" aria-label="Issues">
									<thead>
										<tr>
											<SortHeader
												label="Layer"
												first="ascending"
												sort={sorts.issues}
												onSort={(next) => (sorts.issues = next)}
											/>
											<SortHeader
												label="Feature"
												first="ascending"
												sort={sorts.issues}
												onSort={(next) => (sorts.issues = next)}
											/>
											<SortHeader
												label="Issue"
												first="ascending"
												sort={sorts.issues}
												onSort={(next) => (sorts.issues = next)}
											/>
										</tr>
									</thead>
									<tbody>
										{#each issueRows as issue, i (i)}
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
							{/if}
						</div>
						<!-- What was picked, pinned under the list rather than after it, so it is in view however
						     long the list is and the list does not move when it appears. -->
						{#if tab === 'layers'}
							<div class="detail">
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
							</div>
						{:else if tab === 'features'}
							<div class="detail">
								{#if picked}
									<dl class="facts" aria-label="The picked feature">
										<dt>Id</dt>
										<dd>{picked.id ?? 'none'}</dd>
										<dt>Parts</dt>
										<dd>{picked.parts.length}{picked.malformed ? ', then the geometry stops making sense' : ''}</dd>
									</dl>
									<JsonTree value={picked.properties} name="properties" open />
								{:else}
									<Note>Pick a feature, here or in the drawing, to see its properties.</Note>
								{/if}
							</div>
						{:else if tab === 'issues' && dissection.repair}
							<div class="detail">
								<Note tone="aside">
									A repair would leave {kilobytes(dissection.repair.rawBytes)} decompressed, and {dissection.repair
										.issuesLeft === 0
										? 'no issues'
										: `${dissection.repair.issuesLeft} issues it cannot fix`}.
								</Note>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>
</Modal>

<style>
	.address {
		display: flex;
		align-items: center;
		gap: var(--space-2);

		input {
			width: 11rem;
			font-family: var(--font-mono);
		}
	}

	.sizes {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.over {
		color: var(--error);
	}

	.show {
		margin-left: auto;
	}

	/* What the title row leaves, whatever is in it - a note, or the tile. */
	.main {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		gap: var(--space-3);
		min-height: 0;
	}

	/* A container, so the drawing can be as tall as the room is: a square of the room's height less
	   its caption, or six tenths of its width when the room is the wider way round. */
	.room {
		flex: 1 1 auto;
		min-height: 0;
		container-type: size;
	}

	.split {
		display: grid;
		grid-template-columns: min(calc(100cqh - 2.5rem), 60cqw) minmax(0, 1fr);
		gap: var(--space-5);
		height: 100%;
	}

	figure {
		margin: 0;
	}

	/* The drawing's square, with the navigator over its corner as the map's controls are over it. */
	.stage {
		position: relative;
	}

	.corner {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
	}

	.blank {
		display: grid;
		place-items: center;
		aspect-ratio: 1;
		padding: var(--space-5);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--map-bg);
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
		min-height: 0;
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
	}

	/* Pinned under the list: at most half the column, and its own scroller past that. */
	.detail {
		flex: none;
		max-height: 50%;
		overflow-y: auto;
		padding-top: var(--space-3);
		border-top: 1px solid var(--rule);
	}

	/* The layer's colour in the drawing, beside its name. */
	.swatch {
		display: inline-block;
		width: 0.7em;
		height: 0.7em;
		margin-right: var(--space-2);
		border-radius: var(--radius);
		vertical-align: baseline;
	}

	.focused th {
		font-weight: 600;
	}

	.issue {
		text-align: left;
	}
</style>
