<script lang="ts" module>
	export interface Tab {
		id: string;
		label: string;
		/** A count on the tab - the problems the VPL text has - and what to call it to a screen reader. */
		badge?: { count: number; label: string };
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	// A row of tabs over one panel (the kit, S13).
	//
	// **Three tab strips had three looks and two ARIA patterns**: the Pipeline pane's at label size
	// with the accent underline and no arrow keys, the remote dialog's at body size with a bold
	// underline in the text colour and arrow keys, and the problems panel's as pressed buttons. One
	// part, one look, and the arrows everywhere - a tab list is the one list where left and right
	// are the expected keys.
	//
	// **Selecting follows focus.** Arrowing onto a tab shows it, the way every native tab strip
	// does, so there is no second press to learn. The selected tab is the only one in the tab order;
	// the others are reached from it with the arrows.
	//
	// What the tabs switch between is the caller's. `controls` names the one panel when there is one
	// so a screen reader can follow; the Pipeline pane swaps its body in place and has none.
	let {
		items,
		selected,
		onSelect,
		label,
		controls,
		trailing
	}: {
		items: Tab[];
		selected: string;
		onSelect: (id: string) => void;
		/** What the strip is for, for a screen reader. */
		label: string;
		/** The id of the panel the tabs switch, when there is one element that is it. */
		controls?: string;
		/** Controls at the far end of the strip - the Pipeline pane's undo and redo. */
		trailing?: Snippet;
	} = $props();

	const id = $props.id();
	const tabId = (tab: Tab) => `${id}-${tab.id}`;

	let buttons = $state<HTMLButtonElement[]>([]);

	function onKey(event: KeyboardEvent) {
		const at = items.findIndex((tab) => tab.id === selected);
		let next: number;
		if (event.key === 'ArrowRight') next = (at + 1) % items.length;
		else if (event.key === 'ArrowLeft') next = (at + items.length - 1) % items.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = items.length - 1;
		else return;
		event.preventDefault();
		onSelect(items[next].id);
		buttons[next]?.focus();
	}
</script>

<div class="tabs" role="tablist" aria-label={label}>
	{#each items as tab, index (tab.id)}
		<button
			bind:this={buttons[index]}
			type="button"
			role="tab"
			class="tab"
			id={tabId(tab)}
			aria-selected={tab.id === selected}
			aria-controls={controls}
			tabindex={tab.id === selected ? 0 : -1}
			onclick={() => onSelect(tab.id)}
			onkeydown={onKey}
		>
			{tab.label}
			{#if tab.badge && tab.badge.count > 0}
				<span class="badge" aria-label={tab.badge.label}>{tab.badge.count}</span>
			{/if}
		</button>
	{/each}
	{#if trailing}<div class="trailing">{@render trailing()}</div>{/if}
</div>

<style>
	.tabs {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-width: 0;
		border-bottom: 1px solid var(--rule);
	}

	/* The selected tab is the one in full ink with the accent under it; the rest are secondary. No
	   change of weight, which would move the tabs beside it as the selection moves. */
	.tab {
		flex: none;
		padding: var(--space-2) var(--space-3);
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		font-size: var(--text-sm);
		color: var(--ink-2);

		&[aria-selected='true'] {
			color: var(--ink);
			border-bottom-color: var(--accent);
		}

		&:hover {
			color: var(--ink);
		}

		/* Inset: the strip's rule runs under the tab, and a ring outside it would be clipped. */
		&:focus-visible {
			outline-offset: -2px;
		}
	}

	.badge {
		display: inline-block;
		margin-left: var(--space-1);
		padding: 0 var(--space-1);
		border-radius: var(--radius);
		background: var(--error);
		color: var(--accent-ink);
		font-size: var(--text-xs);
	}

	.trailing {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		margin-left: auto;
	}
</style>
