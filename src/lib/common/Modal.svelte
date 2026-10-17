<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	// The shell every modal in Studio shares.
	//
	// Three of them had grown their own - export, save-a-copy, and the since-removed deploy dialog -
	// and the parts that differed
	// were the title, the width and what goes inside. Everything else was the same code three times:
	// `.actions` and `.primary` were byte-identical, `.body` in two of three, and each repeated the
	// `showModal()` effect and the `oncancel`/`onclose` wiring.
	//
	// A native `<dialog>`, for the reasons each of them gave separately: modality, focus containment
	// and Escape are the browser's, and the top layer puts it above every z-index in the application
	// - including the status bar.
	//
	// **A workspace as well as a question.** Most of them ask something and end in buttons. The tile
	// dialog is somewhere to look around instead: it has a `height`, so it keeps its size from one
	// tile to the next and what is clicked stays under the pointer, and no `actions` - its controls
	// sit in the `header` beside the title, and the ✕ closes it.

	let {
		title,
		heading = title,
		/** How wide it wants to be. A table of artefacts needs more room than four number fields. */
		width = '28rem',
		height,
		onClose,
		children,
		header,
		actions
	}: {
		/** What it is called, to assistive technology and - unless `heading` says otherwise - on screen. */
		title: string;
		/** The words on screen, when the `header` beside them already says the rest of the title. */
		heading?: string;
		width?: string;
		/** A fixed height, for one whose content changes under the reader; otherwise it fits it. */
		height?: string;
		onClose: () => void;
		children: Snippet;
		/** Controls on the title's line. */
		header?: Snippet;
		/** The buttons. Laid out for you; which ones there are is yours. Without them there is a ✕. */
		actions?: Snippet;
	} = $props();

	let dialog = $state<HTMLDialogElement>();

	// `showModal()` rather than the `open` attribute: only the method puts the element in the top
	// layer and makes Escape and focus containment work.
	$effect(() => dialog?.showModal());
</script>

<dialog
	bind:this={dialog}
	oncancel={onClose}
	onclose={onClose}
	aria-label={title}
	class:fixed={height !== undefined}
	style="--modal-width: {width}; --modal-height: {height ?? 'auto'}"
>
	<div class="body">
		<div class="head">
			<h2>{heading}</h2>
			{#if header}<div class="extra">{@render header()}</div>{/if}
			{#if !actions}
				<button type="button" class="icon close" aria-label="Close" onclick={onClose}><Icon name="remove" /></button>
			{/if}
		</div>
		{@render children()}
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</div>
</dialog>

<style>
	dialog {
		/* The one thing that genuinely varies between them. */
		width: min(var(--modal-width), calc(100vw - var(--space-6)));
		/* Never taller than the window: the launcher is 880×580, and a dialog running past its bottom
		   edge put the buttons out of reach. A flex column, so a child that is allowed to shrink
		   (`min-height: 0`, its own scroller) gives way first and the title and buttons stay on
		   screen; one that is not still scrolls, as the whole body. */
		max-height: calc(100vh - var(--space-6));
		padding: 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		background: var(--surface);
		color: var(--ink);

		&::backdrop {
			background: var(--scrim);
		}

		/* The body fills it, and the caller's content takes what the title row leaves. */
		&.fixed {
			height: min(var(--modal-height), calc(100vh - var(--space-6)));

			.body {
				height: 100%;
			}
		}
	}

	.head {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-width: 0;
	}

	/* What the caller puts on the title's line takes the rest of it, so its own `margin-left: auto`
	   reaches the far end - and the ✕ comes after it either way. */
	.extra {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		gap: var(--space-4);
		min-width: 0;
	}

	.close {
		margin-left: auto;
		font-size: var(--text-lg);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-height: calc(100vh - var(--space-6));
		box-sizing: border-box;
		overflow-y: auto;
		padding: var(--space-5);
	}

	h2 {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);

		/* A dialog has room the panes do not, and these are the buttons it is asking about - so they
		   are bigger than `.button`'s compact default rather than the same size as a pane's export
		   button. `:global` because the buttons come from the caller's snippet and carry its scope,
		   not this one's; the `.actions` above it keeps that from reaching anything else. */
		:global(.button) {
			padding: var(--space-3) var(--space-5);
		}
	}
</style>
