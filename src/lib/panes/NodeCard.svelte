<script lang="ts">
	import type { FieldInfo, OperationInfo, Span, VplNode, VplProperty } from '../ipc/commands';
	import HelpTrigger from '../components/common/HelpTrigger.svelte';
	import ArgumentField from './ArgumentField.svelte';

	// One node in the chain (S2.13, [Q32]).
	//
	// **The selected node is the form.** It shows one row per argument; every other node is only its
	// name. Six operations then fit in the height four used to take, which is what makes a
	// ten-node chain workable in a sidebar — and it is why there is no Parameters pane any more.
	//
	// **The head node is the exception** and keeps its filename: a graph reading `osm.versatiles` is
	// a different thing from one reading `berlin.mbtiles`, and that is worth a line. No other node
	// earns one.
	//
	// Nothing here is written per operation. The controls come from `field_meta` by way of the core,
	// so an operation added upstream gets a working form with no change in Studio (C2).
	let {
		node,
		path,
		selected,
		pinned,
		isHead,
		operations = [],
		properties = [],
		suggestions = {},
		onSelect,
		onPin,
		onCommit,
		onRemove,
		onSet,
		onRemoveNode
	}: {
		node: VplNode;
		path: number[];
		selected: boolean;
		/** Whether the map is showing *this* node. Independent of selection ([Q32]). */
		pinned: boolean;
		/** A chain must start with a `from_*` node, so the first one is not deletable. */
		isHead: boolean;
		operations?: OperationInfo[];
		/** Property names the pipeline produces, for list fields (S3.3). */
		properties?: string[];
		/** Per-field values read from what the node points at — a CSV's own columns (S3.4). */
		suggestions?: Record<string, string[]>;
		onSelect: (path: number[], span: Span) => void;
		onPin: (path: number[]) => void;
		onCommit: (span: Span, value: string) => void;
		onRemove: (span: Span) => void;
		onSet: (key: string, values: string[]) => void;
		onRemoveNode: (span: Span) => void;
	} = $props();

	const meta = $derived(operations.find((operation) => operation.name === node.name));
	const fieldOf = (key: string): FieldInfo | undefined => meta?.fields.find((f) => f.name === key);

	/** Parameters the operation accepts and this node has not set. Sources are not parameters. */
	const unset = $derived(
		(meta?.fields ?? []).filter((f) => !f.sources && !node.properties.some((p) => p.key === f.name))
	);

	/// Required parameters with no value yet — **always shown**, empty.
	///
	/// Hiding them in `＋ parameter…` made a form that conceals its own required fields and sends you
	/// hunting for them. Shown and empty, "required" needs no symbol: the field is simply there, and
	/// waiting. Most operations add no rows this way — 18 of 29 have no required parameter at all,
	/// and only three have more than one.
	const missing = $derived(unset.filter((field) => field.required));
	/// What `＋ parameter…` offers: the optional ones, since the required are already on screen.
	const addable = $derived(unset.filter((field) => !field.required));

	/// Writes a required parameter once it has a value. Empty stays empty — writing `lon_column=''`
	/// produces VPL that parses and then fails when the pipeline builds.
	function commitRequired(key: string, raw: string) {
		const value = raw.trim();
		if (value) onSet(key, control(key)?.kind === 'list' ? parts(value) : [value]);
	}

	/// What a collapsed head node shows. The most identifying value it has, and nothing else.
	const headline = $derived.by(() => {
		if (!isHead) return null;
		const value = node.properties.find((property) => property.key === 'filename')?.value;
		return value?.kind === 'single' ? value.value : null;
	});

	function text(property: VplProperty): string {
		return property.value.kind === 'single'
			? property.value.value
			: property.value.items.map((item) => item.value).join(', ');
	}

	const isArray = (property: VplProperty) => property.value.kind === 'array';
	const parts = (raw: string) =>
		raw
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean);

	/// What this field could be set to — whichever end of the pipeline could answer.
	const options = (key: string, control: FieldInfo['control'] | undefined): string[] =>
		suggestions[key] ?? (control?.kind === 'list' ? properties : []);

	function commit(property: VplProperty, raw: string) {
		if (raw === text(property)) return;
		const control = fieldOf(property.key)?.control;
		if (raw.trim() === '') onRemove(property.span);
		else if (control?.kind === 'list' || control?.kind === 'numbers' || isArray(property)) {
			onSet(property.key, parts(raw));
		} else onCommit(property.value.span, raw);
	}

	let adding = $state('');

	/// What a parameter *is*, from `field_meta` — type, bounds, whether it is required.
	///
	/// Assembled here rather than in the popover, which stays ignorant of VPL: this is the one
	/// place that knows a `Control` from a `FieldInfo`, and the style editor will want the same
	/// popover for entirely different content.
	function summarise(field: FieldInfo): string {
		const control = field.control;
		let type: string;
		switch (control.kind) {
			case 'number':
				type = control.integer ? 'whole number' : 'number';
				if (control.min !== null && control.max !== null) type += ` ${control.min}–${control.max}`;
				else if (control.min !== null) type += ` from ${control.min}`;
				else if (control.max !== null) type += ` up to ${control.max}`;
				break;
			case 'boolean':
				type = 'true or false';
				break;
			case 'choice':
				type = `one of ${control.options.join(', ')}`;
				break;
			case 'list':
				type = 'a list, comma separated';
				break;
			case 'numbers':
				type = `${control.count} numbers`;
				break;
			default:
				type = 'text';
		}
		return `${type} · ${field.required ? 'required' : 'optional'}`;
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
		const control = fieldOf(key)?.control;
		if (control?.kind === 'boolean') onSet(key, ['true']);
		else if (control?.kind === 'choice' && control.options.length > 0) onSet(key, [control.options[0]]);
		else pending = key;
	}

	/// Commits the pending parameter, or drops it when nothing was typed.
	function commitPending(raw: string) {
		const key = pending;
		pending = null;
		if (!key) return;
		const value = raw.trim();
		if (value) onSet(key, control(key)?.kind === 'list' ? parts(value) : [value]);
	}

	const control = (key: string) => fieldOf(key)?.control;
