<script lang="ts">
	import type { Diagnostic, FieldInfo, Fit, OperationInfo, Span, VplNode, VplPipeline } from '../../ipc/commands';
	import { isChainHead, isOn, problemsAt } from '../../vpl/nodes';
	import { SvelteSet } from 'svelte/reactivity';
	import Icon from '../../common/Icon.svelte';
	import NodeCard from './NodeCard.svelte';
	import NodeChain from './NodeChain.svelte';
	import Picker from '../../common/Picker.svelte';

	// The graph as a chain of nodes (C1, S2.13).
	//
	// Vertical, because pipelines are mostly linear.
	//
	// **`+ operation…` lives on the rail, outside the nodes** ([Q32]). `+ parameter…` inside a node
	// acts on the node; this acts on the chain, and drawing it where an insertion actually goes
	// means the two never have to be told apart by weight or colour. Every rail carries one - it
	// used to be only the selected node's, which is a distinction the chain no longer makes.
	//
	// **A node with sources is a box, and its sources are slots inside it.** `vector_branch`'s
	// `then` and `else`, `from_stacked`'s layers: each slot holds a chain of its own, drawn by this
	// same component one level in. So everything that belongs to the node's sources - their
	// operations, a new branch, a new source - is inside the box, and the rail below the box only
	// ever continues the chain the node is in. Drawn as one flat list, a new branch and a new
	// operation after the node were two rails next to each other, told apart by indent alone.
	let {
		pipeline,
		path = [],
		kind = 'top',
		disabled,
		enabled,
		operations = [],
		properties = [],
		fits = [],
		branchFits = [],
		suggestions = {},
		problems = [],
		onToggle,
		onCommit,
		onRemove,
		onSet,
		onRemoveNode,
		onAddOperation,
		onAddOperationBefore,
		onAddSource
	}: {
		pipeline: VplPipeline;
		/** Where this chain is: the path of the node whose slot holds it, then the slot's index. */
		path?: number[];
		/**
		 * What this chain is. `top` is the graph's own; `source` is a composite's, which reads
		 * something of its own and so starts with a read; `branch` is a `vector_branch` branch, which
		 * starts from the tiles arriving at its operation and so may gain a transform at its start.
		 */
		kind?: 'top' | 'source' | 'branch';
		/** What is wrong with the document, as the VPL tab underlines it. Each node is marked for its own. */
		problems?: Diagnostic[];
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
		/**
		 * What can be a step inside a `vector_branch` branch: `fits`, with what is not per-tile
		 * refused besides. The chain of a branch is handed these as its `fits`; this chain uses them
		 * for the branches it holds empty.
		 */
		branchFits?: Fit[];
		/** By node path, then by field. Each node is handed only its own. */
		suggestions?: Record<string, Record<string, string[]>>;
		/** Switches a node on or off. The head's eye is the graph's - see `NodeCard`. */
		onToggle: (path: number[], on: boolean) => void;
		onCommit: (span: Span, value: string) => void;
		onRemove: (span: Span) => void;
		onSet: (span: Span, key: string, values: string[]) => void;
		onRemoveNode: (span: Span) => void;
		onAddOperation: (afterNameSpan: Span, operation: string) => void;
		/** Inserts before a node - the start of a branch, the one place no rail after a node reaches. */
		onAddOperationBefore?: (beforeNameSpan: Span, operation: string) => void;
		/** Gives a node another source of just this operation - a branch, or a layer of a stack. */
		onAddSource?: (nameSpan: Span, operation: string) => void;
	} = $props();

	/// Where each node is, and whether it runs.
	///
	/// **Each node answers for itself** ([Q49]). This used to be `feedsPreview`, which asked whether
	/// a node reached the pin - so switching one node off darkened every node after it, and one
	/// branch of a `from_stacked` darkened the other. A bypass is not a truncation: the nodes below
	/// a switched-off one carry on, which is what the pipe running through it says.
	///
	/// The graph's own switch is the head node's, so an off graph shows a chain of off eyes without
	/// this having to know about it.
	const placed = $derived(
		pipeline.nodes.map((node, index) => {
			const here = [...path, index];
			return { node, here, on: isChainHead(here) ? enabled : isOn(here, disabled) };
		})
	);

	/// Only transforms. A read node belongs at the head and gets there by adding a source (Q14);
	/// offering one here would produce a document that parses and is then immediately marked wrong.
	const transforms = $derived(
		operations.filter((operation) => operation.kind === 'transform').sort((a, b) => a.name.localeCompare(b.name))
	);

	/// What a composite's new source can start with: something that reads.
	const reads = $derived(
		operations
			.filter((operation) => operation.kind === 'read')
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((operation) => ({ value: operation.name, description: operation.summary }))
	);

	/// Each operation's sources field, by name - what says whether it has slots, and what kind.
	const sourcesOf = $derived(
		new Map(
			operations.flatMap((operation) => {
				const field = operation.fields.find((candidate) => candidate.sources);
				return field ? [[operation.name, field] as const] : [];
			})
		)
	);

	// -- slots ---------------------------------------------------------------------------------

	/** One slot of a box: a source there is, or the place for the next one. */
	interface Slot {
		key: string;
		/** The source's index - where the slot's chain is, below the node's path. */
		index: number;
		name: string;
		/** What the slot is for, beside its name. */
		caption: string | null;
		source: VplPipeline | null;
		/** How an empty slot is filled: with a transform, a read, or not yet. */
		fill: 'transform' | 'read' | 'blocked' | null;
		/** What an empty slot says it does while empty. */
		empty: string;
	}

	/**
	 * The slots a node is drawn with.
	 *
	 * **A branching operation's slots are fixed** (versatiles-rs 5.10's `max_sources`):
	 * `vector_branch` always shows `then` and `else`, and an empty `else` says what it does - the
	 * other features pass through, which is exactly what upstream does without one. So there is no
	 * "+ branch": adding an operation to `else` is what makes the branch.
	 *
	 * An `else` waits for a `then`. VPL writes a branch by its position, `[ then, else ]`, and has no
	 * way to write an empty `then` before an `else` - `[ ]` reads as no branches at all.
	 *
	 * **A composite's sources are not fixed**, so it shows the ones it has and, while upstream's
	 * limit leaves room, one empty slot to add the next.
	 */
	function slotsOf(node: VplNode, field: FieldInfo | undefined): Slot[] {
		const there = node.sources.length;
		if (field?.branches) {
			const count = field.maxSources ?? there + 1;
			return Array.from({ length: count }, (_, index) => {
				const vector = node.name === 'vector_branch';
				return {
					key: `branch-${index}`,
					index,
					name: vector ? (index === 0 ? 'then' : 'else') : `branch ${index + 1}`,
					caption: vector ? (index === 0 ? 'features where expr is true' : 'all other features') : null,
					source: node.sources[index] ?? null,
					fill: index < there ? null : index === there ? 'transform' : 'blocked',
					empty:
						index === 0
							? 'Needs an operation: what the chosen features go through.'
							: index === there
								? 'Unchanged: they pass through as they are.'
								: `Unchanged. Add to ${vector ? 'then' : 'the branch before'} first.`
				};
			});
		}
		const slots: Slot[] = node.sources.map((source, index) => ({
			key: `source-${index}`,
			index,
			name: `source ${index + 1}`,
			caption: null,
			source,
			fill: null,
			empty: ''
		}));
		if (field && (field.maxSources === null || there < field.maxSources)) {
			slots.push({
				key: 'source-next',
				index: there,
				name: '',
				caption: null,
				source: null,
				fill: 'read',
				empty: 'another input'
			});
		}
		return slots;
	}

	// -- folding a slot -------------------------------------------------------------------------

	/// **A slot folds to one line**, for the branch nobody is editing: its operations' names, how
	/// many, and whether any of them has a problem - a long `then`, or a `vector_branch` inside a
	/// branch, otherwise pushes everything below it out of the pane. Open by default, which is how
	/// a slot was drawn before it could fold, and kept for as long as this chain is on screen.
	///
	/// By node and slot index, so editing inside a branch leaves its fold alone.
	const folded = new SvelteSet<string>();
	const uid = $props.id();

	/// What a folded slot says it holds: its chain's operations, in order.
	const summaryOf = (source: VplPipeline): string => source.nodes.map((node) => node.name).join(' → ');

	/// The problems anywhere inside a source, so folding a slot cannot hide one. An empty span is
	/// the core saying "the whole document", which no slot is marked for.
	const problemsIn = (source: VplPipeline): Diagnostic[] =>
		problems.filter(
			({ span }) => span.end > span.start && span.start >= source.span.start && span.start < source.span.end
		);

	// -- what fits (S2.14) --------------------------------------------------------------------

	/// What the picker offers: the ones that fit, then the ones that do not with their reason.
	///
	/// Refused operations stay on the list rather than being dropped - an operation someone knows
	/// exists, silently missing, is a worse answer than one shown with why it cannot go here.
	///
	/// **Unknown counts as fitting.** Before the first preview `fits` is empty, and an operation the
	/// core did not mention is one nothing is known about - offering it is the honest default, and
	/// it is what the picker did before it could ask.
	function choicesFor(fits: Fit[]) {
		const refusal = new Map(fits.map((fit) => [fit.name, fit.reason]));
		const reasonFor = (name: string): string | null => refusal.get(name) ?? null;
		const fitting = transforms.filter((operation) => reasonFor(operation.name) === null);
		const misfits = transforms.filter((operation) => reasonFor(operation.name) !== null);
		// Group only when there is something to group by, so an ungrouped list is never labelled as
		// having been checked.
		const grouped = misfits.length > 0;
		return [
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
		];
	}

	/// For this chain's rails.
	const choices = $derived(choicesFor(fits));
	/// For an empty branch of a node in this chain, which is inside that branch.
	const branchChoices = $derived(choicesFor(branchFits));
