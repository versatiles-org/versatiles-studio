<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import Group from '../../common/Group.svelte';
	import Modal from '../../common/Modal.svelte';
	import Note from '../../common/Note.svelte';
	import type { ExpressionCheck, ExpressionName, ExpressionOperator } from '../../ipc/commands';
	import type { Vocabulary } from '../../state/vocabulary.svelte';
	import {
		GEOMETRY_TYPES,
		insertAt,
		keysOf,
		operatorChip,
		paint,
		propertyRef,
		quoted,
		readsLine,
		valuePiece,
		type Placement
	} from './expression';

	// The helper behind an expression - `vector_branch`'s and `vector_filter_features`'s `expr`.
	//
	// **A helper, not the field**, and it commits once, on Use, for the reasons `StepsDialog` gives.
	// What it shows that the line hides is what an expression can say: the `$` names, the operators
	// and functions, the source's properties, and the values those hold - each a click away from
	// being written where the caret is.
	//
	// **Checked when asked, not while typed.** It checked after every pause, and a pause is mostly
	// a thought half-finished - `$layer ==` on its way to a value was called wrong each time. Now it
	// is checked once on opening and then on Check (or ⌘/Ctrl+Enter); an edit since leaves the last
	// verdict in its box, faded, as an answer about what was there before.
	//
	// **Coloured while typed, judged when asked.** The colours are upstream's tokens for what is in
	// the box now, asked for after each edit; the underlines are the last verdict's, and only while
	// the text is still the one it was about. Both are drawn on a layer under a transparent
	// textarea, as `VplEditor` draws the VPL.
	let {
		value,
		name,
		names,
		operators,
		vocabulary,
		check,
		onScan,
		onUse,
		onClose
	}: {
		/** The parameter as written. Nothing is written back until `onUse`. */
		value: string;
		/** The parameter's name, for the title. */
		name: string;
		/** The `$` names an expression reads, as the field's control carries them. */
		names: ExpressionName[];
		/** The operators, functions and macros it can use, as the field's control carries them. */
		operators: ExpressionOperator[];
		/** What the selected source's tiles hold - see `vocabulary.svelte.ts`. */
		vocabulary: Vocabulary;
		/** Upstream's check of an expression: what is wrong and where, its tokens, what it reads. */
		check: (text: string) => Promise<ExpressionCheck>;
		/** Reads the source's layers, for the values. */
		onScan: () => void;
		onUse: (text: string) => void;
		onClose: () => void;
	} = $props();

	/// The dialog's own draft - see `StepsDialog`, which explains the `untrack`.
	let draft = $state(untrack(() => value));
	let box: HTMLTextAreaElement | undefined = $state();
	/// Where the caret was, for a pick to land there. Kept as the box loses focus to the pick.
	let selection = { start: untrack(() => value.length), end: untrack(() => value.length) };

	const remember = () => {
		if (box) selection = { start: box.selectionStart, end: box.selectionEnd };
	};

	// -- the check ------------------------------------------------------------------------------

	/// The last verdict, and the text it was about; `null` before the first.
	let verdict = $state<{ text: string; check: ExpressionCheck | null } | null>(null);
	/// Whether the text has changed since that verdict.
	const changed = $derived(verdict !== null && verdict.text !== draft);
	/// Whether a check is on its way.
	let checking = $state(false);
	/// The newest question; an answer to an older one is dropped.
	let asked = 0;

	async function run(): Promise<void> {
		const ticket = ++asked;
		const text = draft;
		checking = true;
		const found = text.trim() === '' ? null : await check(text);
		if (ticket !== asked) return;
		verdict = { text, check: found };
		if (found) colours = { text, tokens: found.tokens };
		checking = false;
	}

	/// Upstream's tokens for the text in the box, for colouring it as it is typed.
	let colours = $state<{ text: string; tokens: ExpressionCheck['tokens'] }>({ text: '', tokens: [] });
	let timer: ReturnType<typeof setTimeout> | undefined;

	/// After an edit, asks for the new text's tokens - only the tokens: the verdict waits for Check.
	function recolour(): void {
		clearTimeout(timer);
		timer = setTimeout(async () => {
			const text = draft;
			if (text.trim() === '' || text === colours.text) return;
			const { tokens } = await check(text);
			if (text === draft) colours = { text, tokens };
		}, 150);
	}

	/// What the layer under the box draws: the current text, coloured where its tokens are known,
	/// underlined where the verdict about this very text says it is wrong.
	///
	/// A trailing newline would otherwise not reserve a line in the layer, and the two would
	/// disagree about their height.
	const pieces = $derived([
		...paint(
			draft,
			colours.text === draft ? colours.tokens : [],
			verdict?.text === draft ? (verdict.check?.problems ?? []) : []
		),
		{ text: '\n', kind: null, bad: false }
	]);

	onMount(() => {
		void run();
		return () => clearTimeout(timer);
	});

	let paintLayer: HTMLPreElement | undefined = $state();
	const sync = (): void => {
		if (paintLayer && box) {
			paintLayer.scrollTop = box.scrollTop;
			paintLayer.scrollLeft = box.scrollLeft;
		}
	};

	// -- what can be picked ---------------------------------------------------------------------

	/// The layer the properties are for, or every layer together.
	let layer = $state<string | null>(null);
	const keys = $derived(keysOf(vocabulary.layers, layer));

	/// What the properties are narrowed to, as typed - OpenStreetMap alone has dozens of `name_*`.
	/// **Only what is shown**: a picked property keeps its values when the filter hides its chip.
	let query = $state('');
	const needle = $derived(query.trim().toLowerCase());
	const shownKeys = $derived(needle ? keys.filter(({ key }) => key.toLowerCase().includes(needle)) : keys);

	/// The list's height as drawn, and as it was last drawn unfiltered - which it keeps while a
	/// filter is typed (see the markup).
	let listHeight = $state(0);
	let fullHeight = $state(0);
	$effect(() => {
		if (!needle) fullHeight = listHeight;
	});

	/// What was picked last, whose values are offered: a property, or `$layer` and `$type`, whose
	/// values are the layers' names and the geometry types.
	let picked = $state<string | null>(null);
	const values = $derived.by((): { literal: string; count: number | null }[] => {
		if (picked === '$layer') return vocabulary.layers.map(({ layer }) => ({ literal: quoted(layer), count: null }));
		if (picked === '$type') return GEOMETRY_TYPES.map((literal) => ({ literal, count: null }));
		const key = keys.find((candidate) => candidate.key === picked);
		return key ? key.values.map(({ literal, count }) => ({ literal, count })) : [];
	});
	const pickedMore = $derived(keys.find((candidate) => candidate.key === picked)?.more ?? false);

	/// Upstream's operators as chips, in its order: those between or around operands, then those
	/// with brackets.
	const chips = $derived(
		operators.map((operator) => ({
			...operatorChip(operator),
			call: ['function', 'method', 'macro'].includes(operator.kind)
		}))
	);

	// -- what a chip means ----------------------------------------------------------------------

	/// What a name or an operator does, by its chip's label, for the line under the chips.
	///
	/// **A line, not a tooltip.** A native tooltip waits a second, shows for one chip at a time,
	/// and never for the keyboard; thirty-odd operators were each a hover and a wait away from
	/// saying what they do. The line answers for whichever chip the pointer or the focus is on.
	type Doc = { label: string; doc: string; example: string | null };
	const docs = $derived(
		new Map<string, Doc>([
			...names.map((entry): [string, Doc] => [entry.name, { label: entry.name, doc: entry.doc, example: null }]),
			...operators.map((operator): [string, Doc] => {
				const label = operatorChip(operator).label;
				return [label, { label, doc: operator.doc, example: operator.example }];
			})
		])
	);

	/// The chip the line is about, or `null` for the hint.
	let described = $state<Doc | null>(null);

	/// Whichever chip `target` is on: its doc, or none for a property or a value. **Between chips
	/// nothing changes**, so passing over the gaps does not make the line flicker back to the hint.
	function describe(target: EventTarget | null): void {
		const chip = target instanceof Element ? target.closest<HTMLElement>('.chip') : null;
		if (chip) described = docs.get(chip.dataset.doc ?? '') ?? null;
	}

	/// Writes `piece` where the caret was, and puts the caret after it - or where `placement` says.
	async function insert(piece: string, placement?: Placement): Promise<void> {
		const next = insertAt(draft, selection.start, selection.end, piece, placement);
		draft = next.text;
		selection = { start: next.caret, end: next.caret };
		recolour();
		await tick();
		box?.focus();
		box?.setSelectionRange(next.caret, next.caret);
	}
