<script lang="ts">
	import type { Snippet } from 'svelte';
	import { describe, record } from '../state/diagnostics.svelte';

	// One part of the window failing, instead of all of it (S6.8).
	//
	// **What this catches is the failure with no other route.** An error thrown while a component
	// renders, or inside an `$effect`, is not a rejected promise and not a `window.onerror` — Svelte
	// unmounts the tree that threw and, without a boundary, that tree is the whole application. A
	// pane with a bad value in it took the map, the editor and the status bar down with it.
	//
	// **Not event handlers, and not `await`.** Those already have somewhere to go: a handler's throw
	// reaches `window.onerror`, an unawaited promise reaches `unhandledrejection`, and both are
	// listened for in `state/diagnostics.svelte.ts`. This is the third route, not a replacement.
	//
	// **Retry is offered because it usually works.** These failures are ordinarily a component
	// meeting a shape it did not expect — a container whose format nothing has seen, a style with a
	// field missing — and the next document, or the same one after an edit, renders fine. Reloading
	// the window to find that out would cost every other pane's state.

	let {
		/** What failed, in the words the surrounding interface already uses — a pane's own title. */
		label,
		children
	}: { label: string; children: Snippet } = $props();
</script>

<svelte:boundary
	onerror={(error) => {
		const { message, detail } = describe(error);
		// Named, because "Cannot read properties of undefined" says nothing about where it happened
		// and the stack in the detail is minified in a release build.
		record({ level: 'error', origin: 'webview', message: `${label}: ${message}`, detail });
	}}
>
	{@render children()}

	{#snippet failed(error, reset)}
		<!-- Deliberately small and in place: the rest of the window is still working, and a full-width
		     apology would suggest otherwise. The message goes in the title rather than the body —
		     what a person can act on is the retry, and the detail is in the problems panel. -->
		<p class="failed" title={describe(error).message}>
			<span>{label} stopped working.</span>
			<button type="button" onclick={reset}>Try again</button>
		</p>
	{/snippet}
</svelte:boundary>

<style>
	.failed {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0;
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-sm);
		color: var(--error);
		background: var(--error-bg);
	}

	button {
		flex: none;
		padding: 0 var(--space-2);
		color: var(--ink-2);
		text-decoration: underline;

		&:hover {
			color: var(--ink);
		}
	}
</style>
