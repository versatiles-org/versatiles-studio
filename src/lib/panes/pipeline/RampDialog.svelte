<script lang="ts">
	import ColorPicker from '../../common/ColorPicker.svelte';
	import Icon from '../../common/Icon.svelte';
	import { untrack } from 'svelte';
	import Modal from '../../common/Modal.svelte';
	import Note from '../../common/Note.svelte';
	import { NAMED_RAMPS, fromRamp, hasDuplicates, parseRamp, rampGradient, rampName, type RampStop } from './ramp';

	// The helper behind `dem_colorize`'s and `dem_hillshade`'s `ramp`.
	//
	// **A helper, not the field**, and it commits once, on Use, for the reasons `StepsDialog` gives. What
	// this one shows that the written form hides is the colours themselves, spaced by elevation.
	let {
		value,
		name,
		onUse,
		onClose
	}: {
		/** The parameter as written. Decoded on opening; nothing is written back until `onUse`. */
		value: string;
		/** The parameter's name, for the title. */
		name: string;
		onUse: (text: string) => void;
		onClose: () => void;
	} = $props();

	/// **An unset parameter opens on `default`**, because adjusting the stock colours is likelier than
	/// starting from nothing. Not "what the map shows": unset is the tint for `dem_colorize` and no
	/// colours at all for `dem_hillshade`, so the note below says neither.
	const unset = untrack(() => value.trim() === '');

	/// **A named ramp stays a name** until one of its stops is edited. Writing `default` rather than
	/// its ten stops keeps the document short and follows upstream if its tint changes; the stops are
	/// only there to look at and to start a custom ramp from.
	let preset = $state<string | null>(untrack(() => rampName(value) ?? (unset ? 'default' : null)));

	/// The dialog's own draft - see `StepsDialog`, which explains the `untrack`.
	let stops = $state<RampStop[]>(untrack(() => parseRamp(preset ?? value)) ?? []);

	const encoded = $derived(preset ?? fromRamp(stops));
	const unreadable = $derived(!unset && parseRamp(value) === null);
	/// Sorting keeps the stops ascending, but not apart. Said here, rather than left for `check`.
	const duplicates = $derived(hasDuplicates(stops));

	/// Sorted on every change, so a stop moved past its neighbour goes where it now belongs. Any edit
	/// makes the ramp custom, since the name no longer says what the stops are.
	function replace(next: RampStop[]): void {
		stops = [...next].sort((a, b) => a.meters - b.meters);
		preset = null;
	}

	/// Picking a name shows its stops; picking `custom` keeps the stops as they are, to edit.
	function choose(name: string): void {
		if (name === '') {
			preset = null;
			return;
		}
		stops = parseRamp(name) ?? [];
		preset = name;
	}

	/// Continues from the highest stop, so adding a row alone does not change the colours.
	function add(): void {
		const last = stops.at(-1);
		replace([...stops, last ? { meters: last.meters + 1000, color: last.color } : { meters: 0, color: '808080' }]);
	}
</script>

<Modal title="Colours by elevation: {name}" width="26rem" {onClose}>
	{#if unreadable}
		<Note>
			<code>{value}</code> is not a list of stops or a ramp's name, so there is nothing to show. Building one here replaces
			it.
		</Note>
	{:else if unset}
		<Note tone="empty">Not set. Use writes the colours below into the parameter.</Note>
	{/if}

	<dl class="facts">
		<dt><label for="ramp-preset">Colours</label></dt>
		<dd>
			<select id="ramp-preset" value={preset ?? ''} onchange={(event) => choose(event.currentTarget.value)}>
				{#each Object.keys(NAMED_RAMPS) as name (name)}
					<option value={name}>{name}</option>
				{/each}
				<option value="">custom</option>
			</select>
		</dd>
	</dl>

	<div class="preview" data-testid="ramp-preview" style:background-image={rampGradient(stops)}></div>

	<div class="stops">
		{#each stops as stop, index (index)}
			<div class="stop">
				<input
					type="number"
					class="meters"
					value={stop.meters}
					step="any"
					aria-label="Elevation of stop {index + 1}, in metres"
					onblur={(event) => {
						const next = event.currentTarget.valueAsNumber;
						if (Number.isFinite(next) && next !== stop.meters) {
							replace(stops.map((other, at) => (at === index ? { ...other, meters: next } : other)));
						}
					}}
				/>
				<span class="unit">m</span>
				<ColorPicker
					value={stop.color}
					spelling="hex"
					label="Colour at {stop.meters} m"
					onPick={(color) => replace(stops.map((other, at) => (at === index ? { ...other, color } : other)))}
				/>
				<code class="digits">{stop.color}</code>
				<button
					type="button"
					class="icon danger drop"
					title="Remove"
					aria-label="Remove the stop at {stop.meters} m"
					onclick={() => replace(stops.filter((_, at) => at !== index))}><Icon name="remove" size="1em" /></button
				>
			</div>
		{/each}

		<button type="button" class="add" onclick={add}>+ stop</button>
	</div>

	{#if duplicates}
		<Note>Two stops share an elevation. Move one of them to use this.</Note>
	{/if}

	<dl class="facts reading">
		<dt>Writes</dt>
		<dd><code>{encoded || '(nothing - clears the parameter)'}</code></dd>
	</dl>

	{#snippet actions()}
		<button type="button" class="button" onclick={onClose}>Cancel</button>
		<button type="button" class="button primary" disabled={duplicates} onclick={() => onUse(encoded)}>Use</button>
	{/snippet}
</Modal>

<style>
	.preview {
		height: 1.5rem;
		margin-bottom: var(--space-3);
		border: 1px solid var(--rule);
	}

	.stops {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.stop {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.meters {
		width: 6rem;
	}

	.unit {
		color: var(--ink-2);
		font-size: var(--text-sm);
	}

	.digits {
		font-size: var(--text-sm);
	}

	/* At the far end of the row, where every other row's × is. */
	.drop {
		margin-left: auto;
	}

	/* Set apart from the rows above: it is what they come to, not another of them. */
	.reading {
		padding-top: var(--space-3);
		border-top: 1px solid var(--rule);
	}
</style>
