<script lang="ts">
	import { style } from '../../state/style.svelte';
	import type { Preset, RasterAdjust, Recolor, SourceKind } from '../../ipc/commands';
	import { KIND_LABELS, isVector, sourceKind } from '../../map/source-kind';
	import type { StyleBasis } from '../../map/style';
	import type { StyleSpecification } from 'maplibre-gl';
	import LayerTree from './LayerTree.svelte';
	import { save } from '@tauri-apps/plugin-dialog';
	import { exportStyle, exportStyleBundle } from '../../ipc/commands';
	import { canGenerateCode, forExport, fontsUsed, styleCode } from '../../map/style-code';

	// The style, as the recipe it is made from (S4.2, D1, [Q36]).
	//
	// **Three things, in the order they narrow.** Where a style starts, the adjustments that apply to
	// every colour in it at once (D1), and then the layers themselves (D3). The tree came last on
	// purpose: a list of 324 layers before there was any way to change one is a list nobody reads.
	//
	// The controls below preview continuously and commit once, which is why each is bound to a
	// local value rather than to the recipe: a slider bound to the core would record an undo entry
	// per pixel of travel ([Q36]).

	let {
		/** The style on the map, whose layers the tree lists (S4.5). It is the *output* of the recipe,
		 *  which is why it arrives as a prop rather than being read from the state module. */
		rendered = null,
		/** What the previewed source turned out to be, for reading its kind (S6.1). `null` before
		 *  anything is open, which is when this pane has nothing to say at all. */
		source = null,
		/** Which route produced `rendered` (S6.2). A preset that could not draw these tiles is
		 *  replaced by derived layers, and the person who picked it should be told rather than left
		 *  to notice the map does not match the preset they chose. */
		basis = 'none',
		/** The stack, bottom first, and what each source is doing (S6.5). One entry until a project
		 *  holds more than one graph, and then the reason a basemap can sit under data. */
		stack = [],
		/** Which source the pane is editing — the selected graph. */
		editing = null,
		/** Selects a graph from the stack. */
		onSelect = undefined
	}: {
		rendered?: StyleSpecification | null;
		source?: { tileFormat: string; tileSchema: string | null; layers: string[] } | null;
		basis?: StyleBasis;
		stack?: { name: string; basis: StyleBasis }[];
		editing?: string | null;
		onSelect?: (name: string) => void;
	} = $props();

	/// The stack reads top-down, which is the reverse of how it is drawn.
	///
	/// **Because that is how a map looks.** `Recipe.order` is bottom-first, since that is the order
	/// layers are emitted in; a person reading a list of what is on top of what expects the top at
	/// the top. Reversing here rather than storing it that way keeps the file matching the render.
	const rows = $derived([...stack].reverse());

	/// What a source is contributing, said plainly rather than as a term of art.
	const DRAWN_AS: Record<StyleBasis, string> = {
		preset: '',
		derived: 'from its own layers',
		fallback: 'from its own layers',
		raster: 'as an image',
		none: 'not drawn'
	};

	/// Moves one source up or down the stack, and records the whole list.
	function move(name: string, by: number): void {
		const order = stack.map((entry) => entry.name);
		const at = order.indexOf(name);
		const to = at + by;
		if (at < 0 || to < 0 || to >= order.length) return;
		[order[at], order[to]] = [order[to], order[at]];
		void style.setOrder(order);
	}

	const PRESETS: { id: Preset; label: string; note: string }[] = [
		{ id: 'colorful', label: 'Colorful', note: 'the default, full colour' },
		{ id: 'graybeard', label: 'Graybeard', note: 'muted greys' },
		{ id: 'neutrino', label: 'Neutrino', note: 'minimal, few layers' },
		{ id: 'shadow', label: 'Shadow', note: 'dark' },
		{ id: 'eclipse', label: 'Eclipse', note: 'dark, high contrast' },
		{ id: 'satellite', label: 'Satellite', note: 'for imagery underneath' },
		// Not one of `@versatiles/style`'s six. The others know what `water_polygons` means; this one
		// knows only what the tiles turn out to contain, which is the only thing that works when they
		// are not Shortbread (S4.4, D2).
		{ id: 'derived', label: 'From the data', note: 'every layer these tiles actually have' }
	];

	/// Each slider's range and the value that means "unchanged".
	///
	/// The neutral value is what a cleared control returns to, and it is not always zero — a
	/// multiplier's identity is 1. Stored beside the range so the two cannot disagree.
	const SLIDERS = [
		{ key: 'rotate', label: 'Hue', min: -180, max: 180, step: 1, neutral: 0, unit: '°' },
		{ key: 'saturate', label: 'Saturation', min: -1, max: 1, step: 0.05, neutral: 0, unit: '' },
		{ key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.05, neutral: 0, unit: '' },
		{ key: 'contrast', label: 'Contrast', min: 0, max: 3, step: 0.05, neutral: 1, unit: '×' },
		{ key: 'gamma', label: 'Gamma', min: 0.1, max: 3, step: 0.05, neutral: 1, unit: '×' }
	] as const;

	const recipe = $derived(style.current);

	// **The pane edits one source, not the whole recipe** (S6.4). `style.source` is the focused
	// graph's entry with any in-flight gesture applied, so every control below reads the same view
	// the map is drawing from.
	const sourceStyle = $derived(style.source);
	const appearance = $derived(sourceStyle.appearance);
	const vectorAppearance = $derived(appearance.type === 'vector' ? appearance : null);
	const rasterAdjust = $derived(appearance.type === 'raster' ? appearance.adjust : {});

	// **What these tiles are, and how confidently** (S6.1). Everything below is gated on it, because
	// a preset aimed at raster tiles is not a control that does something subtle — it is a control
	// that does nothing, and one that looks identical to a working one is worse than none.
	const reading = $derived(
		source ? sourceKind(source.tileFormat, source.tileSchema, source.layers, sourceStyle.kind) : null
	);
	const kind = $derived(reading?.kind ?? null);
	const vector = $derived(kind === null || isVector(kind));

	/** Why the pane is showing this reading, in words rather than as a term of art. */
	const BASIS_NOTE = {
		declared: 'the container says so',
		inferred: 'worked out from the tiles',
		chosen: 'you set this'
	} as const;

	/// The raster controls, in MapLibre's own units.
	///
	/// Not the `SLIDERS` above under different labels: `rotate` and `saturate` happen to mean the
	/// same thing, and contrast and brightness do not — `Recolor`'s are a multiplier and an offset
	/// where MapLibre's are an offset and a pair of range endpoints. Two lists that look alike beat
	/// one list with a conversion table nobody can read.
	const RASTER_SLIDERS = [
		{ key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, unit: '°' },
		{ key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.05, unit: '' },
		{ key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.05, unit: '' },
		{ key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.05, unit: '' },
		{ key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, unit: '' }
	] as const;

	type RasterKey = (typeof RASTER_SLIDERS)[number]['key'];

	/// Every raster slider's neutral is `0` except opacity, whose is `1` — the same asymmetry the
	/// vector sliders have, for the same reason: a multiplier's identity is not zero.
	const rasterValue = (key: RasterKey): number =>
		(rasterAdjust as Record<string, number | undefined>)[key] ?? (key === 'opacity' ? 1 : 0);

	const rasterAdjusted = $derived(Object.values(rasterAdjust).some((value) => value != null));

	/// Previewed locally and committed once, exactly as the recolour gesture is.
	let rasterPending = $state<RasterAdjust | null>(null);
	const rasterNow = $derived(rasterPending ?? rasterAdjust);

	function previewRaster(key: RasterKey, raw: string): void {
		rasterPending = { ...rasterNow, [key]: Number(raw) };
	}

	function commitRaster(): void {
		if (rasterPending) void style.setRaster(rasterPending);
		rasterPending = null;
	}

	function setResampling(value: string): void {
		void style.setRaster({ ...rasterNow, resampling: value === 'linear' ? null : 'nearest' });
	}

	function resetRaster(): void {
		rasterPending = null;
		void style.setRaster({});
	}

	const KIND_OPTIONS: SourceKind[] = ['vectorShortbread', 'vectorOther', 'rasterImage', 'rasterDem'];

	/** Picking the reading Studio already made means clearing the override, not recording it. */
	function chooseKind(next: string): void {
		const derivedNow = source ? sourceKind(source.tileFormat, source.tileSchema, source.layers).kind : null;
		void style.setKind(next === derivedNow ? null : (next as SourceKind));
	}

	/// What the sliders show. Read from the recipe, written by dragging, committed on release.
	const value = (key: string): number => {
		const slider = SLIDERS.find((s) => s.key === key)!;
		const held = (vectorAppearance?.recolor as Record<string, number | null | undefined>)?.[key];
		return held ?? slider.neutral;
	};

	/// Applies one field of the recolouring without recording it.
	function preview(key: string, raw: string) {
		const slider = SLIDERS.find((s) => s.key === key)!;
		const next = Number(raw);
		style.previewRecolor({
			...(vectorAppearance?.recolor ?? {}),
			// Back to "unset" at the neutral value, so a slider returned to the middle leaves no
			// trace in the recipe and none in the exported code.
			[key]: next === slider.neutral ? undefined : next
		} as Recolor);
	}

	function invert(on: boolean) {
		style.previewRecolor({ ...(vectorAppearance?.recolor ?? {}), invertBrightness: on || undefined } as Recolor);
		void style.commitRecolor();
	}

	function reset() {
		style.previewRecolor({});
		void style.commitRecolor();
	}

	/// Writing the style out (S4.6, D8). Three forms, because they answer different questions: the
	/// JSON is what a map consumes, the code is what a build regenerates it from, and the bundle is
	/// the JSON with the fonts and sprites it needs beside it — for a machine that will not reach
	/// versatiles.org.
	let exporting = $state<string | null>(null);

	async function exportAs(kind: 'json' | 'ts') {
		if (!recipe || !rendered) return;
		const code = kind === 'ts' ? styleCode(appearance) : null;
		if (kind === 'ts' && code === null) return;
		// The tile URL is swapped for a placeholder in both forms: what the map reads from is an
		// ephemeral local port, and a file carrying it away would work once.
		const contents = kind === 'ts' ? code! : JSON.stringify(forExport(rendered), null, '\t');

		exporting = kind;
		try {
			const target = await save({
				title: 'Export style',
				defaultPath: kind === 'ts' ? 'style.ts' : 'style.json',
				filters: [{ name: kind === 'ts' ? '@versatiles/style code' : 'MapLibre style', extensions: [kind] }]
			});
			if (target) await exportStyle(target, contents);
		} finally {
			exporting = null;
		}
	}

	/// Fonts the bundle could not find, said out loud rather than swallowed. Cleared on the next
	/// export, because it is about the one that just happened.
	let missingFonts = $state<string[]>([]);

	/// The style plus everything it names, as a `.zip`.
	///
	/// A zip rather than a folder: a bundle is a few hundred files, and quietly filling a directory
	/// someone chose is a worse surprise than one file with a name.
	async function exportBundle() {
		if (!rendered) return;
		exporting = 'bundle';
		missingFonts = [];
		try {
			const target = await save({
				title: 'Export style bundle',
				defaultPath: 'style.zip',
				filters: [{ name: 'Style bundle', extensions: ['zip'] }]
			});
			if (!target) return;
			// The bundle carries its own copies, so the style has to name them where they will be.
			const contents = JSON.stringify(forExport(rendered, 'bundled'), null, '\t');
			missingFonts = await exportStyleBundle(target, true, contents, fontsUsed(rendered));
		} finally {
			exporting = null;
		}
	}

	const adjusted = $derived(Object.values(vectorAppearance?.recolor ?? {}).some((v) => v !== undefined && v !== null));
