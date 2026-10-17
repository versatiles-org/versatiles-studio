<script lang="ts">
	import type {
		DemEncoding,
		Hillshade,
		Preset,
		RasterAdjust,
		Recolor,
		SourceKind,
		SourceStyle
	} from '../../ipc/commands';
	import { KIND_LABELS, isVector, sourceKind } from '../../map/source-kind';
	import { schemaOf } from '../../map/builders';
	import { demEncoding, type StyleBasis } from '../../map/style';
	import { token } from '../../styles/tokens';
	import type { StyleSpecification } from 'maplibre-gl';
	import { canGenerateCode, styleCode } from '../../map/style-code';
	import {
		BASIS_NOTE,
		HILLSHADE_COLOURS,
		HILLSHADE_SLIDERS,
		KIND_OPTIONS,
		PRESETS,
		RASTER_SLIDERS,
		RECOLOR_SLIDERS,
		encodingChoice,
		inertOverrides,
		isAdjusted,
		kindChoice,
		resamplingChoice,
		sliderValue,
		withSlider,
		type RasterKey,
		type RecolorKey,
		type ShadeKey
	} from './controls';

	// How one source is drawn, as the recipe it is made from (S4.2, D1, [Q36]).
	//
	// **Three things, in the order they narrow.** What the tiles are read as, where the style starts,
	// and the adjustments that apply to every colour in it at once (D1). The layers themselves are
	// the Layers pane's ([Q62]); the export at the foot writes the whole map, and says so.
	//
	// **Data in, actions out** (S10.8). Like the other three panes, this takes the focused source's
	// style as a prop and hands every write back through `actions` - it reads no state module and
	// opens no dialog, so it renders in a test without a backend and reads the same way as its
	// neighbours. The state module behind `actions` is `state/style.svelte.ts`; the dialogs and the
	// export commands are `state/style-export.svelte.ts`.
	//
	// The sliders preview continuously and commit once, which is why each is bound to a local value
	// rather than to the recipe: a slider bound to the core would record an undo entry per pixel of
	// travel ([Q36]).

	let {
		sourceStyle,
		rendered = null,
		source = null,
		basis = 'none',
		own = null,
		exporting = null,
		missingFonts = [],
		actions
	}: {
		/** The focused source's style, with any in-flight gesture applied - `style.source`. */
		sourceStyle: SourceStyle;
		/** The style on the map - the whole stack, which is what an export writes. */
		rendered?: StyleSpecification | null;
		/** What the previewed source turned out to be, for reading its kind (S6.1). `null` before
		 *  anything is open, which is when this pane has nothing to say at all. */
		source?: { tileFormat: string; tileSchema: string | null; layers: string[] } | null;
		/** Which route produced `rendered` (S6.2). A preset that could not draw these tiles is
		 *  replaced by derived layers, and the person who picked it should be told rather than left
		 *  to notice the map does not match the preset they chose. */
		basis?: StyleBasis;
		/** The style the edited source drew on its own, before the stack renamed anything.
		 *
		 *  **Not `rendered`, which is the whole stack.** Everything this pane writes belongs to one
		 *  graph's recipe and is keyed on the ids `styleFor` produced, and `composeStyle` prefixes
		 *  those as soon as a second thing draws - a basemap is enough ([Q51]). Export still takes
		 *  `rendered`: a `style.json` is the map, not one layer of it. */
		own?: StyleSpecification | null;
		/** Which export is running, or `null` - the buttons are disabled while a dialog is up. */
		exporting?: 'json' | 'ts' | 'bundle' | null;
		/** Fonts the last bundle could not find. */
		missingFonts?: string[];
		actions: {
			setPreset: (preset: Preset) => void;
			/** Corrects what the tiles are read as, or `null` to hand the question back (S6.1). */
			setKind: (kind: SourceKind | null) => void;
			setRaster: (adjust: RasterAdjust) => void;
			setHillshade: (shade: Hillshade) => void;
			/** Shows a recolouring without recording it; `commitRecolor` records it as one undo entry. */
			previewRecolor: (recolor: Recolor) => void;
			commitRecolor: () => void;
			cancelRecolor: () => void;
			/** Clears overrides for layers the current style has no place for (S6.7). */
			pruneOverrides: (present: string[]) => void;
			/** Writes the map's style as JSON, or as the code that regenerates it - `null` when none. */
			exportAs: (kind: 'json' | 'ts', code: string | null) => void;
			exportBundle: () => void;
		};
	} = $props();

	// **The pane edits one source, not the whole recipe** (S6.4).
	const appearance = $derived(sourceStyle.appearance);
	const vectorAppearance = $derived(appearance.type === 'vector' ? appearance : null);
	const rasterAdjust = $derived(appearance.type === 'raster' ? appearance.adjust : {});
	const shade = $derived<Hillshade>(appearance.type === 'hillshade' ? appearance.shade : {});

	/// The encoding in force: what the recipe says, else what the container declared.
	const encoding = $derived<DemEncoding | null>(shade.encoding ?? demEncoding(source?.tileSchema));

	const shadeValue = (key: ShadeKey): number =>
		sliderValue(HILLSHADE_SLIDERS, shade as Record<string, number | null>, key);

	/// Layer ids the style on the map actually has, which is what an override can apply to.
	const presentIds = $derived(own?.layers.map((layer) => layer.id) ?? []);

	/// Overrides with no layer to land on - invisible in the tree, because it lists layers.
	const inert = $derived(inertOverrides(vectorAppearance?.overrides ?? {}, presentIds));

	const shaded = $derived(isAdjusted(shade));

	function setShade(patch: Partial<Hillshade>): void {
		actions.setHillshade({ ...shade, ...patch });
	}

	// **What these tiles are, and how confidently** (S6.1). Everything below is gated on it, because
	// a preset aimed at raster tiles is not a control that does something subtle - it is a control
	// that does nothing, and one that looks identical to a working one is worse than none.
	const reading = $derived(
		source ? sourceKind(source.tileFormat, source.tileSchema, source.layers, sourceStyle.kind) : null
	);
	const kind = $derived(reading?.kind ?? null);
	const vector = $derived(kind === null || isVector(kind));
	/// Which builder the preset goes through - `osm()`, `omt()` or `protomaps()` - and so which one the
	/// exported code calls.
	const schema = $derived(schemaOf(kind));

	/// Every raster slider's neutral is `0` except opacity, whose is `1` - the same asymmetry the
	/// vector sliders have, for the same reason: a multiplier's identity is not zero.
	const rasterValue = (key: RasterKey): number =>
		sliderValue(RASTER_SLIDERS, rasterAdjust as Record<string, number | null>, key);

	const rasterAdjusted = $derived(isAdjusted(rasterAdjust));

	/// Previewed locally and committed once, exactly as the recolour gesture is.
	let rasterPending = $state<RasterAdjust | null>(null);
	const rasterNow = $derived(rasterPending ?? rasterAdjust);

	function previewRaster(key: RasterKey, raw: string): void {
		rasterPending = withSlider(RASTER_SLIDERS, rasterNow, key, raw);
	}

	function commitRaster(): void {
		if (rasterPending) actions.setRaster(rasterPending);
		rasterPending = null;
	}

	function setResampling(value: string): void {
		actions.setRaster({ ...rasterNow, resampling: resamplingChoice(value) });
	}

	function resetRaster(): void {
		rasterPending = null;
		actions.setRaster({});
	}

	/// Clears one recolour field, leaving the rest alone.
	///
	/// **`undefined`, not the neutral number.** The recipe stores only what was changed, so a field
	/// set back to its neutral value must leave no trace - otherwise an untouched style and a reset
	/// one compare unequal, and the exported code carries settings nobody chose.
	function clearRecolor(key: string): void {
		actions.previewRecolor({ ...(vectorAppearance?.recolor ?? {}), [key]: undefined } as Recolor);
		actions.commitRecolor();
	}

	function clearRaster(key: RasterKey): void {
		rasterPending = null;
		actions.setRaster({ ...rasterNow, [key]: undefined });
	}

	function clearShade(key: keyof Hillshade): void {
		setShade({ [key]: undefined });
	}

	/** Picking the reading Studio already made means clearing the override, not recording it. */
	function chooseKind(next: string): void {
		const derivedNow = source ? sourceKind(source.tileFormat, source.tileSchema, source.layers).kind : null;
		actions.setKind(kindChoice(next as SourceKind, derivedNow));
	}

	/// What the sliders show. Read from the recipe, written by dragging, committed on release.
	const value = (key: RecolorKey): number =>
		sliderValue(RECOLOR_SLIDERS, vectorAppearance?.recolor as Record<string, number | null>, key);

	/// Applies one field of the recolouring without recording it.
	///
	/// `withSlider` is what puts the value back to "unset" at neutral, so a slider returned to the
	/// middle leaves no trace in the recipe and none in the exported code.
	function preview(key: RecolorKey, raw: string) {
		actions.previewRecolor(withSlider(RECOLOR_SLIDERS, vectorAppearance?.recolor ?? {}, key, raw) as Recolor);
	}

	function invert(on: boolean) {
		actions.previewRecolor({ ...(vectorAppearance?.recolor ?? {}), invertBrightness: on || undefined } as Recolor);
		actions.commitRecolor();
	}

	function reset() {
		actions.previewRecolor({});
		actions.commitRecolor();
	}

	/// The code export is the one whose contents depend on what this pane knows - the preset, what was
	/// changed, which layers are present and which builder to call - so it is produced here and handed
	/// out; the JSON is the map and the caller already has it.
	const code = $derived(canGenerateCode(appearance, schema) ? styleCode(appearance, presentIds, schema) : null);

	const adjusted = $derived(Object.values(vectorAppearance?.recolor ?? {}).some((v) => v !== undefined && v !== null));