</script>

<!-- A graph that is off is a chain that is not running, whatever each node's own eye says - the
     same reading as a hidden layer whose filters keep their switches. -->
<div class="chain" class:off={kind === 'top' && !enabled}>
	<!-- **The start of a branch** takes a transform too: it begins from the tiles arriving at its
	     operation, where a chain that reads has to begin with its read. -->
	{#if kind === 'branch' && onAddOperationBefore && transforms.length > 0 && placed.length > 0}
		<div class="rail" class:inactive={!enabled} data-testid="branch-start">
			<span class="stem" aria-hidden="true"></span>
			<Picker
				label="+ operation…"
				placeholder="Filter operations…"
				items={choices}
				onPick={(name) => onAddOperationBefore(placed[0].node.nameSpan, name)}
			/>
		</div>
	{/if}

	{#each placed as { node, here, on }, index (index)}
		{@const field = sourcesOf.get(node.name)}
		{@const slots = node.sources.length > 0 || field ? slotsOf(node, field) : []}

		{#snippet box()}
			<div class="slots">
				{#each slots as slot (slot.key)}
					{@const key = `${index}:${slot.index}`}
					{@const shut = folded.has(key)}
					{@const id = `${uid}-${index}-${slot.index}`}
					<section class="slot" aria-label={slot.name || 'another source'}>
						{#if slot.source}
							{@const trouble = problemsIn(slot.source)}
							<button
								type="button"
								class="disclosure slot-name"
								aria-expanded={!shut}
								aria-controls={id}
								onclick={() => (shut ? folded.delete(key) : folded.add(key))}
							>
								<span class="chevron" class:open={!shut} aria-hidden="true"><Icon name="chevron" size="1em" /></span>
								<span class="name">{slot.name}</span>
								{#if shut}
									<span class="summary">{summaryOf(slot.source)}</span>
									<span class="count">{slot.source.nodes.length}</span>
									{#if trouble.length > 0}
										<span
											class="problem"
											role="img"
											aria-label={trouble.map((p) => p.message).join('\n')}
											title={trouble.map((p) => p.message).join('\n')}><Icon name="problem" size="1em" /></span
										>
									{/if}
								{:else if slot.caption}
									<span class="caption">{slot.caption}</span>
								{/if}
							</button>
						{:else if slot.name}
							<p class="slot-name">
								<span class="name">{slot.name}</span>
								{#if slot.caption}<span class="caption">{slot.caption}</span>{/if}
							</p>
						{/if}
						{#if slot.source && !shut}
							<div {id}>
								<NodeChain
									pipeline={slot.source}
									path={[...here, slot.index]}
									kind={field?.branches ? 'branch' : 'source'}
									{disabled}
									{enabled}
									{operations}
									{properties}
									fits={field?.branches ? branchFits : fits}
									{branchFits}
									{suggestions}
									{problems}
									{onToggle}
									{onCommit}
									{onRemove}
									{onSet}
									{onRemoveNode}
									{onAddOperation}
									{onAddOperationBefore}
									{onAddSource}
								/>
							</div>
						{:else if !slot.source}
							<!-- An empty slot says what it does while empty, and is where it is filled. -->
							<div class="vacant" class:next={slot.fill === 'read'}>
								{#if slot.fill === 'read' && onAddSource && reads.length > 0}
									<Picker
										label="+ source…"
										placeholder="Filter operations…"
										items={reads}
										onPick={(name) => onAddSource(node.nameSpan, name)}
									/>
								{/if}
								<span class="says">{slot.empty}</span>
								{#if slot.fill === 'transform' && onAddSource && transforms.length > 0}
									<Picker
										label="+ operation…"
										placeholder="Filter operations…"
										items={branchChoices}
										onPick={(name) => onAddSource(node.nameSpan, name)}
									/>
								{/if}
							</div>
						{/if}
					</section>
				{/each}
			</div>
		{/snippet}

		<div class="row" class:inactive={!on}>
			<NodeCard
				{node}
				path={here}
				{on}
				isHead={isChainHead(here)}
				{operations}
				{properties}
				suggestions={suggestions[here.join('.')] ?? {}}
				problems={problemsAt(node, problems)}
				{onToggle}
				{onCommit}
				{onRemove}
				{onSet}
				{onRemoveNode}
				inside={slots.length > 0 ? box : undefined}
			/>
		</div>

		{#if index < placed.length - 1 || transforms.length > 0}
			<!-- **The pipe does not go dark under a switched-off node** ([Q49]), because the tiles
			     still flow: they skip it. What is dark is the node itself. The whole chain goes dark
			     with the graph, which is the one case where nothing is flowing at all. -->
			<div class="rail" class:inactive={!enabled}>
				<span class="stem" aria-hidden="true"></span>
				{#if transforms.length > 0}
					<Picker
						label="+ operation…"
						placeholder="Filter operations…"
						items={choices}
						onPick={(name) => onAddOperation(node.nameSpan, name)}
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
	}

	/* The rail's content box matches the row's, so a percentage inside it is a percentage of the
	   node above - which is what lets the stem sit under the node's middle rather than near its
	   left edge. */
	.rail {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--space-5);
	}

	/* **The slots are inside the box**, on the chrome, so they read as the node's own and the
	   chain inside each as a chain of its own. */
	.slots {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3) var(--space-3);
	}

	.slot {
		min-width: 0;
		padding: var(--space-2) var(--space-3) var(--space-3);
		border-radius: var(--radius);
		background: var(--chrome);
	}

	.slot-name {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		margin: 0 0 var(--space-1);
		font-size: var(--text-xs);
		color: var(--ink-2);

		.name {
			flex: none;
			color: var(--ink);
			font-weight: 700;
			text-transform: uppercase;
			letter-spacing: 0.07em;
		}
	}

	/* The slot's heading as a disclosure: the whole line is the control, as `Group`'s is. */
	.disclosure {
		width: 100%;
		min-width: 0;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: var(--text-xs);
		text-align: left;
		color: var(--ink-2);
		align-items: center;

		/* Folded, the line is the chain: its operations by name, cut short at the edge rather than
		   wrapping, since a summary that took three lines would not be one. */
		.summary {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			white-space: nowrap;
			text-overflow: ellipsis;
			font-family: var(--font-mono);
		}

		.count {
			flex: none;
			font-variant-numeric: tabular-nums;
		}

		.problem {
			flex: none;
			color: var(--error);
		}
	}

	/* An empty slot is drawn as a place, dashed, rather than as nothing - what it does while empty
	   is part of what the node does. */
	.vacant {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border: 1.5px dashed color-mix(in srgb, var(--ink-2) 55%, transparent);
		border-radius: var(--radius);

		&.next {
			flex-direction: row;
			align-items: center;
		}

		.says {
			font-size: var(--text-xs);
			color: var(--ink-2);
		}
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