</script>

{#if recipe}
	<section class="style-pane">
		{#if rows.length > 1}
			<h2 class="section-label">Sources</h2>
			<!-- Up and down rather than drag: it is reachable from a keyboard, it cannot drop a source
			     somewhere nobody meant, and the order is short enough that two clicks is not a chore. -->
			<ul class="stack">
				{#each rows as row (row.name)}
					<li class:editing={row.name === editing}>
						<button type="button" class="pick" onclick={() => onSelect?.(row.name)}>
							<span class="label">{row.name}</span>
							{#if DRAWN_AS[row.basis]}<span class="note">{DRAWN_AS[row.basis]}</span>{/if}
						</button>
						<button type="button" class="nudge" onclick={() => move(row.name, 1)} aria-label="Move {row.name} up"
							>↑</button
						>
						<button type="button" class="nudge" onclick={() => move(row.name, -1)} aria-label="Move {row.name} down"
							>↓</button
						>
					</li>
				{/each}
			</ul>
			<p class="note">The top of this list draws on top of the map.</p>
		{/if}

		{#if reading}
			<h2 class="section-label">These tiles</h2>
			<label class="kind">
				<span class="name">Read as</span>
				<select value={kind} onchange={(event) => chooseKind(event.currentTarget.value)}>
					{#each KIND_OPTIONS as option (option)}
						<option value={option}>{KIND_LABELS[option]}</option>
					{/each}
				</select>
			</label>
			<p class="note">{BASIS_NOTE[reading.basis]}.</p>
		{/if}

		{#if kind === 'rasterImage'}
			<h2 class="section-label">
				Adjust
				{#if rasterAdjusted}
					<button type="button" class="reset" onclick={resetRaster}>reset</button>
				{/if}
			</h2>

			{#each RASTER_SLIDERS as slider (slider.key)}
				<label class="slider">
					<span class="name">{slider.label}</span>
					<input
						type="range"
						min={slider.min}
						max={slider.max}
						step={slider.step}
						value={rasterValue(slider.key)}
						oninput={(event) => previewRaster(slider.key, event.currentTarget.value)}
						onchange={commitRaster}
						onpointercancel={() => (rasterPending = null)}
					/>
					<span class="amount">{rasterValue(slider.key)}{slider.unit}</span>
				</label>
			{/each}

			<label class="kind">
				<span class="name">Scaling</span>
				<select
					value={rasterAdjust.resampling ?? 'linear'}
					onchange={(event) => setResampling(event.currentTarget.value)}
				>
					<option value="linear">Smooth</option>
					<option value="nearest">Keep pixels square</option>
				</select>
			</label>
			<!-- `nearest` is what a scan of a printed map or any pixel art wants; smoothing those
			     turns crisp edges into mush at every zoom that is not exactly native. -->
			<p class="note">Smooth blends between pixels. Square keeps them as they are.</p>
		{:else if !vector}
			<p class="note unavailable">
				Elevation tiles are drawn as they are for now. Hillshade controls are still to come.
			</p>
		{:else}
			<h2 class="section-label">Preset</h2>
			{#if basis === 'fallback'}
				<!-- S6.2: the preset is still what the recipe says, and it is not what the map is
				     showing. Saying so here is cheaper than leaving someone to compare the two. -->
				<p class="note substituted">
					These tiles have none of the layers this preset draws, so they are drawn from what the tiles actually contain.
				</p>
			{/if}
			<div class="presets">
				{#each PRESETS as preset (preset.id)}
					<button
						type="button"
						class="preset"
						class:chosen={vectorAppearance?.preset === preset.id}
						aria-pressed={vectorAppearance?.preset === preset.id}
						title={preset.note}
						onclick={() => void style.setPreset(preset.id)}
					>
						{preset.label}
					</button>
				{/each}
			</div>

			<h2 class="section-label">
				Adjust
				{#if adjusted}
					<button type="button" class="reset" onclick={reset}>reset</button>
				{/if}
			</h2>

			<label class="toggle">
				<input
					type="checkbox"
					checked={(vectorAppearance?.recolor ?? {}).invertBrightness ?? false}
					onchange={(event) => invert(event.currentTarget.checked)}
				/>
				Invert brightness
				<!-- D5's whole feature. Hues are kept, so a light style becomes a dark one rather than a
			     photographic negative. -->
				<span class="note">light ↔ dark</span>
			</label>

			{#each SLIDERS as slider (slider.key)}
				<label class="slider">
					<span class="name">{slider.label}</span>
					<input
						type="range"
						min={slider.min}
						max={slider.max}
						step={slider.step}
						value={value(slider.key)}
						oninput={(event) => preview(slider.key, event.currentTarget.value)}
						onchange={() => void style.commitRecolor()}
						onpointercancel={() => style.cancelRecolor()}
					/>
					<span class="amount">{value(slider.key)}{slider.unit}</span>
				</label>
			{/each}

			<p class="note">These apply to every colour in the style at once.</p>

			<LayerTree {rendered} />
		{/if}

		<h2 class="section-label">Export</h2>
		<div class="exports">
			<button
				type="button"
				class="button"
				disabled={!rendered || exporting !== null}
				onclick={() => void exportAs('json')}
			>
				style.json
			</button>
			<!-- Disabled rather than hidden for a derived style: the reason it cannot be written as
			     code is worth saying, and a button that vanishes says nothing. -->
			<button
				type="button"
				class="button"
				disabled={!rendered || exporting !== null || !canGenerateCode(appearance)}
				title={canGenerateCode(appearance)
					? 'The preset and what was changed, as code'
					: 'A derived style has no builder to call — export it as style.json'}
				onclick={() => void exportAs('ts')}
			>
				@versatiles/style code
			</button>
			<button
				type="button"
				class="button"
				disabled={!rendered || exporting !== null}
				title="The style, its glyphs and its sprites, as one .zip"
				onclick={() => void exportBundle()}
			>
				Bundle
			</button>
		</div>

		{#if missingFonts.length > 0}
			<p class="note" role="status">
				No glyphs were found for {missingFonts.join(', ')} — install the family under Assets, or MapLibre will fall back.
			</p>
		{/if}
	</section>
{/if}

<style>
	.style-pane {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.presets {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-2);
	}

	.preset {
		padding: var(--space-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius-md);
		background: var(--surface);
		color: var(--ink-2);
		font-size: var(--text-sm);
		cursor: pointer;

		&:hover {
			color: var(--ink);
		}

		&.chosen {
			border-color: var(--accent);
			color: var(--ink);
		}
	}

	.reset {
		margin-left: var(--space-2);
		border: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		cursor: pointer;
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--ink-2);
		font-size: var(--text-sm);
	}

	.slider {
		display: grid;
		grid-template-columns: 5.5rem 1fr 3rem;
		align-items: center;
		gap: var(--space-2);
		color: var(--ink-2);
		font-size: var(--text-xs);

		.name {
			white-space: nowrap;
		}

		/* A number that changes as the slider moves; without this the row twitches as digits
		   change width. */
		.amount {
			font-family: var(--font-mono);
			font-variant-numeric: tabular-nums;
			text-align: right;
		}

		input {
			min-width: 0;
		}
	}

	.kind {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--ink-2);
		font-size: var(--text-xs);

		.name {
			flex: 0 0 auto;
			white-space: nowrap;
		}

		select {
			flex: 1 1 auto;
			min-width: 0;
		}
	}

	/* The reason a section is absent, which is a different thing from a hint about one that is
	   present — so it reads as a statement rather than as small print under a control. */
	/* A statement about what the map is showing, not a hint about a control — so it sits above the
	   presets rather than under them, and reads before the thing it is explaining. */
	.stack {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;

		li {
			display: flex;
			align-items: center;
			gap: var(--space-1);
		}

		li.editing .label {
			font-weight: 600;
		}

		.pick {
			flex: 1 1 auto;
			min-width: 0;
			display: flex;
			align-items: baseline;
			gap: var(--space-2);
			text-align: left;
			background: none;
			border: none;
			padding: var(--space-1) var(--space-2);
			color: inherit;
			cursor: pointer;
		}

		.label {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.nudge {
			flex: 0 0 auto;
			background: none;
			border: none;
			color: var(--ink-2);
			cursor: pointer;
			padding: var(--space-1);
		}
	}

	.substituted {
		border-left: 2px solid var(--rule);
		padding-left: var(--space-2);
	}

	.unavailable {
		padding: var(--space-2) 0;
	}

	.note {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--text-xs);
	}
	.note {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--text-xs);
	}
</style>