</script>

{#snippet clearer(changed: boolean, clear: () => void, what: string)}
	<!-- Always rendered, hidden when there is nothing to clear: a button that appears and disappears
	     moves every row beside it, and these sit in a column. -->
	<button
		type="button"
		class="clear"
		class:idle={!changed}
		tabindex={changed ? 0 : -1}
		aria-hidden={!changed}
		aria-label="Reset {what}"
		title="Reset"
		onclick={clear}>↺</button
	>
{/snippet}

<!-- **Says so rather than drawing nothing.** With no source there is no reading, no preset and
     nothing to export, and every section below falls away - which left an empty column once this
     pane stopped being hidden along with the rest ([Q54]). -->
{#if !source}
	<p class="nothing">Nothing to style yet. Add a source to see how it is drawn.</p>
{:else}
	<section class="style-pane">
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

		{#if kind === 'rasterDem'}
			<h2 class="section-label">
				Hillshade
				{#if shaded}
					<button type="button" class="reset" onclick={() => actions.setHillshade({})}>reset</button>
				{/if}
			</h2>

			<label class="kind">
				<span class="name">Encoding</span>
				<select
					value={encoding ?? ''}
					onchange={(event) => setShade({ encoding: encodingChoice(event.currentTarget.value) })}
				>
					<option value="">Not set</option>
					<option value="mapbox">Mapbox</option>
					<option value="terrarium">Terrarium</option>
				</select>
			</label>

			{#if !encoding}
				<!-- Nothing published says how `dem/versatiles` packs elevation, and a guess would draw
				     convincing relief of the wrong mountains. Better to ask than to invent. -->
				<p class="note unavailable">
					These tiles do not say how their elevation is packed, so nothing can be shaded yet. Pick the encoding if you
					know it.
				</p>
			{:else}
				{#each HILLSHADE_SLIDERS as slider (slider.key)}
					<label class="slider">
						<span class="name">{slider.label}</span>
						<input
							type="range"
							min={slider.min}
							max={slider.max}
							step={slider.step}
							value={shadeValue(slider.key)}
							onchange={(event) => setShade({ [slider.key]: Number(event.currentTarget.value) })}
						/>
						<span class="amount">{shadeValue(slider.key)}{slider.unit}</span>
						{@render clearer(shade[slider.key] != null, () => clearShade(slider.key), slider.label)}
					</label>
				{/each}

				{#each HILLSHADE_COLOURS as swatch (swatch.key)}
					<label class="kind">
						<span class="name">{swatch.label}</span>
						<input
							type="color"
							value={shade[swatch.key] ?? token(swatch.token)}
							onchange={(event) => setShade({ [swatch.key]: event.currentTarget.value })}
						/>
						{@render clearer(shade[swatch.key] != null, () => clearShade(swatch.key), swatch.label)}
					</label>
				{/each}
			{/if}
		{:else if kind === 'rasterImage'}
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
					{@render clearer(rasterAdjust[slider.key] != null, () => clearRaster(slider.key), slider.label)}
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
		{:else if vector}
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
						onclick={() => actions.setPreset(preset.id)}
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

			{#each RECOLOR_SLIDERS as slider (slider.key)}
				<label class="slider">
					<span class="name">{slider.label}</span>
					<input
						type="range"
						min={slider.min}
						max={slider.max}
						step={slider.step}
						value={value(slider.key)}
						oninput={(event) => preview(slider.key, event.currentTarget.value)}
						onchange={() => actions.commitRecolor()}
						onpointercancel={() => actions.cancelRecolor()}
					/>
					<span class="amount">{value(slider.key)}{slider.unit}</span>
					{@render clearer(value(slider.key) !== slider.neutral, () => clearRecolor(slider.key), slider.label)}
				</label>
			{/each}

			<p class="note">These apply to every colour in the style at once.</p>

			{#if inert.length > 0}
				<!-- S6.7: the tree lists layers, so an override whose layer this preset does not have is
				     invisible. It is kept rather than dropped - the presets share a namespace, and it
				     applies again under one that has the layer - so clearing is offered, never automatic. -->
				<p class="note substituted">
					{inert.length}
					{inert.length === 1 ? 'change applies' : 'changes apply'} to layers this preset does not draw. They come back under
					a preset that has them.
					<button type="button" class="reset" onclick={() => actions.pruneOverrides(presentIds)}> clear </button>
				</p>
			{/if}
		{/if}

		<!-- The one control here that is not about the selected source: a `style.json` is the map,
		     every drawn source in the Layers pane's order. The Pipeline pane's export writes tiles, so
		     both say what they write (S10.6). -->
		<h2 class="section-label">Export map style</h2>
		<p class="note">The whole map: every source that is drawn, in the order the Layers pane shows.</p>
		<div class="exports">
			<button
				type="button"
				class="button"
				disabled={!rendered || exporting !== null}
				onclick={() => rendered && actions.exportAs('json', null)}
			>
				style.json
			</button>
			<!-- Disabled rather than hidden for a derived style: the reason it cannot be written as
			     code is worth saying, and a button that vanishes says nothing. -->
			<button
				type="button"
				class="button"
				disabled={!rendered || exporting !== null || code === null}
				title={code !== null
					? 'The preset and what was changed, as code'
					: 'A derived style has no builder to call - export it as style.json'}
				onclick={() => rendered && actions.exportAs('ts', code)}
			>
				@versatiles/style code
			</button>
			<button
				type="button"
				class="button"
				disabled={!rendered || exporting !== null}
				title="The style, its glyphs and its sprites, as one .zip"
				onclick={() => rendered && actions.exportBundle()}
			>
				Bundle
			</button>
		</div>

		{#if missingFonts.length > 0}
			<p class="note" role="status">
				No glyphs were found for {missingFonts.join(', ')} - install the family under Assets, or MapLibre will fall back.
			</p>
		{/if}
	</section>
{/if}

<style>
	.nothing {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink-2);
		line-height: 1.5;
	}

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
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--ink-2);
		font-size: var(--text-sm);

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
		color: var(--accent);
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
		grid-template-columns: 5.5rem 1fr 3rem auto;
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
	   present - so it reads as a statement rather than as small print under a control. */
	/* A statement about what the map is showing, not a hint about a control - so it sits above the
	   presets rather than under them, and reads before the thing it is explaining. */
	/* A per-field reset, quiet until the field has something to reset. `visibility` rather than
	   `display`, so the column keeps its width and no row shifts as values change. */
	.clear {
		background: none;
		border: none;
		padding: 0 var(--space-1);
		color: var(--ink-2);
		cursor: pointer;
		line-height: 1;

		&.idle {
			visibility: hidden;
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
