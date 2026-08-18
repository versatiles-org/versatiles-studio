<script lang="ts">
	import type { OperationInfo, Span, VplPipeline } from '../../ipc/commands';
	import { walk, samePath } from '../../vpl/node-at';
	import NodeCard from './NodeCard.svelte';

	// The graph as a chain of nodes (C1, S2.13).
	//
	// Vertical, because pipelines are mostly linear; nesting shows as depth, which is what makes a
	// `from_stacked [ … ]` block readable without a second layout.
	//
	// **`＋ operation…` lives on the rail, outside the nodes** ([Q32]). `＋ parameter…` inside a node
	// acts on the node; this acts on the chain, and drawing it where an insertion actually goes
	// means the two never have to be told apart by weight or colour. Only the selected node's rail
	// carries it, so a ten-node chain still shows nine plain connectors.
	let {
		pipeline,
		selected,
		pinned,
		operations = [],
		properties = [],
		suggestions = {},
		onSelect,
		onPin,
		onCommit,
		onRemove,
		onSet,
		onRemoveNode,
		onAddOperation
	}: {
		pipeline: VplPipeline;
		selected: number[] | null;
		/** The pinned node's path, when the pin is in *this* graph. */
		pinned: number[] | null;
		operations?: OperationInfo[];
		properties?: string[];
		suggestions?: Record<string, string[]>;
		onSelect: (path: number[], span: Span) => void;
		onPin: (path: number[]) => void;
		onCommit: (span: Span, value: string) => void;
		onRemove: (span: Span) => void;
		onSet: (key: string, values: string[]) => void;
		onRemoveNode: (span: Span) => void;
		onAddOperation: (afterNameSpan: Span, operation: string) => void;
	} = $props();

	const rows = $derived(walk(pipeline));

	/// Only transforms. A read node belongs at the head and gets there by adding a source (Q14);
	/// offering one here would produce a document that parses and is then immediately marked wrong.
	const transforms = $derived(
		operations.filter((operation) => operation.kind === 'transform').sort((a, b) => a.name.localeCompare(b.name))
	);

	let adding = $state('');
</script>

<div class="chain">
	{#each rows as row, index (row.path.join('.'))}
		{@const isSelected = samePath(selected, row.path)}
		<div class="row" style:--depth={row.depth}>
			<NodeCard
				node={row.node}
				path={row.path}
				selected={isSelected}
				pinned={samePath(pinned, row.path)}
				isHead={row.node.name.startsWith('from_')}
				{operations}
				{properties}
				{suggestions}
				{onSelect}
				{onPin}
				{onCommit}
				{onRemove}
				{onSet}
				{onRemoveNode}
			/>
		</div>

		{#if index < rows.length - 1 || isSelected}
			<div class="rail" style:--depth={row.depth} class:offering={isSelected}>
				<span class="stem" aria-hidden="true"></span>
				{#if isSelected && transforms.length > 0}
					<span class="elbow" aria-hidden="true"></span>
					<label class="insert">
						<span class="visually-hidden">Add an operation after {row.node.name}</span>
						<select
							bind:value={adding}
							onchange={() => {
								if (!adding) return;
								onAddOperation(row.node.nameSpan, adding);
								adding = '';
							}}
						>
							<option value="">＋ operation…</option>
							{#each transforms as operation (operation.name)}
								<option value={operation.name} title={operation.summary}>{operation.name}</option>
							{/each}
						</select>
					</label>
				{/if}
			</div>
		{/if}
	{/each}
</div>

<style>
	.chain {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.row {
		min-width: 0;
		padding-left: calc(var(--depth) * var(--space-4));
	}

	.rail {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 0.7rem;
		padding-left: calc(var(--depth) * var(--space-4) + var(--space-4));

		&.offering {
			min-height: 1.5rem;
		}
	}

	.stem {
		width: 1px;
		align-self: stretch;
		background: var(--rule);
		flex: none;
	}

	/* The elbow is what says "this hangs off the chain" rather than "this is part of the node". */
	.elbow {
		width: var(--space-4);
		height: 0.55rem;
		border-left: 1px solid var(--rule);
		border-bottom: 1px solid var(--rule);
		border-bottom-left-radius: 3px;
		margin-top: -0.55rem;
		margin-left: -1px;
		flex: none;
	}

	.insert select {
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
</style>
