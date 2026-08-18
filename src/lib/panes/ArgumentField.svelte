<script lang="ts">
	import type { FieldInfo } from '../ipc/commands';

	// The control for one argument, whatever kind it is (C2).
	//
	// **Shared by a set parameter and a required-but-unset one**, which is the point: they were two
	// copies of this markup and had already diverged — a set list field offered suggestion chips and
	// an empty one did not, so the chips appeared only once you had typed something, which is when
	// they are least useful.
	//
	// Nothing here is written per operation. What to render comes from `field_meta` by way of the
	// core, so an operation added upstream gets a working control with no change in Studio.
	let {
		field,
		value,
		suggestions = [],
		placeholder = '',
		onCommit
	}: {
		field: FieldInfo;
		/** The current value as one line — empty when the parameter is not set yet. */
		value: string;
		/** Values this field could take, from either end of the pipeline (S3.3, S3.4). */
		suggestions?: string[];
		placeholder?: string;
		/** Fired on blur, Enter or a choice — never per keystroke, which would reparse the document
		 *  on every character and fight the caret. */
		onCommit: (raw: string) => void;
	} = $props();

	const control = $derived(field.control);

	/** A list is typed as one comma-separated line and stored as a VPL array. */
	const parts = (raw: string) =>
		raw
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean);

	const chosen = $derived(parts(value));

	/// Whether a value is a path, and so should be read from its end.
	///
	/// By key rather than by looking at the value: an empty `filename` is still a path, and a
	/// `layer_name` that happens to contain a slash is not.
	const isPath = $derived(field.name === 'filename' || field.name.endsWith('_file') || field.name.endsWith('_path'));

	/** A datalist needs an id, and two nodes can hold the same parameter name. */
	const listId = $props.id();

	function toggle(name: string) {
		const next = chosen.includes(name) ? chosen.filter((each) => each !== name) : [...chosen, name];
		onCommit(next.join(', '));
	}
</script>

{#if control.kind === 'choice'}
	<select {value} onchange={(event) => onCommit(event.currentTarget.value)}>
		{#each control.options as option (option)}<option value={option}>{option}</option>{/each}
	</select>
{:else if control.kind === 'boolean'}
	<input
		type="checkbox"
		checked={value === 'true'}
		onchange={(event) => onCommit(String(event.currentTarget.checked))}
	/>
{:else if control.kind === 'number'}
	<input
		type="number"
		{value}
		{placeholder}
		step={control.integer ? 1 : 'any'}
		min={control.min ?? undefined}
		max={control.max ?? undefined}
		onblur={(event) => onCommit(event.currentTarget.value)}
		onkeydown={(event) => {
			if (event.key === 'Enter') event.currentTarget.blur();
		}}
	/>
{:else}
	<input
		type="text"
		class:path={isPath}
		{value}
		title={value}
		placeholder={placeholder || (control.kind === 'numbers' ? `${control.count} numbers` : '')}
		list={suggestions.length > 0 ? listId : undefined}
		spellcheck="false"
		autocomplete="off"
		onblur={(event) => onCommit(event.currentTarget.value)}
		onkeydown={(event) => {
			if (event.key === 'Enter') event.currentTarget.blur();
			if (event.key === 'Escape') {
				event.currentTarget.value = value;
				event.currentTarget.blur();
			}
		}}
	/>
	{#if suggestions.length > 0}
		<datalist id={listId}>
			{#each suggestions as option (option)}<option value={option}></option>{/each}
		</datalist>
	{/if}
{/if}

{#if control.kind === 'list' && suggestions.length > 0}
	<!-- What the data actually contains. Chips rather than a multi-select: the set is small, the
	     current value stays readable in the field above, and anything not listed can still be typed —
	     a property outside the probed tile is missing from here, not forbidden. -->
	<div class="chips">
		{#each suggestions as name (name)}
			<button
				type="button"
				class="chip"
				class:on={chosen.includes(name)}
				aria-pressed={chosen.includes(name)}
				onclick={() => toggle(name)}
			>
				{name}
			</button>
		{/each}
	</div>
{/if}

<style>
	input[type='text'],
	input[type='number'],
	select {
		width: 100%;
		min-width: 0;
		font-size: var(--text-xs);
	}
	/* Right-aligned so the digits line up down the column, and tabular so they do not shuffle as the
	   value changes. */
	input[type='number'] {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	/* A path is identified by its end. Truncated from the right, every file in a folder shows the
	   same prefix and nothing that tells them apart. */
	input.path {
		text-align: right;
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
</style>
