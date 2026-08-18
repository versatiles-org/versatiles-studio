<script lang="ts">
	import type { Span, VplToken } from '../../ipc/commands';

	// The VPL text editor (S2.3, C1).
	//
	// A transparent <textarea> over a <pre> that renders the same text, highlighted (Q25). The
	// textarea keeps native selection, caret, IME and spellcheck behaviour — most of what a
	// hand-rolled editor gets wrong — while every colour comes from the parser's own tokens, so the
	// highlighting cannot disagree with what the parser understood.
	//
	// The two layers must agree on text metrics to the pixel, which is the one fragile part: they
	// share a font and spacing through the same tokens, and scrolling is mirrored below.
	// **The editor owns its buffer.** Echoing the text back down from the parent while the user is
	// typing means a round trip can land after the next keystroke and revert it — the caret jumps
	// and characters vanish. So the text comes in once, at mount, and the parent remounts this
	// component (with `{#key}`) when the document changes from somewhere else.
	let {
		initialText,
		tokens,
		problems,
		selection,
		onInput,
		onCaret
	}: {
		/** Read once. Change the key to load a different document. */
		initialText: string;
		/** From the core. Kept from the last good parse while the text does not parse. */
		tokens: VplToken[];
		/** Marked inline, and listed above the editor (C4). Several at once is normal. */
		problems?: { message: string; span: Span }[];
		/** A span to reveal and select — how a graph selection lands in the text (Q15). */
		selection?: Span | null;
		onInput: (text: string) => void;
		/** Fired with the caret offset, so the graph can follow the text (Q15). */
		onCaret?: (offset: number) => void;
	} = $props();

	let textarea = $state<HTMLTextAreaElement>();
	let pre = $state<HTMLPreElement>();

	/** What the textarea currently holds. The highlighting paints this, never the parent's copy. */
	// svelte-ignore state_referenced_locally
	let text = $state(initialText);

	/** The text split into painted runs. Gaps between tokens are whitespace and render bare. */
	type Piece = { text: string; kind: string | null; bad: boolean };

	const pieces = $derived.by((): Piece[] => {
		const out: Piece[] = [];
		const marked = problems ?? [];
		const bad = (from: number, to: number) =>
			marked.some((problem) => from < problem.span.end && to > problem.span.start);
		let cursor = 0;
		for (const token of tokens) {
			if (token.span.start > cursor) {
				out.push({ text: text.slice(cursor, token.span.start), kind: null, bad: bad(cursor, token.span.start) });
			}
			out.push({
				text: text.slice(token.span.start, token.span.end),
				kind: token.kind,
				bad: bad(token.span.start, token.span.end)
			});
			cursor = token.span.end;
		}
		if (cursor < text.length) out.push({ text: text.slice(cursor), kind: null, bad: bad(cursor, text.length) });
		// A trailing newline would otherwise not reserve a line in the <pre>, so the two layers
		// disagree about their height and the last line scrolls out of alignment.
		out.push({ text: '\n', kind: null, bad: false });
		return out;
	});

	$effect(() => {
		if (!selection || !textarea) return;
		const field = textarea;
		field.focus();
		field.setSelectionRange(selection.start, selection.end);
	});

	function sync() {
		if (!pre || !textarea) return;
		pre.scrollTop = textarea.scrollTop;
		pre.scrollLeft = textarea.scrollLeft;
	}
</script>

<div class="editor">
	<pre bind:this={pre} aria-hidden="true">{#each pieces as piece, i (i)}<span class={piece.kind} class:bad={piece.bad}
				>{piece.text}</span
			>{/each}</pre>
	<!-- The initial content, written once. Svelte does not re-set a textarea's child text on update,
	     which is exactly the behaviour this needs. -->
	<textarea
		bind:this={textarea}
		oninput={(event) => {
			text = event.currentTarget.value;
			onInput(text);
		}}
		spellcheck="false"
		autocomplete="off"
		autocapitalize="off"
		aria-label="VPL pipeline"
		aria-invalid={(problems?.length ?? 0) > 0}
		onscroll={sync}
		onselect={() => onCaret?.(textarea?.selectionStart ?? 0)}
		onkeyup={() => onCaret?.(textarea?.selectionStart ?? 0)}
		onclick={() => onCaret?.(textarea?.selectionStart ?? 0)}>{initialText}</textarea
	>
</div>

<style>
	.editor {
		position: relative;
		min-width: 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}

	/* Both layers take every metric from the same place. A difference of a fraction of a pixel in
	   any of these makes the highlighting drift from the text it is painting. */
	pre,
	textarea {
		margin: 0;
		padding: var(--space-3);
		border: 0;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: 1.5;
		tab-size: 2;
		white-space: pre-wrap;
		overflow-wrap: break-word;
		word-break: break-word;
	}

	pre {
		min-height: 5.5rem;
		max-height: 16rem;
		overflow: auto;
		/* The <pre> sizes the box; the textarea is laid over it. */
		color: var(--ink);

		:global(.operation) {
			color: var(--accent);
			font-weight: 600;
		}

		:global(.key) {
			color: var(--ink);
		}

		:global(.value) {
			color: var(--vpl-value);
		}

		:global(.punctuation) {
			color: var(--ink-2);
		}

		:global(.comment) {
			color: var(--ink-2);
			font-style: italic;
		}

		:global(.bad) {
			text-decoration: var(--error) wavy underline;
			text-underline-offset: 0.2em;
		}
	}

	textarea {
		position: absolute;
		inset: 0;
		resize: none;
		overflow: auto;
		background: transparent;
		/* Transparent text, visible caret — the <pre> underneath is what you read. */
		color: transparent;
		caret-color: var(--ink);

		&::selection {
			/* Selecting invisible text still has to look like a selection. */
			background: color-mix(in srgb, var(--accent) 28%, transparent);
		}

		&:focus-visible {
			outline-offset: -2px;
		}
	}

	/* Marked where it happened, rather than only described above the editor (C4). */
</style>
