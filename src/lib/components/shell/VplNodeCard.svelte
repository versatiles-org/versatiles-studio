<script lang="ts">
	import type { FieldInfo, OperationInfo, Span, VplNode, VplProperty } from '../../ipc/commands';

	// One VPL node as a form (C2, S2.6).
	//
	// Nothing here is written per operation. The controls come from `field_meta` by way of the core,
	// which reads each parameter's Rust type and says what it is — so an operation added upstream
	// gets a working form with no change in Studio, and a hand-written UI per operation cannot rot.
	//
	// A field per parameter rather than one line of VPL, because values are routinely longer than
	// the pane is wide: a single string forces a choice between wrapping, which breaks the syntax
	// across lines, and scrolling, which hides the parameter names.
	let {
		node,
		operations = [],
		properties = [],
		onCommit,
		onRemove,
		onSet
	}: {
		node: VplNode;
		/** Every known operation. Empty until the one-off fetch lands; the form degrades to text. */
		operations?: OperationInfo[];
		/** Property names the pipeline is actually producing, probed from the preview (S3.3, E1).
		 *  Empty for raster output, and before the first build — a list field then behaves exactly
		 *  as it did, which is why this is suggestions rather than a closed set. */
		properties?: string[];
		/** Fired on blur, Enter or a choice — never per keystroke, which would reparse the document
		 *  on every character and fight the caret. */
		onCommit: (span: Span, value: string) => void;
		onRemove: (span: Span) => void;
		/** Sets a parameter by name, which is how a value with several parts and a parameter that is
		 *  not there yet are both written. */
		onSet: (key: string, values: string[]) => void;
	} = $props();

	const meta = $derived(operations.find((operation) => operation.name === node.name));
	const fieldOf = (key: string): FieldInfo | undefined => meta?.fields.find((f) => f.name === key);

	/** Parameters the operation accepts and this node has not set. Sources are not parameters. */
	const unset = $derived(
		(meta?.fields ?? []).filter((f) => !f.sources && !node.properties.some((p) => p.key === f.name))
	);

	function text(property: VplProperty): string {
		return property.value.kind === 'single'
			? property.value.value
			: property.value.items.map((item) => item.value).join(', ');
	}

	/** An array is replaced whole, so its edit spans the property rather than the value. */
	const isArray = (property: VplProperty) => property.value.kind === 'array';

	/** A list control is typed as a comma-separated line and stored as a VPL array. */
	const parts = (raw: string) =>
		raw
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean);

	/// The values a list field currently holds.
	const chosen = (property: VplProperty) => parts(text(property));

	/// Adds or removes one name from a list field.
	///
	/// This is E1's "map columns". `properties_include` takes property names that only the file can
	/// supply, and typing them from memory into a comma-separated box was the part of an import that
	/// meant opening the data in something else first.
	function toggle(property: VplProperty, name: string) {
		const current = chosen(property);
		const next = current.includes(name) ? current.filter((each) => each !== name) : [...current, name];
		if (next.length === 0) onRemove(property.span);
		else onSet(property.key, next);
	}

	function commit(property: VplProperty, raw: string) {
		if (raw === text(property)) return;
		const control = fieldOf(property.key)?.control;
		// An emptied field removes the parameter. VPL can express an empty value since 4.8.0, so this
		// is a decision about what a blank field *means* — for a filename or a layer name, nothing —
		// rather than the limitation it used to be.
		if (raw.trim() === '') onRemove(property.span);
		else if (control?.kind === 'list' || control?.kind === 'numbers' || isArray(property)) {
			onSet(property.key, parts(raw));
		} else onCommit(property.value.span, raw);
	}

	let adding = $state('');
</script>

<div class="node">
	<div class="head">
		<span class="name truncate" title={meta?.doc || node.name}>{node.name}</span>
		{#if meta}<span class="kind">{meta.kind}</span>{/if}
	</div>

	{#if node.properties.length === 0}
		<p class="none">no parameters set</p>
	{:else}
		<dl>
			{#each node.properties as property (property.keySpan.start)}
				{@const field = fieldOf(property.key)}
				{@const control = field?.control}
				<div class="row">
					<dt class="truncate" title={field?.doc || property.key}>
						{property.key}{#if field?.required}<span class="required" title="required">*</span>{/if}
					</dt>
					<dd>
						{#if control?.kind === 'choice'}
							<select value={text(property)} onchange={(event) => commit(property, event.currentTarget.value)}>
								{#each control.options as option (option)}
									<option value={option}>{option}</option>
								{/each}
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
								value={text(property)}
								title={text(property)}
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
						{/if}
						<!-- What the data actually contains, for the fields that name parts of it.
						     Chips rather than a multi-select: the set is small, the current value stays
						     readable in the field above, and anything not listed can still be typed —
						     a property that appears only outside the probed tile is missing from here,
						     not forbidden. -->
						{#if control?.kind === 'list' && properties.length > 0}
							{@const picked = chosen(property)}
							<div class="chips">
								{#each properties as name (name)}
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
					</dd>
				</div>
			{/each}
		</dl>
	{/if}

	<!-- Knowing what an operation accepts should not mean reading its documentation elsewhere. -->
	{#if unset.length > 0}
		<label class="add">
			<span class="visually-hidden">Add a parameter</span>
			<select
				bind:value={adding}
				onchange={() => {
					if (!adding) return;
					onSet(adding, [fieldOf(adding)?.control.kind === 'boolean' ? 'true' : '']);
					adding = '';
				}}
			>
				<option value="">+ parameter…</option>
				{#each unset as field (field.name)}
					<option value={field.name} title={field.doc}>{field.name}{field.required ? ' *' : ''}</option>
				{/each}
			</select>
		</label>
	{/if}
</div>

<style>
	/* `min-width: 0` on every level: a grid or flex child defaults to its *content* width, so one
	   long path would push the pane wider than its column. It has to be repeated down the chain. */
	.node {
		min-width: 0;
		border-bottom: 1px solid var(--rule);
		background: var(--surface);
		padding: var(--space-3) var(--space-4);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin-top: var(--space-2);
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
	.head {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		min-width: 0;
	}
	.name {
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--ink);
	}
	.kind {
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
	.none {
		margin: var(--space-2) 0 0;
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
	dl {
		margin: var(--space-3) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 7rem) minmax(0, 1fr);
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}
	dt {
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
	.required {
		color: var(--error);
		margin-left: 1px;
	}
	dd {
		margin: 0;
		min-width: 0;
	}
	input[type='text'],
	input[type='number'],
	select {
		width: 100%;
		min-width: 0;
		padding: var(--space-1) var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		/* The value scrolls inside the field rather than stretching it — the long-path case. */
		text-overflow: ellipsis;
	}
	input[type='checkbox'] {
		width: auto;
	}
	input:focus-visible,
	select:focus-visible {
		outline-offset: -1px;
	}
	input:focus {
		text-overflow: clip;
	}
	.add {
		display: block;
		margin-top: var(--space-3);
	}
	.add select {
		font-family: var(--font-ui);
		color: var(--ink-2);
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
