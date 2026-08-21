<script lang="ts">
	import type { Bounds, Estimate } from '../../ipc/commands';
	import { bytes, count, duration } from '../../common/format';

	// What an export of this graph is narrowed to, and what that will cost (F2, C6, S5.2, S5.4).
	//
	// **In the pane, not in the export dialog.** The dialog used to carry both, and it is a modal: it
	// covers the map you are cropping against. A crop is arrived at by looking — drag a rectangle over
	// the city you mean, watch the estimate fall from four hours to twelve minutes — and none of that
	// works behind a modal. What is left in the dialog is the file to write.
	//
	// **The numbers and the rectangle are one thing.** Dragging on the map fills these fields, and
	// typing in them moves the rectangle; both go through the same crop on the core, so there is no
	// second copy to keep in step.

	let {
		crop,
		drawing,
		estimating,
		estimate,
		refusal,
		onChange,
		onDraw,
		onUseView
	}: {
		crop: Bounds;
		/** Whether a drag on the map is currently drawing a rectangle. */
		drawing: boolean;
		estimating: boolean;
		/** What this crop will cost, or `null` while there is nothing to say yet. */
		estimate: Estimate | null;
		/** The core's refusal — an absurd pyramid, a pipeline that will not build. */
		refusal: string | null;
		onChange: (crop: Bounds) => void;
		/** Turns rectangle-drawing on the map on or off. */
		onDraw: () => void;
		/** Crops to what the map is showing, which is usually what someone means. */
		onUseView: () => void;
	} = $props();

	/// Held as text, not numbers, because "empty" is a value here and `0` is a different one — a
	/// `bind:value` on a number input turns a cleared field into `undefined` on some inputs and `NaN`
	/// on others, and both would arrive as "no bound" when the user meant zero.
	///
	/// Seeded from the crop and re-seeded whenever it changes from outside — which is what a drag on
	/// the map is.
	///
	/// `Bounds` reaches here with every field optional, so a missing one and an explicit `null` both
	/// mean "not set"; `== null` reads them the same way rather than the form having to.
	let text = $derived.by(() => {
		const bbox = crop.bbox ?? null;
		return {
			minZoom: crop.minZoom == null ? '' : String(crop.minZoom),
			maxZoom: crop.maxZoom == null ? '' : String(crop.maxZoom),
			west: bbox === null ? '' : String(bbox[0]),
			south: bbox === null ? '' : String(bbox[1]),
			east: bbox === null ? '' : String(bbox[2]),
			north: bbox === null ? '' : String(bbox[3])
		};
	});

	/// What is on screen, which is the crop until a field is edited into something incomplete.
	let edited = $state<typeof text | null>(null);
	const shown = $derived(edited ?? text);

	const box = $derived([shown.west, shown.south, shown.east, shown.north]);
	const filled = $derived(box.filter((value) => value.trim() !== '').length);

	/// What is wrong, or `null`. Only what this form can see; the core says the rest.
	const problem = $derived.by(() => {
		if (filled > 0 && filled < 4) return 'A bounding box needs all four edges, or none.';
		if (box.some((value) => value.trim() !== '' && !Number.isFinite(Number(value)))) {
			return 'The bounding box takes numbers in degrees.';
		}
		return null;
	});

	const number = (raw: string) => (raw.trim() === '' ? null : Number(raw));

	const FIELDS = [
		['west', 'W'],
		['south', 'S'],
		['east', 'E'],
		['north', 'N']
	] as const;

	/// Sends the form up as bounds, once it is a whole answer.
	function commit(key: keyof typeof text, value: string) {
		const next = { ...shown, [key]: value };
		edited = next;

		const corners = [next.west, next.south, next.east, next.north];
		const complete = corners.filter((v) => v.trim() !== '').length;
		if (complete !== 0 && complete !== 4) return;
		if (corners.some((v) => v.trim() !== '' && !Number.isFinite(Number(v)))) return;

		onChange({
			bbox: complete === 4 ? [Number(next.west), Number(next.south), Number(next.east), Number(next.north)] : null,
			minZoom: number(next.minZoom),
			maxZoom: number(next.maxZoom)
		});
		edited = null;
	}

	const cropped = $derived(crop.bbox != null || crop.minZoom != null || crop.maxZoom != null);
	const cost = $derived(estimate === null ? null : `${bytes(estimate.bytes)} · about ${duration(estimate.seconds)}`);