</script>

<div class="node" class:selected>
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

		<button
			type="button"
			class="nm truncate"
			title={meta?.summary || node.name}
			onclick={() => onSelect(path, node.nameSpan)}
		>
			{node.name}
		</button>

		{#if selected && meta}
			<!-- The operation's own help. A `?` rather than the name, because the name's click is
			     already selection — and hovering names would flash a popover per node while scanning a
			     chain ([Q33]). -->
			<HelpTrigger content={operationHelp(meta)} />
		{/if}

		{#if !selected && headline}
			<span class="headline truncate" title={headline}>{headline}</span>
		{/if}

		{#if selected && !isHead}
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

	{#if selected}
		<dl class="args">
			<!-- Set parameters. -->
			{#each node.properties as property (property.keySpan.start)}
				{@const field = fieldOf(property.key)}
				<div class="arg">
					<dt>
						<span class="k truncate">{property.key}</span>
						{#if field}<HelpTrigger content={contentFor(property.key, field)} />{/if}
					</dt>
					<dd>
						{#if field}
							<ArgumentField
								{field}
								value={text(property)}
								suggestions={options(property.key, field.control)}
								onCommit={(raw) => commit(property, raw)}
							/>
						{:else}
							<!-- A parameter this operation does not declare. It still has to be editable —
							     the diagnostic says it is wrong, and the fix is usually to correct the value
							     rather than to delete the row. -->
							<input
								type="text"
								value={text(property)}
								onblur={(event) => commit(property, event.currentTarget.value)}
							/>
						{/if}
					</dd>
					<!-- No × on a required parameter: you cannot remove what must exist, and the missing
					     control is how that rule is said ([Q33]) — the same way the head node has no ×. -->
					{#if !field?.required}
						<button
							type="button"
							class="drop"
							title="Remove {property.key}"
							aria-label="Remove {property.key}"
							onclick={() => onRemove(property.span)}
						>
							×
						</button>
					{/if}
				</div>
			{/each}

			<!-- Required and not yet set. Always shown, so "required" needs no symbol: the field is
			     simply there, and empty ([Q33]). No × — you cannot remove what must exist. -->
			{#each missing as field (field.name)}
				<div class="arg">
					<dt>
						<span class="k truncate">{field.name}</span>
						<HelpTrigger content={contentFor(field.name, field)} />
					</dt>
					<dd>
						<ArgumentField
							{field}
							value=""
							suggestions={options(field.name, field.control)}
							placeholder="needs a value"
							onCommit={(raw) => commitRequired(field.name, raw)}
						/>
					</dd>
				</div>
			{/each}

			<!-- Chosen from ＋ parameter… and not yet given a value. Real in the pane and unknown to
			     the document until there is something to record: `filename=''` parses and then fails
			     when the pipeline is built. -->
			{#if pending}
				{@const field = fieldOf(pending)}
				<div class="arg pending">
					<dt><span class="k truncate">{pending}</span></dt>
					<dd>
						{#if field}
							<ArgumentField
								{field}
								value=""
								suggestions={options(pending, field.control)}
								placeholder="a value"
								onCommit={commitPending}
							/>
						{/if}
					</dd>
					<button type="button" class="drop" aria-label="Cancel" onclick={() => (pending = null)}>×</button>
				</div>
			{/if}

			{#if addable.length > 0}
				<label class="add">
					<span class="visually-hidden">Add a parameter</span>
					<select
						bind:value={adding}
						onchange={() => {
							if (!adding) return;
							addParameter(adding);
							adding = '';
						}}
					>
						<option value="">＋ parameter…</option>
						{#each addable as field (field.name)}
							<option value={field.name} title={field.doc}>{field.name}</option>
						{/each}
					</select>
				</label>
			{/if}
		</dl>
	{/if}
</div>

<style>
	/* No `overflow: hidden` here, deliberately: the `?` documentation is positioned and would be
	   clipped by it. The title rounds its own top corners instead, which is the only thing the
	   clipping was for. */
	.node {
		min-width: 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
	}
	.node.selected {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.title {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		padding: var(--space-2) var(--space-3);
	}
	.node.selected .title {
		background: var(--chrome);
		border-bottom: 1px solid var(--rule);
		border-radius: var(--radius) var(--radius) 0 0;
	}
	.eye {
		flex: none;
		width: 14px;
		height: 14px;
		padding: 0;
		border: 0;
		background: none;
		color: var(--ink-2);
	}
	.eye.on {
		color: var(--accent);
	}
	.eye svg {
		width: 100%;
		height: 100%;
		display: block;
	}
	.nm {
		flex: none;
		max-width: 100%;
		border: 0;
		background: none;
		padding: 0;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		font-weight: 600;
		color: inherit;
		text-align: left;
	}
	/* Only the head node has one, and only when collapsed. */
	.headline {
		flex: 1;
		min-width: 0;
		text-align: left;
		direction: rtl;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--vpl-value);
	}
	.drop {
		flex: none;
		margin-left: auto;
		border: 0;
		background: none;
		color: var(--ink-2);
		padding: 0 var(--space-1);
	}
	.drop:hover {
		color: var(--error);
	}

	.args {
		margin: 0;
		display: flex;
		flex-direction: column;
		position: relative;
	}
	.arg {
		display: grid;
		grid-template-columns: 6.5rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		min-width: 0;
		padding: var(--space-1) var(--space-3);
	}
	.arg + .arg {
		border-top: 1px solid color-mix(in srgb, var(--rule) 60%, transparent);
	}
	dt {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
	dd {
		margin: 0;
		min-width: 0;
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
	.arg.pending {
		background: color-mix(in srgb, var(--accent) 7%, transparent);
	}
	.add {
		padding: var(--space-1) var(--space-3) var(--space-2);
	}
	.add select {
		font-size: var(--text-xs);
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
