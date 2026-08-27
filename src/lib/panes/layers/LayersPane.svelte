<script lang="ts">
	import type { StyleSpecification } from 'maplibre-gl';
	import type { LayerOverride } from '../../ipc/commands';
	import { tree, type Group, type Node } from './tree';
	import LayerRow from './LayerRow.svelte';

	// What the map paints, project-wide ([the layer stack](../../../../docs/layers.md)).
	//
	// **The layer tree left the Style pane.** Style says how one source is *drawn* - its preset and
	// the adjustments over it - and contributes layers; where those layers land is a question about
	// the whole map, and the whole map is one ordered list. Keeping the tree per source was what made
	// "OSM, then my data, then OSM's labels" impossible to say.
	//
	// **Rows come from the composition, not from a recipe.** `composeStyle` already walks the stack in
	// paint order and knows which source each layer came from, so this draws what is on the map
	// rather than a second opinion about it.
	//
	// Reordering is not here yet: this step is the tree, and a drag needs `reorder.ts` behind it.
	let {
		rows = [],
		sources = {},
		actions
	}: {
		/** Every drawn layer in paint order, from `Composed.rows`. */
		rows?: { id: string; ownId: string; source: string; type: string; hidden: string | null }[];
		/** What each source is, by name: its graph, its own style, and what was changed about it. */
		sources?: Record<
			string,
			{ graph: number; hidden: string[]; overrides: Record<string, LayerOverride>; style: StyleSpecification | null }
		>;
		actions: {
			/** The eye on a group - a path within one source ([Q36] keeps it sparse). */
			setHidden: (graph: number, path: string, hidden: boolean) => void;
			setOverride: (graph: number, layer: string, patch: LayerOverride) => void;
			/** Clicking a row selects its source, so Pipeline and Style follow the one selection. */
			select: (graph: number) => void;
		};
	} = $props();

	let query = $state('');

	/// **Filtering hides rows; it does not regroup them.** A tree built from a filtered list would
	/// join runs that are not adjacent on the map - which is the one thing this tree promises not to
	/// do - so the whole stack is built and the query decides what is drawn from it.
	const stack = $derived(tree(rows));

	const needle = $derived(query.trim().toLowerCase());
	const matches = (node: Node): boolean => {
		if (!needle) return true;
		if (node.kind === 'layer') return `${node.ownId} ${node.source}`.toLowerCase().includes(needle);
		return node.label.toLowerCase().includes(needle) || node.children.some(matches);
	};

	/// Which groups are open, by the identity of the node in the stack rather than by its path: two
	/// runs of one category are two rows, and opening one must not open the other.
	let open = $state<Record<string, boolean>>({});
	const keyOf = (node: Group, at: string) => `${at}/${node.source}:${node.path}`;

	/// **A filter opens what it found.** A match nobody can see is not a match, and the rows are
	/// collapsed by default - so while a query is running, a branch is open if the thing that matched
	/// is below it. A branch that matched by its own name stays as it is: showing the row is the
	/// answer, and opening it would bury it under everything it holds.
	const isOpen = (node: Group, key: string) => (needle ? node.children.some(matches) : (open[key] ?? false));

	const styleOf = (source: string) => sources[source]?.style ?? null;
	const specOf = (source: string, ownId: string) => styleOf(source)?.layers.find((layer) => layer.id === ownId);
	const overrideOf = (source: string, ownId: string) => sources[source]?.overrides[ownId] ?? {};

	/// Whether an eye covers this group: the path itself, or one above it.
	const closedOn = (node: Group) => {
		const hidden = sources[node.source]?.hidden ?? [];
		return hidden.find((path) => node.path === path || node.path.startsWith(`${path}/`)) ?? null;
	};

	function toggleGroup(node: Group) {
		const graph = sources[node.source]?.graph;
		if (graph === undefined) return;
		const closed = closedOn(node);
		// Pressing an eye that is closed *above* this row opens the one that closed it - the row a
		// person is looking at is the row they mean, and there is nothing else this could do.
		if (closed !== null) actions.setHidden(graph, closed, false);
		else actions.setHidden(graph, node.path, true);
	}