</script>

<section class="crop">
	<div class="head">
		<h3 class="section-label">Crop</h3>
		<button type="button" class="ghost" class:on={drawing} aria-pressed={drawing} onclick={onDraw}>
			{drawing ? 'Drawing…' : 'Draw on map'}
		</button>
	</div>

	<div class="row">
		<span class="what">Zoom</span>
		<label
			>from <input
				value={shown.minZoom}
				oninput={(e) => commit('minZoom', e.currentTarget.value)}
				type="number"
				min="0"
				max="30"
				inputmode="numeric"
			/></label
		>
		<label
			>to <input
				value={shown.maxZoom}
				oninput={(e) => commit('maxZoom', e.currentTarget.value)}
				type="number"
				min="0"
				max="30"
				inputmode="numeric"
			/></label
		>
	</div>

	<div class="box">
		{#each FIELDS as [key, label] (key)}
			<label>
				{label}
				<input
					value={shown[key]}
					oninput={(e) => commit(key, e.currentTarget.value)}
					type="number"
					step="any"
					inputmode="decimal"
				/>
			</label>
		{/each}
	</div>

	<div class="row buttons">
		<button type="button" class="ghost" onclick={onUseView}>This view</button>
		<button
			type="button"
			class="ghost"
			disabled={!cropped}
			onclick={() => {
				edited = null;
				onChange({ bbox: null, minZoom: null, maxZoom: null });
			}}
		>
			Clear
		</button>
	</div>

	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

	<!-- Half a second behind the typing, because each answer runs the real pipeline (C6). -->
	<p class="cost" aria-live="polite" class:waiting={estimating}>
		{#if refusal}
			<span class="problem">{refusal}</span>
		{:else if estimate === null}
			{estimating ? 'Estimating…' : 'Estimating the size and time…'}
		{:else if estimate.tiles === 0}
			Nothing to write — this crop selects no tiles.
		{:else}
			<strong>{cost}</strong>
			<span class="basis">{count(estimate.tiles)} tiles, from {estimate.sampled} sampled</span>
		{/if}
	</p>
</section>

<style>
	.crop {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) 0;
		border-top: 1px solid var(--rule);
	}

	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}

	h3 {
		margin: 0;
	}

	.row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}

	.what {
		flex: none;
		width: 3rem;
		color: var(--ink-2);
		font-size: var(--text-xs);
	}

	.buttons {
		gap: var(--space-1);
	}

	/* Four across, in the order they read on a map's edges: W S E N. */
	.box {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--space-1);
	}

	label {
		display: flex;
		align-items: baseline;
		gap: var(--space-1);
		min-width: 0;
		color: var(--ink-2);
		font-size: var(--text-xs);

		input {
			min-width: 0;
			flex: 1;
			font-family: var(--font-mono);
			text-align: right;
		}
	}

	.ghost {
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		color: var(--ink-2);
		font-size: var(--text-xs);

		&:hover:not(:disabled) {
			color: var(--ink);
		}

		&:disabled {
			opacity: 0.4;
		}

		/* Drawing is a mode the map is in, so the button that put it there stays lit. */
		&.on {
			border-color: var(--accent);
			background: var(--accent);
			color: var(--accent-ink);
		}
	}

	.problem {
		margin: 0;
		color: var(--error);
		font-size: var(--text-sm);
	}

	.cost {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0;
		color: var(--ink-2);
		font-size: var(--text-sm);
		/* The line changes from "Estimating…" to a figure and back; a floor keeps what is under it
		   still while that happens. */
		min-height: 2.5em;

		strong {
			color: var(--ink);
			font-variant-numeric: tabular-nums;
		}
	}

	.waiting {
		opacity: 0.7;
	}

	.basis {
		font-size: var(--text-xs);
	}
</style>