</script>

<Modal title="Expression: {name}" width="48rem" {onClose}>
	<div class="editor">
		<pre bind:this={paintLayer} aria-hidden="true">{#each pieces as piece, index (index)}<span
					class={piece.kind}
					class:bad={piece.bad}
					class:missing={piece.missing}>{piece.text}</span
				>{/each}</pre>
		<textarea
			spellcheck="false"
			autocomplete="off"
			autocapitalize="off"
			aria-label="Expression for {name}"
			aria-invalid={!changed && (verdict?.check?.problems.length ?? 0) > 0}
			bind:this={box}
			bind:value={draft}
			oninput={() => {
				remember();
				recolour();
			}}
			onkeydown={(event) => {
				if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
					event.preventDefault();
					void run();
				}
			}}
			onscroll={sync}
			onkeyup={remember}
			onclick={remember}
			onselect={remember}></textarea>
	</div>

	<!-- **A box of its own, always there, of one height.** A verdict that came and went resized the
	     dialog under the caret. Faded while the text has moved on from the answer. -->
	<div class="check">
		<button type="button" class="button" disabled={checking} onclick={() => void run()}>Check</button>
		<span class="keys">{changed ? 'Changed since the check' : '⌘/Ctrl + Enter'}</span>
	</div>
	<div class="status" class:changed role="status" aria-live="polite">
		{#if draft.trim() === ''}
			<Note tone="aside">Empty: Use clears the parameter.</Note>
		{:else if verdict === null}
			<Note tone="aside">Checking…</Note>
		{:else if verdict.check === null}
			<Note tone="aside">Empty: Use clears the parameter.</Note>
		{:else if verdict.check.problems.length === 0}
			<Note tone="aside">Reads as an expression.</Note>
			{#if verdict.check.reads}
				<Note tone="aside">{readsLine(verdict.check.reads)}</Note>
			{/if}
		{:else}
			<!-- Upstream's words, each about what is underlined above. -->
			<ul class="problems">
				{#each verdict.check.problems as problem, index (index)}
					<li>{problem.message}</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!-- **What gives way when the window is short.** Everything that can be picked, in one scroller,
	     so the box, its verdict and the buttons stay on screen - see `.palette`. -->
	<div
		class="palette"
		role="presentation"
		onpointerover={(event) => describe(event.target)}
		onfocusin={(event) => describe(event.target)}
		onpointerleave={() => (described = null)}
		onfocusout={(event) => {
			if (!event.currentTarget.contains(event.relatedTarget as Node | null)) described = null;
		}}
	>
		<Group title="Names">
			<div class="chips">
				{#each names as entry (entry.name)}
					<button
						type="button"
						class="chip"
						class:picked={picked === entry.name}
						data-doc={entry.name}
						onclick={() => {
							picked = entry.name;
							void insert(entry.name);
						}}
					>
						{entry.name}
					</button>
				{/each}
			</div>
		</Group>

		<!-- **Side by side, because one is about the other.** Picking a property shows its values; a
		     list below it, past every other chip, put the answer out of sight of the question. -->
		<div class="data">
			<Group title="Properties">
				<div class="narrow">
					{#if keys.length > 0}
						<!-- Escape empties it first, and closes the dialog only once it is empty. -->
						<input
							type="text"
							class="filter"
							placeholder="Filter properties…"
							aria-label="Filter properties"
							spellcheck="false"
							autocomplete="off"
							autocapitalize="off"
							bind:value={query}
							onkeydown={(event) => {
								if (event.key === 'Escape' && query !== '') {
									event.preventDefault();
									event.stopPropagation();
									query = '';
								}
							}}
						/>
					{/if}
					{#if vocabulary.layers.length > 1}
						<label class="layer">
							<span>Of</span>
							<select value={layer ?? ''} onchange={(event) => (layer = event.currentTarget.value || null)}>
								<option value="">every layer</option>
								{#each vocabulary.layers as entry (entry.layer)}
									<option value={entry.layer}>{entry.layer}</option>
								{/each}
							</select>
						</label>
					{/if}
				</div>
				{#if keys.length === 0}
					<Note tone="empty">No properties known yet.</Note>
				{:else}
					<!-- **As tall while filtering as before it.** The dialog centres itself, so a list
					     that shrank with each key typed moved the whole dialog, the field being typed in
					     included. -->
					<div bind:clientHeight={listHeight} style:min-height={needle ? `${fullHeight}px` : null}>
						{#if shownKeys.length === 0}
							<Note tone="empty">No property matches “{query.trim()}”.</Note>
						{:else}
							<div class="chips">
								{#each shownKeys as key (key.key)}
									<button
										type="button"
										class="chip"
										class:picked={picked === key.key}
										title={key.features > 0 ? `${key.features} features` : undefined}
										onclick={() => {
											picked = key.key;
											void insert(propertyRef(key.key));
										}}
									>
										{key.key}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</Group>

			<Group title={picked ? `Values of ${picked}` : 'Values'}>
				{#if picked === null}
					<Note tone="empty">Pick a name or a property to see what it holds.</Note>
				{:else if values.length > 0}
					<div class="chips">
						{#each values as entry (entry.literal)}
							<button
								type="button"
								class="chip value"
								title={entry.count === null ? undefined : `${entry.count} features`}
								onclick={() => void insert(valuePiece(draft.slice(0, selection.start), entry.literal))}
							>
								{entry.literal}
							</button>
						{/each}
					</div>
					{#if pickedMore}
						<Note tone="aside">The commonest of more values.</Note>
					{/if}
				{:else if vocabulary.read === 'none'}
					<Note tone="hint">
						Values come from reading the layers.
						{#snippet action()}
							<button type="button" class="quiet" disabled={vocabulary.scanning} onclick={onScan}>
								{vocabulary.scanning ? 'Reading…' : 'Read layers'}
							</button>
						{/snippet}
					</Note>
				{:else}
					<Note tone="empty">No values read for it.</Note>
				{/if}
				{#if vocabulary.read === 'sampled' && values.length > 0}
					<Note tone="aside">From a sample of the tiles.</Note>
				{/if}
			</Group>
		</div>

		{#each [{ title: 'Operators', call: false }, { title: 'Functions', call: true }] as group (group.title)}
			<Group title={group.title}>
				<div class="chips">
					{#each chips.filter((entry) => entry.call === group.call) as entry (entry.label)}
						<button
							type="button"
							class="chip"
							data-doc={entry.label}
							onclick={() => void insert(entry.piece, { attach: entry.attach, caret: entry.caret })}
						>
							{entry.label}
						</button>
					{/each}
				</div>
			</Group>
		{/each}
	</div>

	<!-- **Outside the scroller, of one height.** Under the chips it was scrolled out of sight while
	     the operators were in it; and a line that grew and shrank would move the buttons. -->
	<div class="doc" aria-live="polite">
		{#if described}
			<code class="label">{described.label}</code>
			<span>{described.doc}</span>
			{#if described.example}
				<span class="example">For example: <code>{described.example}</code></span>
			{/if}
		{:else}
			<span class="idle">Point at a name, an operator or a function to see what it does.</span>
		{/if}
	</div>

	{#snippet actions()}
		<button type="button" class="button" onclick={onClose}>Cancel</button>
		<button type="button" class="button primary" onclick={() => onUse(draft.trim())}>Use</button>
	{/snippet}
</Modal>

<style>
	/* The box, as `VplEditor`'s: a transparent textarea over a layer that draws the same text,
	   coloured. Both take every metric from the same place, or the colours drift off the text. */
	/* **Never the one to give way.** The modal's body is a flex column, and an element that clips
	   its overflow may shrink to nothing in one - so once the values filled the dialog, the box being
	   written in collapsed to a line. `.palette` gives way instead. */
	.editor {
		flex-shrink: 0;
		position: relative;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}

	pre,
	textarea {
		box-sizing: border-box;
		width: 100%;
		margin: 0;
		padding: var(--space-2) var(--space-3);
		border: 0;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: 1.5;
		tab-size: 2;
		white-space: pre-wrap;
		overflow-wrap: break-word;
		word-break: break-word;
	}

	/* The layer sizes the box, three lines at least; the textarea is laid over it. */
	pre {
		min-height: calc(3 * 1.5em + 2 * var(--space-2));
		max-height: 12rem;
		overflow: auto;
		color: var(--ink);

		:global(.special),
		:global(.function) {
			color: var(--accent);
		}

		:global(.string),
		:global(.number),
		:global(.bool),
		:global(.null) {
			color: var(--vpl-value);
		}

		:global(.operator),
		:global(.bracket),
		:global(.punctuation) {
			color: var(--ink-2);
		}

		:global(.comment) {
			color: var(--ink-2);
			font-style: italic;
		}

		:global(.unknown) {
			color: var(--error);
		}

		:global(.bad) {
			text-decoration: var(--error) wavy underline;
			text-underline-offset: 0.2em;
		}

		/* Where something is missing there is no text to underline, so it gets a mark of its own. */
		:global(.missing) {
			position: relative;

			&::after {
				content: '';
				position: absolute;
				left: 0.1em;
				bottom: -0.2em;
				width: 0.8em;
				border-bottom: 2px solid var(--error);
			}
		}
	}

	textarea {
		position: absolute;
		inset: 0;
		resize: none;
		overflow: auto;
		background: transparent;
		color: transparent;
		caret-color: var(--ink);

		&::selection {
			background: color-mix(in srgb, var(--accent) 28%, transparent);
		}

		&:focus-visible {
			outline-offset: -2px;
		}
	}

	.check {
		display: flex;
		align-items: center;
		gap: var(--space-3);

		.keys {
			font-size: var(--text-xs);
			color: var(--ink-2);
		}
	}

	/* Six lines, scrolling inside rather than growing. */
	.status {
		/* Its fixed height is the point of it; see `.editor` for why that needs saying. */
		flex-shrink: 0;
		box-sizing: border-box;
		line-height: 1.4;
		height: calc(6 * 1.4em + 2 * var(--space-3));
		overflow: auto;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--chrome);
		font-size: var(--text-xs);
		transition: opacity 120ms ease;

		&.changed {
			opacity: 0.45;
		}
	}

	/* The one child `Modal` lets shrink (`min-height: 0`, its own scroller), as its comment asks:
	   when the window is short this scrolls, and the box above and the buttons below stay put. */
	.palette {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		gap: var(--space-4);
		min-height: 0;
		overflow-y: auto;
	}

	/* Properties on the left, the picked one's values on the right, each its own scroller of one
	   height - so a long list of keys does not push the values away, nor the values the keys.
	   `minmax(0, …)` lets a chip with a long name wrap the column rather than widen it. */
	.data {
		display: grid;
		grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
		gap: var(--space-5);
		align-items: start;

		.chips {
			max-height: 11rem;
		}
	}

	/* Two lines, always: a long doc and its example wrap into the second, and nothing moves. */
	.doc {
		flex-shrink: 0;
		box-sizing: border-box;
		height: calc(2 * 1.4em + 2 * var(--space-2));
		overflow: hidden;
		padding: var(--space-2) 0;
		border-top: 1px solid var(--rule);
		line-height: 1.4;
		font-size: var(--text-xs);
		color: var(--ink);

		code {
			font-family: var(--font-mono);
		}

		.label {
			margin-right: var(--space-2);
			color: var(--accent);
		}

		.example,
		.idle {
			color: var(--ink-2);
		}

		.example {
			margin-left: var(--space-2);
		}
	}

	.problems {
		margin: 0;
		padding-left: 1.2em;
		color: var(--ink);
	}

	/* The filter and the layer, on one line above the chips they narrow. */
	.narrow {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-2);

		.filter {
			flex: 1 1 auto;
			min-width: 0;
			font-size: var(--text-sm);
		}
	}

	.layer {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-xs);
		color: var(--ink-2);

		/* Narrow enough to leave the filter beside it most of the line. */
		select {
			max-width: 10rem;
		}
	}

	/* Small, wrapping, and as many as there are - they are a vocabulary, read across. */
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		max-height: 7.5rem;
		overflow-y: auto;
	}

	.chip {
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink);

		&.picked {
			border-color: var(--accent);
		}
	}
</style>
