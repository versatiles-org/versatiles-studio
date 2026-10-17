<script lang="ts">
	import Icon from '../common/Icon.svelte';
	import type { Snippet } from 'svelte';
	import Boundary from './Boundary.svelte';

	// One pane: a titled, collapsible box in a sidebar (Q22, [Q31]).
	//
	// Deliberately knows nothing about what it holds or which sidebar it is in. That is what makes
	// a pane cheap enough to be the unit the analysis cluster is built from - eight more of them
	// are coming - and what will make reordering them a change to a list rather than to this file.
	//
	// A real <button> rather than a styled <div>, and a real aria-expanded, because the header is
	// the only way to reach the content - a section that keyboard users cannot open is a section
	// they cannot use. <details>/<summary> would give this for free but not the controlled `open`
	// state, which has to round-trip through the core (Q16).
	//
	// Controlled rather than `$bindable`: the durable copy lives in the core, so a local mirror
	// would need an effect to follow it and another to push changes back - two effects reading and
	// writing the same value, which is how `effect_update_depth_exceeded` happens. One prop in, one
	// callback out, no state here at all.
	let {
		title,
		detail = null,
		badge = null,
		open,
		onToggle,
		children
	}: {
		title: string;
		/**
		 * What the pane is about, beside its title: the selected graph's name, or "project" for a pane
		 * that spans every graph (S10.4). In the header rather than in the body so a folded pane still
		 * says it - the chain alternates scope from pane to pane, and nothing else said which was which.
		 */
		detail?: string | null;
		/**
		 * A count that wants attention - the Analysis pane's spec violations (S14.8) - and what to call
		 * it to a screen reader. In the header, so a folded pane still raises it.
		 */
		badge?: { count: number; label: string } | null;
		open: boolean;
		onToggle: (open: boolean) => void;
		children: Snippet;
	} = $props();

	const id = $derived(`pane-${title.toLowerCase().replace(/\s+/g, '-')}`);
</script>

<section class="section" class:open>
	<h2>
		<button type="button" aria-expanded={open} aria-controls={id} onclick={() => onToggle(!open)}>
			<span class="chevron" class:open aria-hidden="true"><Icon name="chevron" size="1em" /></span>
			<span class="title section-label">{title}</span>
			<!-- Its own span, in the ordinary case rather than the label's uppercase: a graph's name is
			     a name, and `button*=Title` in the e2e helper has to keep matching the heading. -->
			{#if detail}<span class="detail truncate">{detail}</span>{/if}
			{#if badge && badge.count > 0}<span class="badge" aria-label={badge.label}>{badge.count}</span>{/if}
		</button>
	</h2>
	<!-- **Kept in the DOM while folded, and hidden** (S10.7). Removing it threw away whatever the
	     contents held locally - the Graph/VPL tab, a VPL draft, the Layers filter and which groups
	     were open, a slider mid-gesture - so "sections remember whether they are open" was true of
	     the fold and false of everything behind it. `hidden` is `display: none`, which also takes the
	     contents out of the tab order; nothing inside is reachable until the header opens it. -->
	<!-- Each pane inside its own boundary, which is the unit that makes sense: a pane is already the
	     thing that knows nothing about its neighbours (Q31), so one of them meeting a shape it did
	     not expect should cost that pane and nothing else. Here rather than in `Sidebar` because
	     this is where the title lives, and a failure has to say which pane it was. -->
	<div class="body" {id} hidden={!open}>
		<Boundary label={title}>{@render children()}</Boundary>
	</div>
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
		color: var(--ink-2);
		text-align: left;

		&:hover {
			background: var(--chrome);
			color: var(--ink);
		}

		/* Inset, because the header runs the full width of the pane and a ring outside it would be
		   clipped. Colour and width come from base.css. */
		&:focus-visible {
			outline-offset: -2px;
		}
	}

	.title {
		flex: none;
	}

	/* Quieter than the title and after it, so the row reads "STYLE · osm". Truncates rather than
	   wrapping: a long graph name must not make the header two lines tall. */
	.detail {
		flex: 1;
		min-width: 0;
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--ink-2);
	}

	/* The tab strip's badge, on the header: one look for "this many things are wrong". */
	.badge {
		flex: none;
		margin-left: auto;
		padding: 0 var(--space-1);
		border-radius: var(--radius);
		background: var(--error);
		color: var(--accent-ink);
		font-size: var(--text-xs);
	}

	.body {
		padding: var(--space-1) var(--space-4) var(--space-4);
	}
</style>
