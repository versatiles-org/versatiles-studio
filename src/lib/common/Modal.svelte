<script lang="ts">
	import type { Snippet } from 'svelte';

	// The shell every modal in Studio shares.
	//
	// Three of them had grown their own — export, save-a-copy, and the since-removed deploy dialog —
	// and the parts that differed
	// were the title, the width and what goes inside. Everything else was the same code three times:
	// `.actions` and `.primary` were byte-identical, `.body` in two of three, and each repeated the
	// `showModal()` effect and the `oncancel`/`onclose` wiring.
	//
	// A native `<dialog>`, for the reasons each of them gave separately: modality, focus containment
	// and Escape are the browser's, and the top layer puts it above every z-index in the application
	// — including the status bar.

	let {
		title,
		/** How wide it wants to be. A table of artefacts needs more room than four number fields. */
		width = '28rem',
		onClose,
		children,
		actions
	}: {
		title: string;
		width?: string;
		onClose: () => void;
		children: Snippet;
		/** The buttons. Laid out for you; which ones there are is yours. */
		actions: Snippet;
	} = $props();

	let dialog = $state<HTMLDialogElement>();

	// `showModal()` rather than the `open` attribute: only the method puts the element in the top
	// layer and makes Escape and focus containment work.
	$effect(() => dialog?.showModal());
</script>

<dialog bind:this={dialog} oncancel={onClose} onclose={onClose} aria-label={title} style="--modal-width: {width}">
	<div class="body">
		<h2>{title}</h2>
		{@render children()}
		<div class="actions">{@render actions()}</div>
	</div>
</dialog>

<style>
	dialog {
		/* The one thing that genuinely varies between them. */
		width: min(var(--modal-width), calc(100vw - var(--space-6)));
		padding: 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		background: var(--surface);
		color: var(--ink);

		&::backdrop {
			background: var(--scrim);
		}
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
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

		/* A dialog has room the panes do not, and these are the buttons it is asking about — so they
		   are bigger than `.button`'s compact default rather than the same size as a pane's export
		   button. `:global` because the buttons come from the caller's snippet and carry its scope,
		   not this one's; the `.actions` above it keeps that from reaching anything else. */
		:global(.button) {
			padding: var(--space-3) var(--space-5);
		}
	}
</style>
