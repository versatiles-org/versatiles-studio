<script lang="ts">
	import type { Snippet } from 'svelte';

	// A button on the map that opens a panel under it.
	//
	// **Shared, because "the same as the views one" is a requirement rather than a coincidence.** The
	// saved views had the only one of these, and the background picker was a bare `<select>` - which
	// on macOS is a native popup that obeys none of the map's chrome, and everywhere else is a
	// control that looks like a form field on a map made of buttons. Written twice they would have
	// drifted the way the three hand-rolled overlays did before [Q46]; written once, "same style" is
	// something neither of them can get wrong.
	//
	// What is shared is the box and the dismissing - the toggle, where the panel sits, closing on
	// Escape or on a pointer landing outside. What is in the panel is the caller's.

	let {
		/** What the toggle says. The current choice, not the category, so it reports as well as opens. */
		label,
		title,
		/** Panel width. A list of names wants more room than a list of four backgrounds. */
		width = '15rem',
		/** Rendered inside the panel, and handed `close` so a choice can shut it. */
		panel,
		/** Also called when Escape or a click outside closes it, so a caller can drop a half-edit. */
		onClose
	}: {
		label: string;
		title: string;
		width?: string;
		panel: Snippet<[() => void]>;
		onClose?: () => void;
	} = $props();

	let open = $state(false);
	/// The whole control, so a pointer landing anywhere inside it does not count as clicking away.
	let root = $state<HTMLDivElement>();

	function close() {
		if (!open) return;
		open = false;
		onClose?.();
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') close();
	}}
	onpointerdown={(event) => {
		if (open && root && !root.contains(event.target as Node)) close();
	}}
/>

<div class="dropdown" class:open bind:this={root}>
	<button
		type="button"
		class="toggle"
		class:on={open}
		aria-expanded={open}
		{title}
		onclick={() => (open ? close() : (open = true))}
	>
		<span class="truncate">{label}</span>
		<span class="caret" aria-hidden="true">▾</span>
	</button>

	{#if open}
		<div class="panel" style:width>
			{@render panel(close)}
		</div>
	{/if}
</div>

<style>
	/* The anchor for the panel.
	   
	   **Lifted only while open**, which is the whole of it: a constant `z-index` put every dropdown
	   on the same layer, so the *later* one in the stack painted its toggle over the *earlier* one's
	   open panel - the saved views disappearing behind the background button. Raising the open one
	   needs no coordination, because opening a second dropdown dismisses the first. */
	.dropdown {
		position: relative;

		&.open {
			z-index: 2;
		}
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		max-width: 11rem;
		font-size: var(--text-sm);
		padding: var(--space-2) var(--space-3);
		background: var(--float-bg);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		box-shadow: var(--shadow);

		&.on {
			border-color: var(--accent);
		}
	}

	.caret {
		color: var(--ink-2);
		flex: none;
	}

	/* Downward into the map rather than upward past the window edge - which is why these controls
	   are at the top ([Q52]). */
	.panel {
		position: absolute;
		top: calc(100% + var(--space-2));
		left: 0;
		max-height: 60vh;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: var(--space-3);
		background: var(--float-bg);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}
</style>
