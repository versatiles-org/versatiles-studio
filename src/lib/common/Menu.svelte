<script lang="ts">
	import { place, windowSize, type Placement } from './popup';

	// A button that opens a list of things to choose from ([Q58]).
	//
	// **Over the layout, not inside it.** Studio's first version of this revealed its choices in
	// flow, so opening `＋ new graph…` pushed the pane below it down - the two ways in were briefly
	// hard to tell from the list they had appeared above, and everything moved while you read them.
	// A popup covers rather than displaces, which is what a menu is for.
	//
	// **Positioned like `Help` and `Picker`, and for the same reason.** The sidebar scrolls and clips,
	// so a list drawn inside a pane cannot escape it; `position: fixed` from the trigger's measured
	// rectangle sidesteps that without portals. The arithmetic is `popup.ts`, shared rather than
	// written a fourth time. A scroll invalidates the measurement, so this closes rather than chases -
	// again `Picker`'s answer, and the honest one.
	//
	// **Not `Picker`**, which is the same shape for a different job: that one filters a long list of
	// things to insert and explains why a row is refused. This is a short list of verbs, so it has no
	// filter box and no room for one.

	export interface MenuItem {
		id: string;
		label: string;
		/** A second line, for a choice whose name does not say enough on its own. */
		description?: string;
		disabled?: boolean;
	}

	let {
		label,
		items,
		onPick,
		title,
		onClose
	}: {
		/** What the trigger says. */
		label: string;
		items: MenuItem[];
		/**
		 * Chosen. Returning `'keep'` leaves the menu open, which is how a choice that leads to another
		 * list works without the flicker of closing and opening again.
		 */
		onPick: (id: string) => void | 'keep';
		title?: string;
		/**
		 * Closed, however it was closed.
		 *
		 * A caller that swapped the list for another one needs to put the first back: reopening on a
		 * list somebody had walked into would answer a question they had not asked again.
		 */
		onClose?: () => void;
	} = $props();

	let open = $state(false);
	let rect = $state<DOMRect | null>(null);
	/// The row Enter would choose. Kept as an index into `choosable`, so a disabled row is never it.
	let active = $state(0);
	let trigger = $state<HTMLButtonElement>();
	let list = $state<HTMLElement>();

	const id = $props.id();
	const choosable = $derived(items.filter((item) => !item.disabled));
	const at = $derived<Placement | null>(rect ? place(rect, windowSize()) : null);

	function show() {
		rect = trigger?.getBoundingClientRect() ?? null;
		active = 0;
		open = true;
	}

	function hide() {
		if (!open) return;
		open = false;
		rect = null;
		onClose?.();
	}

	function choose(item: MenuItem) {
		if (item.disabled) return;
		if (onPick(item.id) === 'keep') {
			// The list it leads to is a different list in the same place, so the measurement stands and
			// the walk starts again at the top.
			active = 0;
			return;
		}
		hide();
		trigger?.focus();
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			hide();
			trigger?.focus();
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			// Wrapping, because a menu is a ring of a few items and walking off the end of one is more
			// surprising than arriving back at the top.
			active = (active + step + choosable.length) % Math.max(choosable.length, 1);
			return;
		}
		if (event.key === 'Enter' || event.key === ' ') {
			const item = choosable[active];
			if (item) {
				event.preventDefault();
				choose(item);
			}
		}
	}

	// Focus goes into the list when it opens, so the arrows reach it and a blur can close it.
	$effect(() => {
		if (open) list?.focus();
	});
</script>

<svelte:window
	onresize={hide}
	onscroll={hide}
	onpointerdown={(event) => {
		if (!open) return;
		const target = event.target as Node;
		if (!list?.contains(target) && !trigger?.contains(target)) hide();
	}}
/>

<button
	type="button"
	class="trigger"
	bind:this={trigger}
	aria-haspopup="menu"
	aria-expanded={open}
	aria-controls={open ? id : undefined}
	{title}
	onclick={() => (open ? hide() : show())}
>
	{label}
</button>

{#if open && at}
	<ul
		{id}
		class="menu"
		role="menu"
		tabindex="-1"
		bind:this={list}
		onkeydown={onKey}
		style:left="{at.left}px"
		style:width="{at.width}px"
		style:top={at.top === undefined ? undefined : `${at.top}px`}
		style:bottom={at.bottom === undefined ? undefined : `${at.bottom}px`}
	>
		{#each items as item (item.id)}
			<li role="none">
				<button
					type="button"
					role="menuitem"
					class="item"
					class:active={!item.disabled && choosable[active]?.id === item.id}
					disabled={item.disabled}
					onclick={() => choose(item)}
					onpointerenter={() => {
						const index = choosable.findIndex((each) => each.id === item.id);
						if (index >= 0) active = index;
					}}
				>
					<span class="name">{item.label}</span>
					{#if item.description}<span class="detail">{item.description}</span>{/if}
				</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.trigger {
		font-size: var(--text-sm);
		color: var(--ink-2);

		&:hover,
		&[aria-expanded='true'] {
			color: var(--ink);
		}
	}

	/* Above the panes and the map's own chrome, since it is opened from inside one and has to cover
	   whatever it was opened over. */
	.menu {
		position: fixed;
		z-index: 40;
		margin: 0;
		padding: var(--space-2);
		max-height: 60vh;
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--float-bg);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow);
	}

	.item {
		display: block;
		width: 100%;
		text-align: left;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius);
		font-size: var(--text-sm);

		/* One highlight for the pointer and the arrow keys both, because they are one question:
		   which row would happen if you committed now. */
		&.active:not(:disabled) {
			background: var(--chrome);
		}

		&:disabled {
			opacity: 0.5;
		}
	}

	.name {
		display: block;
		color: var(--ink);
	}

	.detail {
		display: block;
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
</style>
