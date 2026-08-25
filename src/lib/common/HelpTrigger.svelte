<script lang="ts">
	import { peek, unpeek, pin, help, type HelpContent } from '../state/help.svelte';

	// The `?` that opens the help popover ([Q33]).
	//
	// The other half of `Help.svelte`: that one draws, this one triggers. They were two halves of a
	// mechanism with only one of them a component, which left three copies of the same six handlers
	// in `NodeCard` - one for the operation, one for a set parameter, one for a required-but-unset
	// one.
	//
	// Hover or focus peeks, click pins, Escape closes while this still holds focus - which it does,
	// because opening the popover does not move it.
	let { content }: { content: HelpContent } = $props();

	const pinned = $derived(help.current?.pinned === true && help.current.content.title === content.title);
</script>

<button
	type="button"
	class="help"
	class:open={pinned}
	aria-label="What is {content.title}?"
	onmouseenter={(event) => peek(content, event.currentTarget)}
	onmouseleave={unpeek}
	onfocus={(event) => peek(content, event.currentTarget)}
	onblur={unpeek}
	onclick={(event) => pin(content, event.currentTarget)}
	onkeydown={(event) => {
		if (event.key === 'Escape') unpeek();
	}}
>
	?
</button>

<style>
	/* Sized from the type scale rather than to a pixel: a `?` small enough to look right at 9px is
	   also small enough to miss with a trackpad. */
	.help {
		flex: none;
		display: grid;
		place-items: center;
		width: 1.15em;
		height: 1.15em;
		padding: 0;
		border: 1px solid var(--ink-2);
		border-radius: 50%;
		background: none;
		color: var(--ink-2);
		font-size: var(--text-xs);
		line-height: 1;
		opacity: 0.7;

		&.open,
		&:hover {
			opacity: 1;
			border-color: var(--accent);
			background: var(--accent);
			color: var(--accent-ink);
		}
	}
</style>
