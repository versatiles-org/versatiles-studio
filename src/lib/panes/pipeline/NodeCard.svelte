<script lang="ts">
	import type { FieldInfo, OperationInfo, Span, VplNode, VplProperty } from '../../ipc/commands';
	import {
		addableFields,
		editFor,
		fieldOf,
		missingFields,
		optionsFor,
		requiredEdit,
		summarise,
		unsetFields,
		valueText
	} from './node-fields';
	import HelpTrigger from '../../common/HelpTrigger.svelte';
	import NodeArgument from './NodeArgument.svelte';
	import Picker from '../../common/Picker.svelte';

	// One node in the chain (S2.13, [Q32]).
	//
	// **A node is its form.** One row per argument, and the arguments are the node — which is why
	// there is no Parameters pane any more ([Q32]).
	//
	// **Nothing folds.** Every node shows its parameters, whether it is selected or not. The rule used
	// to be that only the selected node did — six operations in the height four took — but the cost
	// was that clicking down a chain made every node in it change height, and a list that reshuffles
	// under the pointer is harder to read than a long one. The pane scrolls; that is what it is for.
	//
	// What still follows the selection is *adding*: `＋ parameter…` and the row for a parameter being
	// typed belong to the node being worked on, and one per node would be a column of invitations.
	//
	// Nothing here is written per operation. The controls come from `field_meta` by way of the core,
	// so an operation added upstream gets a working form with no change in Studio (C2).
	let {
		node,
		path,
		pinned,
		isHead,
		operations = [],
		properties = [],
		suggestions = {},
		onPin,
		onCommit,
		onRemove,
		onSet,
		onRemoveNode
	}: {
		node: VplNode;
		path: number[];
		/** Whether the map is showing *this* node. Independent of selection ([Q32]). */
		pinned: boolean;
		/** Whether this is the node the chain starts with — the one node with no `×`, because a
		 *  chain must begin with a `from_*` node ([Q32]). A read node nested in a composite is not
		 *  this, and may be removed. */
		isHead: boolean;
		operations?: OperationInfo[];
		/** Property names the pipeline produces, for list fields (S3.3). */
		properties?: string[];
		/** Per-field values read from what the node points at — a CSV's own columns (S3.4). */
		suggestions?: Record<string, string[]>;
		onPin: (path: number[]) => void;
		onCommit: (span: Span, value: string) => void;
		onRemove: (span: Span) => void;
		/**
		 * Sets a parameter on **this** node.
		 *
		 * The node's own span goes with it. Before every node showed its parameters, this could be
		 * bound to the selected node's span and be right by construction; now that any node's form
		 * can be typed into, being right by construction means saying which node.
		 */
		onSet: (span: Span, key: string, values: string[]) => void;
		onRemoveNode: (span: Span) => void;
	} = $props();

	const meta = $derived(operations.find((operation) => operation.name === node.name));
	const field = (key: string): FieldInfo | undefined => fieldOf(meta?.fields ?? [], key);

	/** Parameters the operation accepts and this node has not set. Sources are not parameters. */
	const unset = $derived(unsetFields(meta?.fields ?? [], node.properties));

	/// Required parameters with no value yet — **always shown**, empty.
	///
	/// Hiding them in `＋ parameter…` made a form that conceals its own required fields and sends you
	/// hunting for them. Shown and empty, "required" needs no symbol: the field is simply there, and
	/// waiting. Most operations add no rows this way — 18 of 29 have no required parameter at all,
	/// and only three have more than one.
	const missing = $derived(missingFields(unset));
	/// What `＋ parameter…` offers: the optional ones, since the required are already on screen.
	const addable = $derived(addableFields(unset));

	/// What this field could be set to — whichever end of the pipeline could answer.
	const options = (key: string, control: FieldInfo['control'] | undefined): string[] =>
		optionsFor(suggestions, properties, key, control);

	function commit(property: VplProperty, raw: string) {
		const edit = editFor(property, raw, field(property.key)?.control);
		if (edit.kind === 'remove') onRemove(property.span);
		else if (edit.kind === 'parts') onSet(node.nameSpan, property.key, edit.values);
		else if (edit.kind === 'value') onCommit(property.value.span, edit.value);
	}

	/// Writes a required parameter once it has a value.
	function commitRequired(key: string, raw: string) {
		const values = requiredEdit(raw, control(key));
		if (values) onSet(node.nameSpan, key, values);
	}

	/// Help for the operation itself.
	///
	/// The summary, not the whole doc: four fifths of that is a prose copy of the parameter list,
	/// which the rows below already are — and editable. The `kind` is worth saying because nothing
	/// else in the form does.
	const operationHelp = (operation: OperationInfo) => ({
		title: operation.name,
		summary: operation.kind === 'read' ? 'reads a source' : 'transforms tiles',
		body: operation.summary
	});

	const contentFor = (key: string, field: FieldInfo) => ({
		title: key,
		summary: summarise(field),
		body: field.doc
	});

	/// A parameter chosen from `＋ parameter…` that has no value yet.
	///
	/// **Not written to the document until it has one.** Writing `filename=''` produces VPL that
	/// parses and then fails when the pipeline is built — a job error for something the user is
	/// halfway through typing. So the row exists here and the document does not know about it until
	/// there is something to know.
	let pending = $state<string | null>(null);

	/// Adds a parameter, immediately when its value is not in doubt and as a pending row otherwise.
	///
	/// A boolean has two values and a choice has a list, so picking one of those *is* the value.
	/// Everything else needs typing, and until it is typed there is nothing worth recording.
	function addParameter(key: string) {
		const control = field(key)?.control;
		if (control?.kind === 'boolean') onSet(node.nameSpan, key, ['true']);
		else if (control?.kind === 'choice' && control.options.length > 0) onSet(node.nameSpan, key, [control.options[0]]);
		else pending = key;
	}

	/// Commits the pending parameter, or drops it when nothing was typed.
	function commitPending(raw: string) {
		const key = pending;
		pending = null;
		if (!key) return;
		const values = requiredEdit(raw, control(key));
		if (values) onSet(node.nameSpan, key, values);
	}

	const control = (key: string) => field(key)?.control;
