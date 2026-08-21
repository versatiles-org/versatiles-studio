<script lang="ts">
	import type { Fit, OperationInfo, Span, VplPipeline } from '../../ipc/commands';
	import { walk, samePath, isChainHead } from '../../vpl/node-at';
	import NodeCard from './NodeCard.svelte';
	import Picker from '../../common/Picker.svelte';

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
		fits = [],
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
		/**
		 * What can be appended to the selected node's output, and why the rest cannot (S2.14).
		 *
		 * From the preview, because it is an answer about the tiles that node actually produces.
		 * Empty before the first build, which is why the picker degrades to an ungrouped list
		 * rather than to an empty one.
		 */
		fits?: Fit[];
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

	// -- what fits (S2.14) --------------------------------------------------------------------

	/// Why each operation was refused, by name. Absent means nothing ruled it out.
	const refusal = $derived(new Map(fits.map((fit) => [fit.name, fit.reason])));

	/// **Unknown counts as fitting.** Before the first preview this map is empty, and an operation
	/// the core did not mention is one nothing is known about — offering it is the honest default,
	/// and it is what the picker did before it could ask.
	const reasonFor = (name: string): string | null => refusal.get(name) ?? null;

	const fitting = $derived(transforms.filter((operation) => reasonFor(operation.name) === null));
	const misfits = $derived(transforms.filter((operation) => reasonFor(operation.name) !== null));

	/// Group only when there is something to group by, so an ungrouped list is never labelled as
	/// having been checked.
	const grouped = $derived(misfits.length > 0);

	/// What the picker offers: the ones that fit, then the ones that do not with their reason.
	///
	/// Refused operations stay on the list rather than being dropped — an operation someone knows
	/// exists, silently missing, is a worse answer than one shown with why it cannot go here.
	const choices = $derived([
		...fitting.map((operation) => ({
			value: operation.name,
			description: operation.summary,
			group: grouped ? 'Fits these tiles' : undefined
		})),
		...misfits.map((operation) => ({
			value: operation.name,
			unavailable: reasonFor(operation.name) ?? undefined,
			group: 'Not for these tiles'
		}))
	]);
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
				isHead={isChainHead(row.path)}
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
					<Picker
						label="＋ operation…"
						placeholder="Filter operations…"
						items={choices}
						onPick={(name) => onAddOperation(row.node.nameSpan, name)}
					/>
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
</style>
