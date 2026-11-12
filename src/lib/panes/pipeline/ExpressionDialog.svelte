<script lang="ts">
	import { onDestroy, onMount, tick, untrack } from 'svelte';
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
	// **Checked as it is typed, without being in the way.** The check waits for a pause, so a word
	// half-written is not called wrong; until it answers, the last answer stays, faded, rather than
	// the line flickering between verdicts. Nothing turns red while you type.
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
	let timer: ReturnType<typeof setTimeout> | undefined;
	/// The newest question; an answer to an older one is dropped.
	let asked = 0;

	async function run(): Promise<void> {
		const ticket = ++asked;
		const text = draft.trim();
		const found = text === '' ? [] : await check(text);
		if (ticket !== asked) return;
		problems = found;
		changed = false;
	}

	/// Half a second after the typing stops: long enough not to judge a word being written, short
	/// enough that the answer is there when the eyes come back to it.
	function schedule(): void {
		changed = true;
		clearTimeout(timer);
		timer = setTimeout(() => void run(), 500);
	}

	onMount(() => void run());
	onDestroy(() => clearTimeout(timer));

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
		schedule();
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
			schedule();
		}}
		onkeyup={remember}
		onclick={remember}
		onselect={remember}></textarea>

	<!-- Faded while the text has moved on from the answer, so the line never jumps between
	     verdicts mid-word. -->
	<div class="status" class:changed>
		{#if draft.trim() === ''}
			<Note live tone="aside">Empty: Use clears the parameter.</Note>
		{:else if problems === null}
			<Note live tone="aside">Checking…</Note>
		{:else if problems.length === 0}
			<Note live tone="aside">Reads as an expression.</Note>
		{:else}
			<Note live tone="problem">'{operation}' {problems.join(' ')}</Note>
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

	.status {
		transition: opacity 120ms ease;

		&.changed {
			opacity: 0.45;
		}
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
