<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	// An item that folds open, under a group (the kit): an input in the Inspector, and the shape a
	// layer or a node card takes when they come onto the kit.
	//
	// **The third level, drawn as an item and not as a heading** ([Q70](../../../docs/decisions.md)).
	// The pane title is bold capitals on a band, a group heading is bold sentence case; an item is in
	// the regular weight, so it reads as one entry in the group rather than as a heading above it.
	// It was a bold title one size up from the group, which turned the pane's hierarchy upside down.
	//
	// **Still a heading to a screen reader** - an `h4`, under the group's `h3` and the pane's `h2`, so
	// the outline is in order and an item can be reached by heading. Only how it looks is an item's.
	//
	// `<details>`, because it is a disclosure and the element brings the keyboard and the semantics.
	// **The chevron is drawn, not `::marker`**: a `<summary>` whose only child is a block - the title,
	// which has to be one to truncate - has no line box for the native marker to sit in, so the
	// triangle silently is not there. It turns with the element's own state; `aria-hidden`, because
	// `<details>` already says expanded or collapsed.

	let {
		title,
		tooltip = title,
		open = false,
		mono = false,
		children
	}: {
		title: string;
		/** The whole of it, when the title is cut short - a path behind a file name. */
		tooltip?: string;
		open?: boolean;
		/** In the monospace face, for a name that is an identifier: a file, a graph. */
		mono?: boolean;
		children: Snippet;
	} = $props();
</script>

<details class="disclosure" {open}>
	<summary>
		<span class="chevron" aria-hidden="true"><Icon name="chevron" size="1em" /></span>
		<h4 class="item-title truncate" class:mono title={tooltip}>{title}</h4>
	</summary>
	{@render children()}
</details>

<style>
	summary {
		/* Not a <button>, so base.css's button cursor does not reach it. */
		cursor: pointer;
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		/* Firefox and WebKit spell "no native marker" differently, and the marker here is drawn. */
		list-style: none;

		&::-webkit-details-marker {
			display: none;
		}
	}

	details[open] > summary {
		margin-bottom: var(--space-3);

		.chevron {
			transform: rotate(90deg);
		}
	}

	/* An entry, not a heading: the body's size, the regular weight, the text's own colour. */
	.item-title {
		margin: 0;
		min-width: 0;
		font-size: var(--text-sm);
		font-weight: 400;
		color: var(--ink);

		&.mono {
			font-family: var(--font-mono);
		}
	}
</style>