</script>

{#snippet nodes(list: Node[], at: string, depth: number)}
	{#each list as node, index (node.kind === 'layer' ? node.id : `${node.path}:${index}`)}
		{#if matches(node)}
			{#if node.kind === 'layer'}
				<div class="row" style="--depth: {depth}">
					<LayerRow
						id={node.ownId}
						type={node.type}
						spec={specOf(node.source, node.ownId)}
						override={overrideOf(node.source, node.ownId)}
						hiddenBy={node.hidden}
						onOverride={(layer, patch) => {
							const graph = sources[node.source]?.graph;
							if (graph !== undefined) actions.setOverride(graph, layer, patch);
						}}
					/>
				</div>
			{:else}
				{@const key = keyOf(node, `${at}/${index}`)}
				{@const closed = closedOn(node)}
				{@const shown = isOpen(node, key)}
				<div class="row group" style="--depth: {depth}">
					<button
						type="button"
						class="fold"
						aria-expanded={shown}
						aria-label={shown ? `Collapse ${node.label}` : `Expand ${node.label}`}
						onclick={() => (open = { ...open, [key]: !shown })}
					>
						{shown ? '▾' : '▸'}
					</button>
					<button
						type="button"
						class="eye"
						aria-pressed={closed === null}
						aria-label={closed === null ? `Hide ${node.label}` : `Show ${node.label}`}
						title={closed !== null && closed !== node.path ? `Hidden by the eye on ${closed}` : undefined}
						onclick={() => toggleGroup(node)}
					>
						{closed === null ? '◉' : '○'}
					</button>
					<button
						type="button"
						class="label truncate"
						class:hidden={closed !== null}
						title={depth === 0 ? `Edit ${node.source}` : node.path}
						onclick={() => {
							const graph = sources[node.source]?.graph;
							if (graph !== undefined) actions.select(graph);
						}}
					>
						{node.label}
					</button>
					<span class="count">{node.count}</span>
				</div>
				{#if shown}
					{@render nodes(node.children, key, depth + 1)}
				{/if}
			{/if}
		{/if}
	{/each}
{/snippet}

{#if rows.length === 0}
	<p class="nothing">Nothing is being drawn yet.</p>
{:else}
	<input type="text" class="filter" placeholder="Filter layers…" bind:value={query} aria-label="Filter layers" />
	<div class="tree">
		{@render nodes(stack, '', 0)}
	</div>
{/if}

<style>
	.nothing {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--text-sm);
	}

	.filter {
		width: 100%;
		font-size: var(--text-sm);
	}

	/* Its own scroll: the stack runs to a few hundred layers across every source, and the panes above
	   it should not have to be scrolled past to reach the pipeline. */
	.tree {
		max-height: 24rem;
		overflow-y: auto;
		margin-top: var(--space-2);
	}

	.row {
		/* One indent per level, so the depth is readable without a guide line. */
		padding-left: calc(var(--depth) * var(--space-4));

		&.group {
			display: flex;
			align-items: center;
			gap: var(--space-2);
			min-width: 0;
			padding-top: 1px;
			padding-bottom: 1px;
		}

		.fold,
		.eye {
			flex: none;
			color: var(--ink-2);
			font-size: var(--text-xs);
		}

		.label {
			flex: 1;
			min-width: 0;
			text-align: left;
			font-size: var(--text-xs);

			/* Dimmed rather than removed: a hidden branch is still one you have to be able to find. */
			&.hidden {
				color: var(--ink-2);
				text-decoration: line-through;
			}
		}

		.count {
			flex: none;
			color: var(--ink-2);
			font-size: var(--text-xs);
			font-variant-numeric: tabular-nums;
		}
	}

	.truncate {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
