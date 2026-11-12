<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import Group from '../../common/Group.svelte';
	import Modal from '../../common/Modal.svelte';
	import Note from '../../common/Note.svelte';
	import type { ExpressionName } from '../../ipc/commands';
	import type { Vocabulary } from '../../state/vocabulary.svelte';
	import { GEOMETRY_TYPES, insertAt, keysOf, propertyRef, quoted, valuePiece } from './expression';

	// The helper behind an expression - `vector_branch`'s and `vector_filter_features`'s `expr`.
	//
	// **A helper, not the field**, and it commits once, on Use, for the reasons `StepsDialog` gives.
	// What it shows that the line hides is what an expression can say: the `$` names, the source's
	// properties, and the values those hold - each a click away from being written where the caret
	// is.
	//
	// **Checked when asked, not while typed.** It checked after every pause, and a pause is mostly
	// a thought half-finished - `$layer ==` on its way to a value was called wrong each time. Now it
	// is checked once on opening and then on Check (or ⌘/Ctrl+Enter); an edit since leaves the last
	// verdict in its box, faded, as an answer about what was there before.
	let {
		value,
		name,
		operation,
		names,
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
		/** The operation it belongs to, which upstream's messages are about. */
		operation: string;
		/** The `$` names an expression reads, as the field's control carries them. */
		names: ExpressionName[];
		/** What the selected source's tiles hold - see `vocabulary.svelte.ts`. */
		vocabulary: Vocabulary;
		/** What is wrong with an expression, in upstream's words - nothing when it is fine. */
		check: (text: string) => Promise<string[]>;
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

	/// Upstream's answer for the last expression it was asked about; `null` before the first.
	let problems = $state<string[] | null>(null);
	/// Whether the text has changed since that answer.
	let changed = $state(false);
	/// Whether a check is on its way.
	let checking = $state(false);
	/// The newest question; an answer to an older one is dropped.
	let asked = 0;

	async function run(): Promise<void> {
		const ticket = ++asked;
		const text = draft.trim();
		checking = true;
		const found = text === '' ? [] : await check(text);
		if (ticket !== asked) return;
		problems = found;
		changed = false;
		checking = false;
	}

	/// An edit leaves the last verdict standing, marked as being about what was there before.
	const edited = (): void => {
		changed = true;
	};

	onMount(() => void run());

	// -- what can be picked ---------------------------------------------------------------------

	/// The layer the properties are for, or every layer together.
	let layer = $state<string | null>(null);
	const keys = $derived(keysOf(vocabulary.layers, layer));

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

	/// Writes `piece` where the caret was, and puts the caret after it.
	async function insert(piece: string): Promise<void> {
		const next = insertAt(draft, selection.start, selection.end, piece);
		draft = next.text;
		selection = { start: next.caret, end: next.caret };
		edited();
		await tick();
		box?.focus();
		box?.setSelectionRange(next.caret, next.caret);
	}
</script>

<Modal title="Expression: {name}" width="34rem" {onClose}>
	<textarea
		class="text"
		rows="3"
		spellcheck="false"
		aria-label="Expression for {name}"
		bind:this={box}
		bind:value={draft}
		oninput={() => {
			remember();
			edited();
		}}
		onkeydown={(event) => {
			if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				void run();
			}
		}}
		onkeyup={remember}
		onclick={remember}
		onselect={remember}></textarea>

	<!-- **A box of its own, always there, of one height.** A verdict that came and went resized the
	     dialog under the caret. Faded while the text has moved on from the answer. -->
	<div class="check">
		<button type="button" class="button" disabled={checking} onclick={() => void run()}>Check</button>
		<span class="keys">{changed && problems !== null ? 'Changed since the check' : '⌘/Ctrl + Enter'}</span>
	</div>
	<div class="status" class:changed role="status" aria-live="polite">
		{#if draft.trim() === ''}
			<Note tone="aside">Empty: Use clears the parameter.</Note>
		{:else if problems === null}
			<Note tone="aside">Checking…</Note>
		{:else if problems.length === 0}
			<Note tone="aside">Reads as an expression.</Note>
		{:else}
			<!-- Upstream's message as it is laid out: it repeats the expression and points under the
			     column that is wrong (`| .......^`), which only lines up unwrapped and in one width. -->
			<pre class="compiler">'{operation}' {problems.join('\n\n')}</pre>
		{/if}
	</div>

	<Group title="Names">
		<div class="chips">
			{#each names as entry (entry.name)}
				<button
					type="button"
					class="chip"
					class:picked={picked === entry.name}
					title={entry.doc}
					onclick={() => {
						picked = entry.name;
						void insert(entry.name);
					}}>{entry.name}</button
				>
			{/each}
		</div>
	</Group>

	<Group title="Properties">
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
		{#if keys.length === 0}
			<Note tone="empty">No properties known yet.</Note>
		{:else}
			<div class="chips">
				{#each keys as key (key.key)}
					<button
						type="button"
						class="chip"
						class:picked={picked === key.key}
						title={key.features > 0 ? `${key.features} features` : undefined}
						onclick={() => {
							picked = key.key;
							void insert(propertyRef(key.key));
						}}>{key.key}</button
					>
				{/each}
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
						>{entry.literal}</button
					>
				{/each}
			</div>
			{#if pickedMore}
				<Note tone="aside">The commonest of more values.</Note>
			{/if}
		{:else if vocabulary.read === 'none'}
			<Note tone="hint">
				Values come from reading the layers.
				{#snippet action()}
					<button type="button" class="quiet" disabled={vocabulary.scanning} onclick={onScan}
						>{vocabulary.scanning ? 'Reading…' : 'Read layers'}</button
					>
				{/snippet}
			</Note>
		{:else}
			<Note tone="empty">No values read for it.</Note>
		{/if}
		{#if vocabulary.read === 'sampled' && values.length > 0}
			<Note tone="aside">From a sample of the tiles.</Note>
		{/if}
	</Group>

	{#snippet actions()}
		<button type="button" class="button" onclick={onClose}>Cancel</button>
		<button type="button" class="button primary" onclick={() => onUse(draft.trim())}>Use</button>
	{/snippet}
</Modal>

<style>
	.text {
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
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

	/* Six lines of the message's own font, scrolling both ways inside rather than growing. */
	.status {
		box-sizing: border-box;
		line-height: 1.4;
		height: calc(6 * 1.4em + 2 * var(--space-3));
		overflow: auto;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--chrome);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		transition: opacity 120ms ease;

		&.changed {
			opacity: 0.45;
		}
	}

	.compiler {
		margin: 0;
		font: inherit;
		white-space: pre;
		color: var(--ink);
	}

	.layer {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-xs);
		color: var(--ink-2);
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
