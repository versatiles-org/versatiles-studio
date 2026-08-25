<script lang="ts">
	import type { Fit, ImportKind, OperationInfo, Span, VplPipeline } from '../../ipc/commands';
	import { walk, samePath, isChainHead, feedsPreview } from '../../vpl/node-at';
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
		pinned,
		operations = [],
		kinds = [],
		properties = [],
		fits = [],
		suggestions = {},
		onPin,
		onCommit,
		onRemove,
		onSet,
		onRemoveNode,
		onAddOperation
	}: {
		pipeline: VplPipeline;
		/** The pinned node's path, when the pin is in *this* graph. */
		pinned: number[] | null;
		operations?: OperationInfo[];
		/** Every way in this build has, for the file dialog behind a path parameter (S3.2). */
		kinds?: ImportKind[];
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
		onPin: (path: number[]) => void;
		onCommit: (span: Span, value: string) => void;
		onRemove: (span: Span) => void;
		onSet: (span: Span, key: string, values: string[]) => void;
		onRemoveNode: (span: Span) => void;
		onAddOperation: (afterNameSpan: Span, operation: string) => void;
	} = $props();

	const rows = $derived(walk(pipeline));

	/// Which rows reach what the map is showing. The pin decides, so this is the chain drawing the
	/// same answer `preview::up_to` computes (C3).
	const active = $derived(rows.map((row) => feedsPreview(row.path, pinned)));

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

<div class="chain">
	{#each rows as row, index (row.path.join('.'))}
		<div class="row" class:inactive={!active[index]} style:--depth={row.depth}>
			<NodeCard
				node={row.node}
				path={row.path}
				pinned={samePath(pinned, row.path)}
				isHead={isChainHead(row.path)}
				{operations}
				{kinds}
				{properties}
				suggestions={suggestions[row.path.join('.')] ?? {}}
				{onPin}
				{onCommit}
				{onRemove}
				{onSet}
				{onRemoveNode}
			/>
		</div>

		{#if index < rows.length - 1 || transforms.length > 0}
			<!-- A connection is live when the node it arrives at is, because that is what makes it a
			     connection. The last rail arrives nowhere - it is the invitation to add an operation,
			     not a pipe carrying anything - so it is never live. `active[index + 1]` is `undefined`
			     there, which is exactly the answer. -->
			<div class="rail" class:inactive={!active[index + 1]} style:--depth={row.depth}>
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
	}

	.row {
		min-width: 0;
		padding-left: calc(var(--depth) * var(--space-4));
	}

	/* The rail's content box matches the row's, so a percentage inside it is a percentage of the
	   node above - which is what lets the stem sit under the node's middle rather than near its
	   left edge. */
	.rail {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 0.7rem;
		padding-left: calc(var(--depth) * var(--space-4));

		/* One height, always. It used to grow only for the selected node's rail, which meant every
		   click moved the rest of the chain - the same restlessness the folding had. */
		min-height: 1.5rem;
	}

	/* **The pipe, and the node's outline, are one object.** Same colour and same width, so a chain
	   reads as something joined rather than as cards stacked near a hairline - which is what it
	   looked like when this was 1px of `--rule` and the nodes were bordered in the same grey as
	   every other separator in the pane. */
	/* **Only the part that reaches the map is the accent.** The eye decides what is previewed, and
	   everything downstream of it is not being drawn - so it says so, in the colour a separator has
	   rather than the one the pipeline has. Without this the whole chain claimed to be live while
	   half of it was not running at all. */
	.inactive {
		--pipe: var(--rule);
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
