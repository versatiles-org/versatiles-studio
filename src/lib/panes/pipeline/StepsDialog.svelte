<script lang="ts">
	import { untrack } from 'svelte';
	import Modal from '../../common/Modal.svelte';
	import { describeSteps, fromSteps, parseSteps, type Step } from './steps';

	// The helper behind a per-zoom curve - `raster_format`'s `quality` and `quality_translucent`
	// (S3.4, C2).
	//
	// **A helper, not the field.** The value stays a text box in the row, the way a path does: the
	// written form is what the VPL holds, what a person pastes from the CLI, and what `check` reports
	// on, so a control that replaced it would put the parameter one dialog away from being read. This
	// is the `…` beside it - see `NodeArgument`, where the same argument is made for a filename.
	//
	// **What the helper is for.** The written form is three rules pretending to be one value:
	// `80,70,14:50` means "80 at zoom 0, 70 from zoom 1, 50 from zoom 14", and none of that is
	// visible. A bare number is positional, so the comma advances a counter that starts before zoom 0;
	// every entry then fills forward to the last zoom. This shows the curve as the breakpoints it is
	// made of, and says underneath which zooms actually get what.
	//
	// **It commits once, on Use.** Editing the rows changes nothing until then, so a dialog opened to
	// look at a value and closed again leaves the document exactly as it was.
	let {
		value,
		min,
		max,
		maxZoom,
		name,
		onUse,
		onClose
	}: {
		/** The parameter as written. Decoded on opening; nothing is written back until `onUse`. */
		value: string;
		min: number;
		max: number;
		/** The deepest zoom a breakpoint may name - the parser's own bound, not the source's. */
		maxZoom: number;
		/** The parameter's name, for the title and the labels. */
		name: string;
		onUse: (text: string) => void;
		onClose: () => void;
	} = $props();

	/// **The dialog's own copy, and the only place one is right.** The row's text box is the value
	/// while the dialog is shut; while it is open these rows are a draft, and a draft that wrote
	/// through on every keystroke would be a Cancel button that cancelled nothing.
	/// `untrack` because decoding happens once, when the dialog opens: following the prop afterwards
	/// would throw away whatever had been edited the moment the row's text box was touched behind it.
	let steps = $state<Step[]>(untrack(() => parseSteps(value, max, maxZoom)) ?? []);

	/// What the rows currently encode to - shown, so the text this will write is never a surprise.
	const encoded = $derived(fromSteps(steps));

	/// A value the parser refuses cannot be drawn as rows, and opening on an empty editor would look
	/// like the parameter was empty. Said instead, with the text left alone until Use is pressed.
	const unreadable = $derived(parseSteps(value, max, maxZoom) === null);

	function change(index: number, part: Partial<Step>): void {
		steps = steps.map((step, at) => (at === index ? { ...step, ...part } : step));
	}

	/// **The first step is an endpoint, the rest continue the one before.** Adding to an empty curve
	/// has to invent a value, and the top of the range invents least - it is the setting that changes
	/// the image least. Every later row carries the previous row's value down, so adding a row alone
	/// is never a change to the curve.
	function add(): void {
		const last = steps.at(-1);
		steps = [...steps, last ? { zoom: Math.min(last.zoom + 1, maxZoom), value: last.value } : { zoom: 0, value: max }];
	}

	/// A number typed into a row, held to the range the control carries so the operation is never
	/// asked to refuse what the form could have.
	const clamp = (raw: string, lowest: number, highest: number): number | null => {
		const parsed = Number(raw);
		return raw.trim() === '' || !Number.isInteger(parsed) ? null : Math.min(Math.max(parsed, lowest), highest);
	};
</script>

<Modal title="Quality by zoom: {name}" width="26rem" {onClose}>
	{#if unreadable}
		<!-- Said rather than corrected: the value is somebody's, and `check` is what explains what is
		     wrong with it, in the operation's own words. Use would overwrite it, so it says so. -->
		<p class="note" role="status">
			<code>{value}</code> is not a per-zoom curve, so there is nothing to show. Building one here replaces it.
		</p>
	{/if}

	<div class="steps">
		{#each steps as step, index (index)}
			<div class="step">
				<input
					type="number"
					class="value"
					value={step.value}
					{min}
					{max}
					step="1"
					aria-label="Value from zoom {step.zoom}"
					onblur={(event) => {
						const next = clamp(event.currentTarget.value, min, max);
						if (next !== null) change(index, { value: next });
					}}
				/>
				<span class="from">from zoom</span>
				<input
					type="number"
					class="zoom"
					value={step.zoom}
					min="0"
					max={maxZoom}
					step="1"
					aria-label="First zoom for value {step.value}"
					onblur={(event) => {
						const next = clamp(event.currentTarget.value, 0, maxZoom);
						if (next !== null) change(index, { zoom: next });
					}}
				/>
				<button
					type="button"
					class="remove"
					aria-label="Remove the step at zoom {step.zoom}"
					onclick={() => (steps = steps.filter((_, at) => at !== index))}>✕</button
				>
			</div>
		{/each}

		<button type="button" class="link" onclick={add}>+ step</button>
	</div>

	<!-- The two things the written form hides: which zooms get what, and what will actually be
	     written. Both read-only, so neither can come to disagree with the rows. -->
	<dl class="reading">
		<dt>Resolves to</dt>
		<dd>{describeSteps(steps)}</dd>
		<dt>Writes</dt>
		<dd><code>{encoded || '(nothing - clears the parameter)'}</code></dd>
	</dl>

	{#snippet actions()}
		<button type="button" class="button" onclick={onClose}>Cancel</button>
		<button type="button" class="button primary" onclick={() => onUse(encoded)}>Use</button>
	{/snippet}
</Modal>

<style>
	.steps {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.step {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	/* Both boxes are narrow on purpose: a quality is at most three digits and a zoom at most two, and
	   a row that filled the dialog would read as one field rather than as a pair. */
	.value {
		width: 5rem;
	}

	.zoom {
		width: 4.5rem;
	}

	.from {
		color: var(--ink-2);
		font-size: var(--text-sm);
		white-space: nowrap;
	}

	.remove {
		margin-left: auto;
		border: 0;
		background: none;
		padding: 0 var(--space-1);
		color: var(--ink-2);
		cursor: pointer;
		line-height: 1;

		&:hover {
			color: var(--ink);
		}
	}

	.link {
		align-self: flex-start;
		border: 0;
		background: none;
		padding: 0;
		color: var(--ink-2);
		font-size: var(--text-sm);
		cursor: pointer;

		&:hover {
			color: var(--ink);
		}
	}

	.reading {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--space-1) var(--space-3);
		margin: 0;
		padding-top: var(--space-3);
		border-top: 1px solid var(--rule);
		font-size: var(--text-sm);

		dt {
			color: var(--ink-2);
		}

		dd {
			margin: 0;
			min-width: 0;
		}
	}

	.note {
		margin: 0 0 var(--space-3);
		color: var(--ink-2);
		font-size: var(--text-sm);
	}
</style>
