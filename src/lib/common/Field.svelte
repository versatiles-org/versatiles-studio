<script lang="ts">
	import type { Snippet } from 'svelte';

	// A label beside a control (the kit, S12).
	//
	// **One label width for every pane**, `--label-width`, so the controls of the Style pane line up
	// with the arguments of a node card: the two were 5.5rem and 6.5rem apart before this, which is
	// the kind of difference nobody decides and everybody sees.
	//
	// Three columns: the label, the control, and a trailing part for what sits after a control - the
	// amount a slider reads, the clear button beside it. The trailing column is only laid out when
	// something is in it, so a plain select takes the full width.
	//
	// A `<label>` wraps the control, which labels it without an `id`. A row with several controls -
	// a zoom range as two inputs - is a `group` instead, since one label may not wrap two fields;
	// the label then names the group and each control carries its own hidden one.
	let {
		label,
		as = 'label',
		trail,
		children
	}: {
		label: string;
		/** `group` for a row holding more than one control. */
		as?: 'label' | 'group';
		/** What sits after the control: an amount, a clear button. */
		trail?: Snippet;
		children: Snippet;
	} = $props();
</script>

{#if as === 'group'}
	<div class="field" class:trailed={trail} role="group" aria-label={label}>
		<span class="label">{label}</span>
		<span class="control">{@render children()}</span>
		{#if trail}<span class="trail">{@render trail()}</span>{/if}
	</div>
{:else}
	<label class="field" class:trailed={trail}>
		<span class="label">{label}</span>
		<span class="control">{@render children()}</span>
		{#if trail}<span class="trail">{@render trail()}</span>{/if}
	</label>
{/if}

<style>
	.field {
		display: grid;
		grid-template-columns: var(--label-width) minmax(0, 1fr);
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		font-size: var(--text-xs);
		color: var(--ink-2);

		&.trailed {
			grid-template-columns: var(--label-width) minmax(0, 1fr) auto;
		}
	}

	.label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* The control fills its column, whatever it is: a select, a range, a row of two inputs. */
	.control {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;

		& > :global(*) {
			flex: 1 1 auto;
			min-width: 0;
		}
	}

	.trail {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		/* Amounts change width as digits change; tabular figures keep the row from twitching. */
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
</style>
