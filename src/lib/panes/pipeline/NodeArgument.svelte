<script lang="ts">
	import type { FieldInfo, ImportKind } from '../../ipc/commands';
	import HelpTrigger from '../../common/HelpTrigger.svelte';
	import type { HelpContent } from '../../state/help.svelte';
	import { askForPath } from '../../common/import';
	import { bboxField, formatBbox, parseBbox } from '../../state/bbox.svelte';
	import ColorPicker from '../../common/ColorPicker.svelte';
	import { unhandled } from './node-fields';

	// One argument of a node: its name, its help, its control, and whether it can be removed (C2).
	//
	// **One component for all three kinds of row** - a set parameter, a required one with no value
	// yet, and one chosen from `＋ parameter…` and not yet given a value. They were three copies of
	// this markup, and they differ only in *data*: a name, a value, a placeholder, what committing
	// does, and whether there is a button on the end. None of that is a mode, so none of it needs a
	// branch here beyond "was this prop given".
	//
	// The copies had already drifted twice over: a set list field offered suggestion chips and an
	// empty one did not, and a pending row showed no `?` at all.
	//
	// Nothing here is written per operation. What to render comes from `field_meta` by way of the
	// core, so an operation added upstream gets a working control with no change in Studio.
	let {
		name,
		field,
		value,
		help,
		suggestions = [],
		placeholder = '',
		tentative = false,
		kind,
		onCommit,
		onRemove,
		removeLabel
	}: {
		name: string;
		/** What the operation says about it, or nothing for a parameter it does not declare. */
		field?: FieldInfo;
		/** The current value as one line - empty when the parameter is not set yet. */
		value: string;
		/** Shown behind the `?`. Omitted when there is nothing to say. */
		help?: HelpContent;
		/** Values this field could take, from either end of the pipeline (S3.3, S3.4). */
		suggestions?: string[];
		/** What the empty box should say when the field has no default of its own to show. */
		placeholder?: string;
		/** In the pane and not yet in the document - tinted to say so. */
		tentative?: boolean;
		/** The way in this node's operation reads, when it is one - the file dialog's filter. */
		kind?: ImportKind;
		/** Fired on blur, Enter or a choice - never per keystroke, which would reparse the document
		 *  on every character and fight the caret. */
		onCommit: (raw: string) => void;
		/** Omitted when the argument cannot be removed, which is how "required" is said ([Q33]). */
		onRemove?: () => void;
		removeLabel?: string;
	} = $props();

	const control = $derived(field?.control);

	/// Whether a value is a path: read from its end, and offered a file picker.
	///
	/// **The core's answer, not a guess made here.** This used to be a name test in this file -
	/// `filename`, `*_file`, `*_path` - and it missed `raster_mask`'s `geojson`, both `cutline`s
	/// and `ssh_identity`, three fields that name a file and say so nowhere a name test could see.
	/// The registry is the core's to read, and a test there holds the list against it when
	/// upstream adds another (C2).
	const isPath = $derived(control?.kind === 'path');

	/// A colour field, in whichever way this operation spells one ([Q57]).
	const colour = $derived(control?.kind === 'color' ? control : null);

	/// A rectangle field: four degrees, and the map already knows how to draw one ([Q53]).
	const isBbox = $derived(control?.kind === 'bbox');
	/// One character, and the field type upstream refuses a second. Capping the box is the whole
	/// difference between this and a text field: `field_separator=||` parses as VPL and fails when
	/// the value is decoded, which is a long way from where it was typed.
	const isChar = $derived(control?.kind === 'char');

	/// Whether this row draws with the shared text box.
	///
	/// **Named rather than left to `{:else}`.** Five controls share that input - plain text, a path, a
	/// rectangle, a swatch and a fixed-size row of numbers - and the branch that drew them took
	/// everything it had not named with them. So a `Control` variant added upstream arrived as a plain
	/// box with nothing to say it was unhandled, in the one place a person edits the value.
	///
	/// Listing them makes that a compile error instead: `Control` is generated from the Rust enum, so
	/// `unhandled` stops type-checking the moment a variant has no arm here. The `{:else}` below is
	/// the belt to this braces, and says so on screen if one ever gets past.
	const textual = $derived.by(() => {
		// No control at all is a field the core said nothing about, which a text box is right for.
		// Narrowed off `control` rather than a copy of its `kind`, or the `default` below is reached
		// with the union still whole and `unhandled` has nothing to refuse.
		if (control === undefined) return true;
		switch (control.kind) {
			case 'text':
			case 'path':
			case 'bbox':
			case 'color':
			case 'numbers':
			case 'list':
			case 'char':
				// A separator is a text box that holds one character - see `isChar`, which is what
				// keeps it from being a text box that holds a word the operation then refuses.
				return true;
			case 'choice':
			case 'boolean':
			case 'number':
				return false;
			default:
				return unhandled(control);
		}
	});
	/// This row, told from every other. Two nodes can hold the same parameter name, so neither the
	/// claim on the map nor the datalist below can be keyed on it.
	const rowId = $props.id();
	const drawn = $derived(parseBbox(value));

	/// Takes the map for this field, showing whatever it currently holds.
	const claim = () => bboxField.focus(rowId, drawn, (bbox) => onCommit(formatBbox(bbox)));

	/// **Claims first.** The click that reaches this button has already blurred the input, which
	/// released the map - so the button takes it back before asking to draw on it.
	function draw() {
		claim();
		bboxField.toggleDraw(rowId);
	}

	// Gives the map back when the row goes: a node closed while its rectangle was on screen would
	// otherwise leave it there with nothing to edit it.
	$effect(() => () => bboxField.release(rowId));

	/// What the empty box says.
	///
	/// **A default beats whatever the caller suggested** ([vt#253]). "a value" is a restatement of
	/// the box; `000000` is what the operation will actually do if this is left alone - which is the
	/// difference between `from_color`'s `color`, whose absence is fine, and `from_csv`'s
	/// `lon_column`, whose absence is a pipeline that will not build. They used to look identical.
	///
	/// Shown and never written: putting the default into the document would freeze today's value
	/// into a file that should follow whatever the operation does next.
	///
	/// [vt#253]: https://github.com/versatiles-org/versatiles-rs/issues/253
	const hint = $derived(field?.default ?? placeholder);

	/** A list is typed as one comma-separated line and stored as a VPL array. */
	const parts = (raw: string) =>
		raw
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean);

	const chosen = $derived(parts(value));

	/// Fills the field from the file picker.
	///
	/// **A path field needs a picker at all** because the value is one someone otherwise has to
	/// know by heart and type without a single character of help - and it is the one kind of value
	/// where the machine already knows every valid answer. Everything else in this form is a name,
	/// a number or a choice out of a list the pane shows.
	///
	/// It commits like any other edit rather than by its own route, so a picked path lands in the
	/// document the same way a typed one does - including a pending row, which has no value yet and
	/// gets one this way.
	async function browse() {
		const picked = await askForPath(kind, `Choose a file for ${name}`);
		if (picked !== null) onCommit(picked);
	}

	/** A datalist needs an id of its own. */
	const listId = rowId;

	function toggle(name: string) {
		const next = chosen.includes(name) ? chosen.filter((each) => each !== name) : [...chosen, name];
		onCommit(next.join(', '));
	}
