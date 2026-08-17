<script lang="ts">
	import type { Snippet } from 'svelte';

	// One collapsible section of the left pane (Q22).
	//
	// A real <button> rather than a styled <div>, and a real aria-expanded, because the header is
	// the only way to reach the content — a section that keyboard users cannot open is a section
	// they cannot use. <details>/<summary> would give this for free but not the controlled `open`
	// state, which has to round-trip through the core (Q16).
	//
	// Controlled rather than `$bindable`: the durable copy lives in the core, so a local mirror
	// would need an effect to follow it and another to push changes back — two effects reading and
	// writing the same value, which is how `effect_update_depth_exceeded` happens. One prop in, one
	// callback out, no state here at all.
	let {
		title,
		open,
		count,
		onToggle,
		children
	}: {
		title: string;
		open: boolean;
		/** Shown beside the title when there is something to count. */
		count?: number;
		onToggle: (open: boolean) => void;
		children: Snippet;
	} = $props();

	const id = $derived(`section-${title.toLowerCase()}`);
</script>

<section class="section" class:open>
	<h2>
		<button type="button" aria-expanded={open} aria-controls={id} onclick={() => onToggle(!open)}>
			<span class="chevron" aria-hidden="true">▸</span>
			<span class="title">{title}</span>
			{#if count !== undefined}<span class="count">{count}</span>{/if}
		</button>
	</h2>
	<!-- Kept in the DOM while collapsed would mean rebuilding editor state on every toggle; removed
	     means losing it. Removed is right for now — nothing in here holds state yet — and this is
	     the line to revisit when the VPL editor lands at S2.3. -->
	{#if open}
		<div class="body" {id}>{@render children()}</div>
	{/if}
</section>

<style>
	.section {
		border-bottom: 1px solid var(--rule);
	}
	h2 {
		margin: 0;
		font-size: inherit;
		font-weight: inherit;
	}
	button {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-3) var(--space-4);
		border: 0;
		background: none;
		font: inherit;
		color: var(--ink-2);
		text-align: left;
	}
	button:hover {
		background: var(--chrome);
		color: var(--ink);
	}
	/* Inset, because the header runs the full width of the pane and a ring outside it would be
	   clipped. Colour and width come from base.css. */
	button:focus-visible {
		outline-offset: -2px;
	}
	.chevron {
		display: inline-block;
		font-size: var(--text-xs);
		transition: transform 120ms ease;
		color: var(--ink-2);
	}
	.section.open .chevron {
		transform: rotate(90deg);
	}
	.title {
		font-size: var(--text-sm);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		font-weight: 600;
	}
	.count {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}
	.body {
		padding: var(--space-1) var(--space-4) var(--space-4);
	}

	@media (prefers-reduced-motion: reduce) {
		.chevron {
			transition: none;
		}
	}
</style>
