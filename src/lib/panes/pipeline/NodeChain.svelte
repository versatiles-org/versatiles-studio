<script lang="ts">
	import type { Fit, OperationInfo, Span, VplPipeline } from '../../ipc/commands';
	import { walk, isChainHead, isOn } from '../../vpl/nodes';
	import NodeCard from './NodeCard.svelte';
	import Picker from '../../common/Picker.svelte';

	// The graph as a chain of nodes (C1, S2.13).
	//
	// Vertical, because pipelines are mostly linear; nesting shows as depth, which is what makes a
	// `from_stacked [ … ]` block readable without a second layout.
	//
	// **`＋ operation…` lives on the rail, outside the nodes** ([Q32]). `＋ parameter…` inside a node
	// acts on the node; this acts on the chain, and drawing it where an insertion actually goes
	// means the two never have to be told apart by weight or colour. Every rail carries one - it
	// used to be only the selected node's, which is a distinction the chain no longer makes.
	let {
		pipeline,
		disabled,
		enabled,
		operations = [],
		properties = [],
		fits = [],
		suggestions = {},
		onToggle,
		onCommit,
		onRemove,
		onSet,
		onRemoveNode,
		onAddOperation
	}: {
		pipeline: VplPipeline;
		/** Node paths switched off in this graph ([Q49]). */
		disabled: number[][];
		/** Whether the graph itself is switched on. Off, the whole chain reads as not running. */
		enabled: boolean;
		operations?: OperationInfo[];
		/** Every way in this build has, for the file dialog behind a path parameter (S3.2). */
		properties?: string[];
		/**
		 * What can be appended to what the map is showing, and why the rest cannot (S2.14).
		 *
		 * From the preview, because it is an answer about the tiles that node actually produces.
		 * Empty before the first build, which is why the picker degrades to an ungrouped list
		 * rather than to an empty one.
		 */
		fits?: Fit[];
		/** By node path, then by field. Each node is handed only its own. */
		suggestions?: Record<string, Record<string, string[]>>;
		/** Switches a node on or off. The head's eye is the graph's - see `NodeCard`. */
		onToggle: (path: number[], on: boolean) => void;
		onCommit: (span: Span, value: string) => void;
		onRemove: (span: Span) => void;
		onSet: (span: Span, key: string, values: string[]) => void;
		onRemoveNode: (span: Span) => void;
		onAddOperation: (afterNameSpan: Span, operation: string) => void;
	} = $props();

	const rows = $derived(walk(pipeline));

	/// Which rows are running.
	///
	/// **Each node answers for itself** ([Q49]). This used to be `feedsPreview`, which asked whether
	/// a node reached the pin - so switching one node off darkened every node after it, and one
	/// branch of a `from_stacked` darkened the other. A bypass is not a truncation: the nodes below
	/// a switched-off one carry on, which is what the pipe running through it says.
	///
	/// The graph's own switch is the head node's, so an off graph shows a chain of off eyes without
	/// this having to know about it.
	const on = $derived(rows.map((row) => (isChainHead(row.path) ? enabled : isOn(row.path, disabled))));

	/// Only transforms. A read node belongs at the head and gets there by adding a source (Q14);
	/// offering one here would produce a document that parses and is then immediately marked wrong.
	const transforms = $derived(
		operations.filter((operation) => operation.kind === 'transform').sort((a, b) => a.name.localeCompare(b.name))
	);

	// -- what fits (S2.14) --------------------------------------------------------------------

	/// Why each operation was refused, by name. Absent means nothing ruled it out.
	const refusal = $derived(new Map(fits.map((fit) => [fit.name, fit.reason])));

	/// **Unknown counts as fitting.** Before the first preview this map is empty, and an operation
	/// the core did not mention is one nothing is known about - offering it is the honest default,
	/// and it is what the picker did before it could ask.
	const reasonFor = (name: string): string | null => refusal.get(name) ?? null;

	const fitting = $derived(transforms.filter((operation) => reasonFor(operation.name) === null));
	const misfits = $derived(transforms.filter((operation) => reasonFor(operation.name) !== null));

	/// Group only when there is something to group by, so an ungrouped list is never labelled as
	/// having been checked.
	const grouped = $derived(misfits.length > 0);

	/// What the picker offers: the ones that fit, then the ones that do not with their reason.
	///
	/// Refused operations stay on the list rather than being dropped - an operation someone knows
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

<!-- A graph that is off is a chain that is not running, whatever each node's own eye says - the
     same reading as a hidden layer whose filters keep their switches. -->
<div class="chain" class:off={!enabled}>
	{#each rows as row, index (row.path.join('.'))}
		<div class="row" class:inactive={!on[index]} style:--depth={row.depth}>
			<NodeCard
				node={row.node}
				path={row.path}
				on={on[index]}
				isHead={isChainHead(row.path)}
				{operations}
				{properties}
				suggestions={suggestions[row.path.join('.')] ?? {}}
				{onToggle}
				{onCommit}
				{onRemove}
				{onSet}
				{onRemoveNode}
			/>
		</div>

		{#if index < rows.length - 1 || transforms.length > 0}
			<!-- **The pipe does not go dark under a switched-off node** ([Q49]), because the tiles
			     still flow: they skip it. What is dark is the node itself. The whole chain goes dark
			     with the graph, which is the one case where nothing is flowing at all. -->
			<div class="rail" class:inactive={!enabled} style:--depth={row.depth}>
				<span class="stem" aria-hidden="true"></span>
				{#if transforms.length > 0}
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

		&.off {
			opacity: 0.55;
		}
	}

	.row {
		min-width: 0;
		padding-left: calc(var(--depth) * var(--space-4));
	}

	/* The rail's content box matches the row's, so a percentage inside it is a percentage of the
	   node above - which is what lets the stem sit under the node's middle rather than near its
	   left edge. */
	/* **A join, not a band.** The rail stood 24px tall while `＋ operation…` inside it is 15px, so a
	   chain read as nodes and rails alternating at equal weight - and measured against the pane, the
	   distance from a node to the next one was the same 26px as the distance from a parameter row to
	   the one below it. Nothing said the two nodes were joined and the two rows merely adjacent.
	
	   Sized to its own content now, with a floor that keeps every rail equal: it used to grow only
	   for the selected node's, which meant every click moved the rest of the chain. */
	.rail {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--space-5);
		padding-left: calc(var(--depth) * var(--space-4));
	}

	/* **The pipe, and the node's outline, are one object.** Same colour and same width, so a chain
	   reads as something joined rather than as cards stacked near a hairline - which is what it
	   looked like when this was 1px of `--rule` and the nodes were bordered in the same grey as
	   every other separator in the pane. */
	/* **A switched-off node is a ghost, not a gap** ([Q49]). It keeps its place and its form - the
	   parameters are still there to read and to edit - and says it is not running by going quiet.
	   The pipe around it stays live, because the tiles still flow; they skip it. */
	.inactive {
		--pipe: var(--rule);
		opacity: 0.55;
	}

	.stem {
		width: var(--pipe-width);
		/* Half its own width back from the middle, so the line is centred rather than starting
		   there. */
		margin-left: calc(50% - var(--pipe-width) / 2);
		align-self: stretch;
		background: var(--pipe);
		flex: none;
	}
</style>
