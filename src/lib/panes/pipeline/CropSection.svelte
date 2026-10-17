<script lang="ts">
	import type { Bounds } from '../../ipc/commands';
	import Field from '../../common/Field.svelte';
	import Group from '../../common/Group.svelte';
	import Note from '../../common/Note.svelte';

	// What an export of this graph is narrowed to, and what that will cost (F2, C6, S5.2, S5.4).
	//
	// **In the pane, not in the export dialog.** The dialog used to carry both, and it is a modal: it
	// covers the map you are cropping against. A crop is arrived at by looking - drag a rectangle over
	// the city you mean, watch the estimate fall from four hours to twelve minutes - and none of that
	// works behind a modal. What is left in the dialog is the file to write.
	//
	// **The numbers and the rectangle are one thing.** Dragging on the map fills these fields, and
	// typing in them moves the rectangle; both go through the same crop on the core, so there is no
	// second copy to keep in step.

	let {
		crop,
		drawing,
		onChange,
		onDraw,
		onUseView
	}: {
		crop: Bounds;
		/** Whether a drag on the map is currently drawing a rectangle. */
		drawing: boolean;
		onChange: (crop: Bounds) => void;
		/** Turns rectangle-drawing on the map on or off. */
		onDraw: () => void;
		/** Crops to what the map is showing, which is usually what someone means. */
		onUseView: () => void;
	} = $props();

	/// Held as text, not numbers, because "empty" is a value here and `0` is a different one - a
	/// `bind:value` on a number input turns a cleared field into `undefined` on some inputs and `NaN`
	/// on others, and both would arrive as "no bound" when the user meant zero.
	///
	/// Seeded from the crop and re-seeded whenever it changes from outside - which is what a drag on
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

	/// Folded away by default ([Q43]): most graphs are exported whole, and the fields, the two
	/// buttons and the estimate were four rows of chrome under every chain that is not being cropped.
	///
	/// **Local, not durable.** [Q16] keeps durable state in the core, and a *pane's* fold is durable
	/// for that reason - but this is a disclosure inside one, in the class [Q35] put scroll position
	/// in: it costs a gesture to restore, not work. Local also means "closed by default" is true
	/// every launch rather than only on a fresh install.
	let open = $state(false);

	/// What the crop comes to, for the header when it is closed. **A crop that is set has to be
	/// visible while the section is not** - otherwise a graph narrowed to one city exports as one
	/// city with nothing on screen saying so.
	const summary = $derived.by(() => {
		const parts: string[] = [];
		if (crop.minZoom !== null || crop.maxZoom !== null) {
			parts.push(`z${crop.minZoom ?? 'min'}-${crop.maxZoom ?? 'max'}`);
		}
		if (crop.bbox) parts.push('area');
		return parts.join(' · ');
	});
</script>

<!-- A foldable group of the kit (S12.4): the heading is the disclosure, and what the crop comes to
     is its summary while folded. What is this section's own below is the four-corner box. -->
<Group title="Crop" {open} onToggle={(next) => (open = next)} summary={cropped ? summary : null}>
	<Field label="Zoom" as="group">
		<label class="bound"
			>from <input
				value={shown.minZoom}
				oninput={(e) => commit('minZoom', e.currentTarget.value)}
				type="number"
				min="0"
				max="30"
				inputmode="numeric"
			/></label
		>
		<label class="bound"
			>to <input
				value={shown.maxZoom}
				oninput={(e) => commit('maxZoom', e.currentTarget.value)}
				type="number"
				min="0"
				max="30"
				inputmode="numeric"
			/></label
		>
	</Field>

	<div class="box" role="group" aria-label="Bounding box">
		{#each FIELDS as [key, label] (key)}
			<label class="bound">
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

	<!-- The three ways to set one, together: take the map's frame, draw a new one, or drop it.
	     `Draw on map` used to sit in the header, which is now a disclosure and holds no controls. -->
	<div class="toolbar">
		<button type="button" class="button" onclick={onUseView}>This view</button>
		<!-- Drawing is a mode the map is in, so the button that put it there stays lit. -->
		<button type="button" class="button" class:on={drawing} aria-pressed={drawing} onclick={onDraw}>
			{drawing ? 'Drawing…' : 'Draw on map'}
		</button>
		<button
			type="button"
			class="button"
			disabled={!cropped}
			onclick={() => {
				edited = null;
				onChange({ bbox: null, minZoom: null, maxZoom: null });
			}}
		>
			Clear
		</button>
	</div>

	{#if problem}<Note tone="problem">{problem}</Note>{/if}
</Group>

<style>
	/* Four across, in the order they read on a map's edges: W S E N. */
	.box {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--space-1);
	}

	.bound {
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
		}
	}
</style>
