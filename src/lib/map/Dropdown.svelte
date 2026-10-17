<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '../common/Icon.svelte';

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
		onClose,
		/**
		 * Drawn instead of the label, for a square button in a column of them. The label is then what a
		 * screen reader hears, and `title` what a pointer does.
		 */
		icon,
		/** `below` for the controls along the top; `left` for the column down the right edge. */
		placement = 'below',
		/** No surface of its own: for a button set into another control, which carries the border. */
		bare = false
	}: {
		label: string;
		title: string;
		width?: string;
		panel: Snippet<[() => void]>;
		onClose?: () => void;
		icon?: Snippet;
		placement?: 'below' | 'left';
		bare?: boolean;
	} = $props();

	let open = $state(false);
	/// The whole control, so a pointer landing anywhere inside it does not count as clicking away.
	let root = $state<HTMLDivElement>();

	function close() {
		if (!open) return;
		open = false;
		onClose?.();
	}

	/// The arrows walk the panel's controls, the way they walk a menu or a picker: this was the one
	/// popup where a keyboard could only Tab through a list of twelve backgrounds.
	///
	/// Over the whole control, so an arrow pressed on the toggle lands on the first control, and
	/// wrapping at both ends because a panel is a short ring of choices.
	function walk(event: KeyboardEvent) {
		if (!open || !root || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
		const controls = [
			...root.querySelectorAll<HTMLElement>('.panel button:not(:disabled), .panel input:not(:disabled)')
		];
		if (controls.length === 0) return;
		event.preventDefault();
		const at = controls.indexOf(document.activeElement as HTMLElement);
		const step = event.key === 'ArrowDown' ? 1 : -1;
		controls[at < 0 ? (step > 0 ? 0 : controls.length - 1) : (at + step + controls.length) % controls.length].focus();
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="dropdown" class:open bind:this={root} onkeydown={walk}>
	<button
		type="button"
		class="toggle"
		class:on={open}
		class:square={icon !== undefined}
		class:bare
		aria-expanded={open}
		aria-label={icon ? label : undefined}
		{title}
		onclick={() => (open ? close() : (open = true))}
	>
		{#if icon}
			{@render icon()}
		{:else}
			<span class="truncate">{label}</span>
			<span class="caret" aria-hidden="true"><Icon name="chevron" size="1em" /></span>
		{/if}
	</button>

	{#if open}
		<div class="panel popover {placement}" style:width>
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

		/* An icon in a square, the size of the other buttons in the column it sits in. */
		&.square {
			justify-content: center;
			width: 2rem;
			height: 2rem;
			padding: 0;
		}

		&.bare {
			border-color: transparent;
			border-radius: 0;
			background: none;
			box-shadow: none;

			&:hover,
			&.on {
				background: var(--chrome);
			}
		}
	}

	/* The kit's chevron, turned to point down at the panel it opens. */
	.caret {
		display: flex;
		flex: none;
		color: var(--ink-2);
		transform: rotate(90deg);
	}

	/* Downward into the map rather than upward past the window edge - which is why these controls
	   are at the top ([Q52]). The face is the kit's `.popover`; this is where it sits. */
	.panel {
		position: absolute;
		top: calc(100% + var(--space-2));
		left: 0;
		max-height: 60vh;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: var(--space-3);

		/* Out of the right-hand column, into the map - beside the button rather than under it, where
		   the next button in the column is. */
		&.left {
			top: 0;
			left: auto;
			right: calc(100% + var(--space-2));
		}
	}
</style>