</script>

<div class="arg" class:tentative>
	<dt>
		<span class="k truncate">{name}</span>
		{#if help}<HelpTrigger content={help} />{/if}
	</dt>
	<dd>
		{#if control?.kind === 'choice'}
			<!-- **An unset field is not the first option.** A `<select>` shows its first entry when
			     nothing matches, so a parameter the document does not set displayed as `256` while
			     saying nothing - and the first thing anyone did with it wrote a value they had not
			     chosen. The empty entry is what the field currently is, and picking it clears the
			     parameter, which is what an empty box does everywhere else in this form. -->
			<select {value} onchange={(event) => onCommit(event.currentTarget.value)}>
				{#if !field?.required || value === ''}
					<option value="">{field?.default ? `default (${field.default})` : '—'}</option>
				{/if}
				{#each control.options as option (option)}<option value={option}>{option}</option>{/each}
			</select>
		{:else if control?.kind === 'boolean'}
			<input
				type="checkbox"
				checked={value === 'true'}
				onchange={(event) => onCommit(String(event.currentTarget.checked))}
			/>
		{:else if control?.kind === 'number'}
			<!-- An excluded end is still passed as the browser's `min`/`max`, which are inclusive: it keeps
			     the stepper inside the range, and the one value it wrongly admits - the end itself - is
			     refused by `check` as it is typed, with a message from the operation. -->
			<input
				type="number"
				{value}
				placeholder={hint}
				step={control.integer ? 1 : 'any'}
				min={control.min ?? undefined}
				max={control.max ?? undefined}
				onblur={(event) => onCommit(event.currentTarget.value)}
				onkeydown={(event) => {
					if (event.key === 'Enter') event.currentTarget.blur();
				}}
			/>
		{:else if textual}
			<!-- The box and its browse button are one control, so they sit in one box: a `…` that
			     wrapped to the next line would read as something the field does rather than as its
			     other half. -->
			<div class="line">
				<input
					type="text"
					class:path={isPath || isBbox}
					maxlength={isChar ? 1 : undefined}
					{value}
					title={value}
					placeholder={hint ||
						(isBbox
							? 'west, south, east, north'
							: colour
								? colour.hex
									? 'RRGGBB'
									: 'r, g, b'
								: control?.kind === 'numbers'
									? `${control.count} numbers`
									: '')}
					onfocus={isBbox ? claim : undefined}
					list={suggestions.length > 0 ? listId : undefined}
					spellcheck="false"
					autocomplete="off"
					onblur={(event) => {
						onCommit(event.currentTarget.value);
						// Gives the map back - unless a drag is in progress, which is what starts by
						// blurring this very field.
						if (isBbox) bboxField.release(rowId);
					}}
					onkeydown={(event) => {
						if (event.key === 'Enter') event.currentTarget.blur();
						if (event.key === 'Escape') {
							event.currentTarget.value = value;
							event.currentTarget.blur();
						}
					}}
				/>
				{#if colour}
					<ColorPicker {value} spelling={colour.hex ? 'hex' : 'rgb'} label={`Colour for ${name}`} onPick={onCommit} />
				{:else if isBbox}
					<!-- **The map is the helper.** Four degrees typed by hand are four chances to put a
					     digit in the wrong place, and no way to see that you did until the pipeline runs
					     over the wrong part of the world. The rectangle appears as soon as the field is
					     focused, and this fills it in from a drag. -->
					<button
						type="button"
						class="browse"
						class:on={bboxField.drawing && bboxField.holds(rowId)}
						aria-pressed={bboxField.drawing && bboxField.holds(rowId)}
						title={bboxField.drawing && bboxField.holds(rowId) ? 'Drag a rectangle on the map' : 'Draw on the map'}
						aria-label={`Draw ${name} on the map`}
						onclick={draw}
					>
						▭
					</button>
				{:else if isPath}
					<!-- `…` rather than a folder: it is what a field that opens a dialog has said
					     everywhere for thirty years, and it stays legible at the size this row is. -->
					<button
						type="button"
						class="browse"
						title="Choose a file…"
						aria-label={`Choose a file for ${name}`}
						onclick={browse}
					>
						…
					</button>
				{/if}
			</div>
			{#if suggestions.length > 0}
				<datalist id={listId}>
					{#each suggestions as option (option)}<option value={option}></option>{/each}
				</datalist>
			{/if}
		{:else}
			<!-- Unreachable while the switch above type-checks, and here because "unreachable" is a
			     claim about the build rather than about the running application. A field nobody can
			     edit is worth saying out loud; a plain text box that silently drops what is typed into
			     it is the thing this arm exists to stop being the answer. -->
			<p class="unsupported" role="status">
				This build has no editor for <code>{control?.kind}</code>. Edit it in the VPL tab.
			</p>
		{/if}

		{#if control?.kind === 'list' && suggestions.length > 0}
			<!-- What the data actually contains. Chips rather than a multi-select: the set is small, the
			     current value stays readable in the field above, and anything not listed can still be typed -
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
	</dd>
	{#if onRemove}
		<button
			type="button"
			class="drop"
			title={removeLabel ?? `Remove ${name}`}
			aria-label={removeLabel ?? `Remove ${name}`}
			onclick={onRemove}
		>
			×
		</button>
	{/if}
</div>

<style>
	.arg {
		display: grid;
		grid-template-columns: 6.5rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		min-width: 0;
		padding: var(--space-1) var(--space-3);

		/* Marked as not-yet-real: in the pane and not in the document until it has a value. */
		&.tentative {
			background: color-mix(in srgb, var(--accent) 7%, transparent);
		}
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

	.drop {
		flex: none;
		color: var(--ink-2);
		padding: 0 var(--space-1);

		&:hover {
			color: var(--error);
		}
	}

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

	.line {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-width: 0;
	}

	/* The button is the fixed part: the box takes whatever is left, so the path keeps the width it
	   had in every other row. */
	.browse {
		flex: none;
		padding: 0 var(--space-1);
		font-size: var(--text-xs);
		line-height: 1;
		color: var(--ink-2);

		&:hover {
			color: var(--ink);
		}
	}

	/* A field this build cannot draw. Deliberately plain and deliberately not an error colour: it is
	   a gap in Studio rather than something wrong with the pipeline, and the VPL tab still edits it. */
	.unsupported {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-2);
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

		&.on {
			background: var(--accent);
			border-color: var(--accent);
			color: var(--accent-ink);
		}
	}
</style>
