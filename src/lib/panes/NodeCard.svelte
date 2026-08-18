<script lang="ts">
	import type { FieldInfo, OperationInfo, Span, VplNode, VplProperty } from '../ipc/commands';

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

	/// Whether a value is a path, and so should be read from its end.
	///
	/// By key rather than by looking at the value: an empty `filename` is still a path, and a
	/// `layer_name` that happens to contain a slash is not.
	const isPath = (key: string) => key === 'filename' || key.endsWith('_file') || key.endsWith('_path');

	const chosen = (property: VplProperty) => parts(text(property));

	function toggle(property: VplProperty, name: string) {
		const current = chosen(property);
		const next = current.includes(name) ? current.filter((each) => each !== name) : [...current, name];
		if (next.length === 0) onRemove(property.span);
		else onSet(property.key, next);
	}

	function commit(property: VplProperty, raw: string) {
		if (raw === text(property)) return;
		const control = fieldOf(property.key)?.control;
		if (raw.trim() === '') onRemove(property.span);
		else if (control?.kind === 'list' || control?.kind === 'numbers' || isArray(property)) {
			onSet(property.key, parts(raw));
		} else onCommit(property.value.span, raw);
	}

	/// Which argument's documentation is open. One at a time; it overlays rather than pushes, so
	/// reading about a parameter never moves the chain under the cursor.
	let helping = $state<string | null>(null);
	let adding = $state('');

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
			title={meta?.doc || node.name}
			onclick={() => onSelect(path, node.nameSpan)}
		>
			{node.name}
		</button>

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
			{#each node.properties as property (property.keySpan.start)}
				{@const field = fieldOf(property.key)}
				{@const control = field?.control}
				{@const choices = options(property.key, control)}
				<div class="arg">
					<dt>
						<span class="k truncate">{property.key}</span>
						{#if field?.required}<span class="req" title="required">*</span>{/if}
						{#if field?.doc}
							<button
								type="button"
								class="help"
								class:open={helping === property.key}
								title={field.doc}
								aria-expanded={helping === property.key}
								aria-label="What is {property.key}?"
								onclick={() => (helping = helping === property.key ? null : property.key)}
							>
								?
							</button>
						{/if}
					</dt>
					<dd>
						{#if control?.kind === 'choice'}
							<select value={text(property)} onchange={(event) => commit(property, event.currentTarget.value)}>
								{#each control.options as option (option)}<option value={option}>{option}</option>{/each}
							</select>
						{:else if control?.kind === 'boolean'}
							<input
								type="checkbox"
								checked={text(property) === 'true'}
								onchange={(event) => commit(property, String(event.currentTarget.checked))}
							/>
						{:else if control?.kind === 'number'}
							<input
								type="number"
								value={text(property)}
								step={control.integer ? 1 : 'any'}
								min={control.min ?? undefined}
								max={control.max ?? undefined}
								onblur={(event) => commit(property, event.currentTarget.value)}
								onkeydown={(event) => {
									if (event.key === 'Enter') event.currentTarget.blur();
								}}
							/>
						{:else}
							<input
								type="text"
								class:path={isPath(property.key)}
								value={text(property)}
								title={text(property)}
								list={choices.length > 0 ? `s-${node.nameSpan.start}-${property.key}` : undefined}
								placeholder={control?.kind === 'numbers' ? `${control.count} numbers` : ''}
								spellcheck="false"
								autocomplete="off"
								onblur={(event) => commit(property, event.currentTarget.value)}
								onkeydown={(event) => {
									if (event.key === 'Enter') event.currentTarget.blur();
									if (event.key === 'Escape') {
										event.currentTarget.value = text(property);
										event.currentTarget.blur();
									}
								}}
							/>
							{#if choices.length > 0}
								<datalist id="s-{node.nameSpan.start}-{property.key}">
									{#each choices as value (value)}<option {value}></option>{/each}
								</datalist>
							{/if}
						{/if}
					</dd>
					<button
						type="button"
						class="drop"
						title="Remove {property.key}"
						aria-label="Remove {property.key}"
						onclick={() => onRemove(property.span)}
					>
						×
					</button>
					{#if control?.kind === 'list' && choices.length > 0}
						{@const picked = chosen(property)}
						<div class="chips">
							{#each choices as name (name)}
								<button
									type="button"
									class="chip"
									class:on={picked.includes(name)}
									aria-pressed={picked.includes(name)}
									onclick={() => toggle(property, name)}
								>
									{name}
								</button>
							{/each}
						</div>
					{/if}
				</div>
				{#if helping === property.key && field?.doc}
					<p class="doc"><b>{property.key}</b> — {field.doc}</p>
				{/if}
			{/each}

			{#if pending}
				{@const field = fieldOf(pending)}
				<div class="arg pending">
					<dt>
						<span class="k truncate">{pending}</span>
						{#if field?.required}<span class="req" title="required">*</span>{/if}
					</dt>
					<dd>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							type="text"
							autofocus
							placeholder={field?.control.kind === 'number' ? 'a number' : 'a value'}
							spellcheck="false"
							autocomplete="off"
							aria-label="Value for {pending}"
							onblur={(event) => commitPending(event.currentTarget.value)}
							onkeydown={(event) => {
								if (event.key === 'Enter') event.currentTarget.blur();
								if (event.key === 'Escape') {
									pending = null;
								}
							}}
						/>
					</dd>
					<button type="button" class="drop" aria-label="Cancel" onclick={() => (pending = null)}>×</button>
				</div>
			{/if}

			{#if unset.length > 0}
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
						{#each unset as field (field.name)}
							<option value={field.name} title={field.doc}>{field.name}{field.required ? ' *' : ''}</option>
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
		border-radius: calc(var(--radius) - 1px) calc(var(--radius) - 1px) 0 0;
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
	dd input[type='text'],
	dd input[type='number'],
	dd select {
		width: 100%;
		min-width: 0;
		font-size: var(--text-xs);
	}
	/* Right-aligned so the digits line up down the column, and tabular so they do not shuffle as
	   the value changes. */
	dd input[type='number'] {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	/* A path is identified by its end — the filename — and truncated from the left the value would
	   show `/Users/someone/projects/…` for every file in a folder. Right-aligning shows the part
	   that differs. */
	dd input.path,
	.headline {
		text-align: right;
	}
	.req {
		color: var(--error);
		font-weight: 700;
	}
	/* Sized from the type scale rather than to a pixel: a `?` small enough to look right at 9px is
	   also small enough to miss with a trackpad. */
	.help {
		flex: none;
		display: grid;
		place-items: center;
		width: 1.15em;
		height: 1.15em;
		padding: 0;
		border: 1px solid var(--ink-2);
		border-radius: 50%;
		background: none;
		color: var(--ink-2);
		font-size: var(--text-xs);
		line-height: 1;
		opacity: 0.7;
	}
	.help.open,
	.help:hover {
		opacity: 1;
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-ink);
	}
	/* Overlays the rows below rather than displacing them: help that reflows what you were reading
	   moves the target while you aim at it, and worst on the long chains this design is for. */
	.doc {
		position: absolute;
		left: var(--space-3);
		right: var(--space-3);
		z-index: 3;
		margin: 0;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--accent);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: var(--shadow);
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
	.doc b {
		font-family: var(--font-mono);
		color: var(--ink);
	}
	.chips {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.chip {
		padding: 0 var(--space-2);
		font-size: var(--text-xs);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--chrome);
		color: var(--ink-2);
	}
	.chip.on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
	}
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
