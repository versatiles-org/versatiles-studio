<script lang="ts">
	import type { Snippet } from 'svelte';

	// A line of secondary text in a pane, with a tone (the kit, S12).
	//
	// **One part where there were five spellings.** A note under a control was `note`, `hint`,
	// `empty`, `nothing` and `none` across five panes, each with a scoped rule of its own, and no two
	// the same grey or size. What differed between them was never the pane; it was what the note was
	// *for*, and that is the one thing a tone says.
	//
	// `hint` sits under a control and explains it. `empty` is what a pane says when it has nothing to
	// show yet, so it reads at body size. `aside` says something the map is doing that the person did
	// not ask for - a fallback, a substitution - and carries a rule so it is not mistaken for a hint.
	// `problem` is an error, and announces itself.
	//
	// **`live` is a note whose text arrives on its own** - the verdict on an address as it is
	// checked, the cost of an export once it has been estimated, whether a filter is on the map yet.
	// It is read out as it changes, and it holds its line while empty so the controls under it do
	// not jump when the answer lands. One line, not two: two left a gap under the remote dialog's
	// address field that read as something missing, and a second line is rare enough - a refusal
	// with a reason - that pushing once is the smaller cost. Five components had each written that
	// pattern with a reserved height of their own.
	//
	// `lead` is the one sentence at the top of a dialog saying what it does, at body size - the
	// dialogs each had one as `.lead` or `.hint`, in two sizes.
	let {
		tone = 'hint',
		live = false,
		id,
		action,
		children
	}: {
		tone?: 'hint' | 'empty' | 'aside' | 'problem' | 'lead';
		/** Announced as it changes, with room held for the answer. */
		live?: boolean;
		/** For a control's `aria-describedby` to point at. */
		id?: string;
		/** A `.quiet` button offering the fix, rendered after the text. */
		action?: Snippet;
		children: Snippet;
	} = $props();
</script>

<p
	{id}
	class="note {tone}"
	class:live
	role={tone === 'problem' ? 'alert' : undefined}
	aria-live={live && tone !== 'problem' ? 'polite' : undefined}
>
	{@render children()}
	{#if action}{@render action()}{/if}
</p>

<style>
	.note {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--text-xs);
		line-height: 1.45;
		/* A note can name a long path, and it must break rather than widen the pane. */
		overflow-wrap: anywhere;
	}

	.empty,
	.lead {
		font-size: var(--text-sm);
		line-height: 1.5;
	}

	.aside {
		border-left: 2px solid var(--rule);
		padding-left: var(--space-2);
	}

	.problem {
		color: var(--error);
	}

	/* One line's worth, so what is under it does not move when the answer arrives. */
	.live {
		min-height: 1.45em;
	}
</style>
