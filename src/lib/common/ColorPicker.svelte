<script lang="ts">
	import { fromSwatch, toSwatch, type Spelling } from './color';

	// A swatch for a colour parameter, beside the field that holds it ([Q57]).
	//
	// **Beside, not instead.** The field stays: `RRGGBBAA` has an alpha a native colour input cannot
	// express, an operation may take a value this cannot show, and a colour someone has on their
	// clipboard is pasted rather than found again by eye. The swatch is the affordance for choosing
	// one, in the same place the path field keeps its `…` and a bbox its rectangle.
	//
	// **It reports rather than assumes.** A field that holds nothing, or something this cannot read,
	// gets a swatch marked as empty - because an input defaulting to black would say the parameter is
	// set to black, which is a different fact from "not set".

	let {
		value,
		spelling,
		label,
		onPick
	}: {
		/** The parameter as the document holds it, in the operation's own spelling. */
		value: string;
		spelling: Spelling;
		/** Named for a screen reader, since the control itself is a colour and says nothing. */
		label: string;
		onPick: (value: string) => void;
	} = $props();

	const swatch = $derived(toSwatch(value, spelling));
</script>

<input
	type="color"
	class="swatch"
	class:empty={swatch === null}
	value={swatch ?? ''}
	aria-label={label}
	title={swatch === null ? `${label} - not set` : label}
	oninput={(event) => onPick(fromSwatch(event.currentTarget.value, value, spelling))}
/>

<style>
	/* The well's size and frame are `base.css`'s, the same as every colour well. What is this one's
	   own is the empty state: hatched rather than blank, so it does not read as a colour that happens
	   to match the surface behind it. */
	.swatch.empty {
		background-image: linear-gradient(135deg, transparent 45%, var(--ink-2) 45%, var(--ink-2) 55%, transparent 55%);
	}
</style>