</script>

<div class="node">
	<div class="title">
		<button
			type="button"
			class="eye"
			class:on={pinned}
			title={pinned ? 'Stop showing this on the map' : 'Show this node on the map'}
			aria-pressed={pinned}
			aria-label={pinned ? 'Stop previewing' : 'Preview this node'}
			onclick={() => onPin(path)}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true">
				<path
					d="M1 8s2.6-4.2 7-4.2S15 8 15 8s-2.6 4.2-7 4.2S1 8 1 8Z"
					fill="none"
					stroke="currentColor"
					stroke-width="1.3"
				/>
				{#if pinned}
					<circle cx="8" cy="8" r="2.4" fill="currentColor" />
				{:else}
					<circle cx="8" cy="8" r="1.9" fill="none" stroke="currentColor" stroke-width="1.3" />
				{/if}
			</svg>
		</button>

		<!-- A name, not a control. Clicking a node used to select it, and selection used to decide
		     which node showed its form; now every node shows one and there is nothing left for the
		     click to do. A button that does nothing still says it does something — the cursor, the
		     focus ring, the press — so it stops being one. -->
		<span class="nm truncate" title={meta?.summary || node.name}>{node.name}</span>

		{#if meta}
			<!-- The operation's own help. A `?` rather than the name, because the name's click is
			     already selection — and hovering names would flash a popover per node while scanning a
			     chain ([Q33]). -->
			<HelpTrigger content={operationHelp(meta)} />
		{/if}

		{#if !isHead}
			<button
				type="button"
				class="drop"
				title="Remove this operation"
				aria-label="Remove"
				onclick={() => onRemoveNode(node.nameSpan)}
			>
				×
			</button>
		{/if}
	</div>

	<dl class="args">
		<!-- Set parameters. A required one has no ×: you cannot remove what must exist, which is
			     how that rule is said ([Q33]) — the same way the head node has no ×. -->
		{#each node.properties as property (property.keySpan.start)}
			{@const field = fieldOf(meta?.fields ?? [], property.key)}
			<NodeArgument
				name={property.key}
				{field}
				value={valueText(property)}
				help={field ? contentFor(property.key, field) : undefined}
				suggestions={options(property.key, field?.control)}
				onCommit={(raw) => commit(property, raw)}
				onRemove={field?.required ? undefined : () => onRemove(property.span)}
			/>
		{/each}

		<!-- Required and not yet set. Always shown, so "required" needs no symbol: the field is
			     simply there, and empty ([Q33]). -->
		{#each missing as field (field.name)}
			<NodeArgument
				name={field.name}
				{field}
				value=""
				help={contentFor(field.name, field)}
				suggestions={options(field.name, field.control)}
				placeholder="needs a value"
				onCommit={(raw) => commitRequired(field.name, raw)}
			/>
		{/each}

		<!-- Chosen from ＋ parameter… and not yet given a value. Real in the pane and unknown to
			     the document until there is something to record: `filename=''` parses and then fails
			     when the pipeline is built. -->
		{#if pending}
			{@const field = fieldOf(meta?.fields ?? [], pending)}
			<NodeArgument
				name={pending}
				{field}
				value=""
				help={field ? contentFor(pending, field) : undefined}
				suggestions={options(pending, field?.control)}
				placeholder="a value"
				tentative
				onCommit={commitPending}
				onRemove={() => (pending = null)}
				removeLabel="Cancel"
			/>
		{/if}

		{#if addable.length > 0}
			<div class="add">
				<!-- The documentation was a `title` the platform showed at its own discretion, and
					     for a parameter list that is where the difference between two similarly named
					     fields lives. Here it is a line under the name. -->
				<Picker
					label="＋ parameter…"
					placeholder="Filter parameters…"
					items={addable.map((field) => ({
						value: field.name,
						description: field.doc
					}))}
					onPick={addParameter}
				/>
			</div>
		{/if}
	</dl>
</div>

<style>
	/* No `overflow: hidden` here, deliberately: the `?` documentation is positioned and would be
	   clipped by it. The title rounds its own top corners instead, which is the only thing the
	   clipping was for. */
	.node {
		min-width: 0;
		/* The same line as the connector between nodes, because they are the same object: a node is
		   a widening of the pipe, not a card that happens to sit near one. */
		border: var(--pipe-width) solid var(--pipe);
		border-radius: var(--radius);
		background: var(--surface);
	}

	/* The header sits on its own ground, above the arguments. This used to belong to the selected
	   node, because it was the only one that had arguments under it to be separated from. */
	.title {
		background: var(--chrome);
		border-bottom: 1px solid var(--rule);
		border-radius: var(--radius) var(--radius) 0 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		padding: var(--space-2) var(--space-3);
	}

	.eye {
		flex: none;
		width: 14px;
		height: 14px;
		color: var(--ink-2);

		&.on {
			color: var(--accent);
		}

		svg {
			width: 100%;
			height: 100%;
			display: block;
		}
	}

	.nm {
		flex: none;
		max-width: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		font-weight: 600;
		text-align: left;
	}

	/* Only the head node has one, and only when collapsed. */

	/* At the right edge, where the parameter rows put theirs — those sit in a grid column of their
	   own, so the two ×s do the same job one level apart and now read the same way. `margin-left`
	   rather than a spacer, so it lands last whatever precedes it: a `?` when the operation has
	   documentation, the name when it does not.
	   
	   It had no rule at all before, which is also why it wore the title's colour rather than the
	   quieter one every other × here has. */
	.drop {
		flex: none;
		margin-left: auto;
		padding: 0 var(--space-1);
		color: var(--ink-2);

		&:hover {
			color: var(--error);
		}
	}

	/* The rule between two arguments belongs to neither of them: it is the relationship. Svelte
	   scopes `.arg` per component, so reaching the child's class is the only way to say it. */

	.args {
		margin: 0;
		display: flex;
		flex-direction: column;
		position: relative;

		:global(.arg + .arg) {
			border-top: 1px solid color-mix(in srgb, var(--rule) 60%, transparent);
		}
	}

	/* Right-aligned so the digits line up down the column, and tabular so they do not shuffle as
	   the value changes. */
	/* A path is identified by its end. Truncated from the right, every file in a folder shows the
	   same `/Users/someone/projects/…` and nothing that tells them apart.
	   
	   Two mechanisms, because an input and a span truncate differently: an input scrolls its value,
	   so `text-align: right` reveals the end; a span's ellipsis sits at the end of the line whatever
	   the alignment, so it needs `direction: rtl` to clip from the other side. The path itself still
	   reads left-to-right, because its characters are strong LTR. */
	/* Sized from the type scale rather than to a pixel: a `?` small enough to look right at 9px is
	   also small enough to miss with a trackpad. */
	/* Overlays the rows below rather than displacing them: help that reflows what you were reading
	   moves the target while you aim at it, and worst on the long chains this design is for. */
	/* Marked as not-yet-real: it is in the pane and not in the document until it has a value. */
	.add {
		padding: var(--space-1) var(--space-3) var(--space-2);
	}
</style>
