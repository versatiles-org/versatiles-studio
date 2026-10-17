<script lang="ts">
	import Icon from '../../common/Icon.svelte';
	import type { DemEncoding, Hillshade, RasterAdjust, Recolor, SourceKind, SourceStyle } from '../../ipc/commands';
	import Field from '../../common/Field.svelte';
	import Group from '../../common/Group.svelte';
	import Note from '../../common/Note.svelte';
	import { KIND_LABELS, isVector, sourceKind } from '../../map/source-kind';
	import { DEFAULT_THEME, isTheme, schemaOf, themesFor } from '../../map/builders';
	import { demEncoding, type StyleBasis } from '../../map/style';
	import { token } from '../../styles/tokens';
	import type { StyleSpecification } from 'maplibre-gl';
	import type { StyleProblem } from '../../map/style-check';
	import { canGenerateCode, styleCode } from '../../map/style-code';
	import {
		BASIS_NOTE,
		HILLSHADE_COLOURS,
		HILLSHADE_SLIDERS,
		kindOptions,
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
		problems = null,
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
		/** What MapLibre's validator says about the style as it would be written (S14.9); `null`
		 *  until it has been checked. */
		problems?: StyleProblem[] | null;
		actions: {
			/** A palette name as `@versatiles/style` spells it, from the list `themesFor` gives. */
			setTheme: (theme: string) => void;
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
	/// A schema a builder knows, so a theme is something to choose. `vectorOther` is vector too, but
	/// its editor is the inspector style, which has no theme ([S11.2]).
	const themed = $derived(kind === null || (isVector(kind) && kind !== 'vectorOther'));
	/// Which builder the theme goes through - `osm()`, `omt()` or `protomaps()` - and so which one the
	/// exported code calls.
	const schema = $derived(schemaOf(kind));

	/// The themes that builder offers, in two groups ([S11.3]).
	const themes = $derived(themesFor(schema));
	/// The theme the recipe names, or the default when it names none the builder knows - in which case
	/// the dropdown shows the default and the note below it says why.
	const storedTheme = $derived(vectorAppearance?.theme ?? DEFAULT_THEME);
	const knownTheme = $derived(isTheme(schema, storedTheme));

	/// Every raster slider's neutral is `0` except opacity, whose is `1` - the same asymmetry the
	/// vector sliders have, for the same reason: a multiplier's identity is not zero.
	const rasterValue = (key: RasterKey): number =>
		sliderValue(RASTER_SLIDERS, rasterAdjust as Record<string, number | null>, key);

	const rasterAdjusted = $derived(isAdjusted(rasterAdjust));

	/// Previewed locally and committed once, exactly as the recolour gesture is.
	///
	/// **Dropped when the source changes** ([S11.4]). The state module clears its own pending gesture
	/// on a focus change; this one is the pane's, and a slider half-dragged on one source would
	/// otherwise show its value on the next.
	let rasterPending = $state<RasterAdjust | null>(null);
	$effect(() => {
		void sourceStyle;
		rasterPending = null;
	});
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

	/** How many style problems are listed before the rest are only counted. */
	const SHOWN = 8;
</script>

{#snippet clearer(changed: boolean, clear: () => void, what: string)}
	<!-- Always rendered, hidden when there is nothing to clear: a button that appears and disappears
	     moves every row beside it, and these sit in a column. -->
	<button
		type="button"
		class="icon clear"
		class:idle={!changed}
		tabindex={changed ? 0 : -1}
		aria-hidden={!changed}
		aria-label="Reset {what}"
		title="Reset"
		onclick={clear}><Icon name="undo" size="1em" /></button
	>
{/snippet}

{#snippet resetShade()}
	<button type="button" class="quiet" onclick={() => actions.setHillshade({})}>reset</button>
{/snippet}
{#snippet resetRasterAll()}
	<button type="button" class="quiet" onclick={resetRaster}>reset</button>
{/snippet}
{#snippet resetRecolor()}
	<button type="button" class="quiet" onclick={reset}>reset</button>
{/snippet}

<!-- **Says so rather than drawing nothing.** With no source there is no reading, no theme and
     nothing to export, and every group below falls away - which left an empty column once this
     pane stopped being hidden along with the rest ([Q54]). -->
{#if !source}
	<Note tone="empty">Nothing to style yet. Add a source to see how it is drawn.</Note>
{:else}
	<!-- Groups of the kit, one per thing this pane says (S12.5): what the tiles are, the editor their
	     kind picks, and the export. The pane title is the header's; these headings are the second
	     level and the last ([Q70]). -->
	<div class="pane-body">
		{#if reading}
			<Group title="These tiles">
				<!-- Only the kinds this format can be ([S11.4]): a reading the format rules out is a set of
				     controls that do nothing, and `styleFor` would draw nothing under them. -->
				<Field label="Read as">
					<select aria-label="Read as" value={kind} onchange={(event) => chooseKind(event.currentTarget.value)}>
						{#each kindOptions(source.tileFormat) as option (option)}
							<option value={option}>{KIND_LABELS[option]}</option>
						{/each}
					</select>
				</Field>
				<Note>{BASIS_NOTE[reading.basis]}.</Note>
			</Group>
		{/if}

		{#if kind === 'rasterDem'}
			<Group title="Hillshade" action={shaded ? resetShade : undefined}>
				<Field label="Encoding">
					<select
						value={encoding ?? ''}
						onchange={(event) => setShade({ encoding: encodingChoice(event.currentTarget.value) })}
					>
						<option value="">Not set</option>
						<option value="mapbox">Mapbox</option>
						<option value="terrarium">Terrarium</option>
					</select>
				</Field>

				{#if !encoding}
					<!-- Nothing published says how `dem/versatiles` packs elevation, and a guess would draw
					     convincing relief of the wrong mountains. Better to ask than to invent. -->
					<Note>
						These tiles do not say how their elevation is packed, so nothing can be shaded yet. Pick the encoding if you
						know it.
					</Note>
				{:else}
					{#each HILLSHADE_SLIDERS as slider (slider.key)}
						{#snippet trail()}
							<span class="amount">{shadeValue(slider.key)}{slider.unit}</span>
							{@render clearer(shade[slider.key] != null, () => clearShade(slider.key), slider.label)}
						{/snippet}
						<Field label={slider.label} {trail}>
							<input
								type="range"
								min={slider.min}
								max={slider.max}
								step={slider.step}
								value={shadeValue(slider.key)}
								onchange={(event) => setShade({ [slider.key]: Number(event.currentTarget.value) })}
							/>
						</Field>
					{/each}

					{#each HILLSHADE_COLOURS as swatch (swatch.key)}
						{#snippet trail()}
							{@render clearer(shade[swatch.key] != null, () => clearShade(swatch.key), swatch.label)}
						{/snippet}
						<Field label={swatch.label} {trail}>
							<input
								type="color"
								value={shade[swatch.key] ?? token(swatch.token)}
								onchange={(event) => setShade({ [swatch.key]: event.currentTarget.value })}
							/>
						</Field>
					{/each}
				{/if}
			</Group>
		{:else if kind === 'rasterImage'}
			<Group title="Adjust" action={rasterAdjusted ? resetRasterAll : undefined}>
				{#each RASTER_SLIDERS as slider (slider.key)}
					{#snippet trail()}
						<span class="amount">{rasterValue(slider.key)}{slider.unit}</span>
						{@render clearer(rasterAdjust[slider.key] != null, () => clearRaster(slider.key), slider.label)}
					{/snippet}
					<Field label={slider.label} {trail}>
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
					</Field>
				{/each}

				<Field label="Scaling">
					<select
						value={rasterAdjust.resampling ?? 'linear'}
						onchange={(event) => setResampling(event.currentTarget.value)}
					>
						<option value="linear">Smooth</option>
						<option value="nearest">Keep pixels square</option>
					</select>
				</Field>
				<!-- `nearest` is what a scan of a printed map or any pixel art wants; smoothing those
				     turns crisp edges into mush at every zoom that is not exactly native. -->
				<Note>Smooth blends between pixels. Square keeps them as they are.</Note>
			</Group>
		{:else if kind === 'vectorOther'}
			<!-- **The kind picks the editor** ([S11.2]). Tiles no builder knows are drawn as the
			     inspector style: every layer they contain, in a colour of its own. There is no theme to
			     choose and nothing to recolour; what can be changed is each layer, in the Layers pane. -->
			<Group title="Inspector style">
				<Note>
					Every layer these tiles contain, each in its own colour. Change a layer's colour, zoom range or filter in the
					Layers pane. To draw them as a map, read them as the schema they follow.
				</Note>
			</Group>
		{:else if themed}
			<Group title="Theme">
				{#if basis === 'fallback'}
					{#snippet readAsOther()}
						<button type="button" class="quiet" onclick={() => chooseKind('vectorOther')}>Read as Vector · other</button
						>
					{/snippet}
					<!-- S6.2: the theme is still what the recipe says, and it is not what the map is
					     showing. Saying so here is cheaper than leaving someone to compare the two - and
					     since the kind picks the editor ([S11.4]), the fix is a reading rather than another
					     theme, so it is offered where the problem is stated. -->
					<Note tone="aside" action={readAsOther}>
						These tiles have none of the layers this theme draws, so they are shown as the inspector style instead. They
						are probably not {kind === null ? 'this schema' : KIND_LABELS[kind]}.
					</Note>
				{/if}
				<!-- **The library's list, in a dropdown** ([S11.3]). Twenty-four themes do not fit as
				     buttons, and the list is the builder's rather than Studio's: the five palettes with
				     their dark partners first, then the lookalikes with what each one is after. -->
				<Field label="Theme">
					<select
						aria-label="Theme"
						value={knownTheme ? storedTheme : DEFAULT_THEME}
						onchange={(event) => actions.setTheme(event.currentTarget.value)}
					>
						<optgroup label="Palettes">
							{#each themes.palettes as theme (theme.id)}
								<option value={theme.id}>{theme.label}</option>
							{/each}
						</optgroup>
						<optgroup label="Lookalikes">
							{#each themes.lookalikes as theme (theme.id)}
								<option value={theme.id}>{theme.label} · after {theme.resembles}{theme.dark ? ', dark' : ''}</option>
							{/each}
						</optgroup>
					</select>
				</Field>
				{#if !knownTheme}
					<Note tone="aside">
						This project names a theme ({storedTheme}) this build does not have, so the default is drawn until another
						is chosen.
					</Note>
				{/if}
			</Group>

			<Group title="Adjust" action={adjusted ? resetRecolor : undefined}>
				<!-- D5's whole feature. Hues are kept, so a light style becomes a dark one rather than a
				     photographic negative. -->
				<Field label="Invert brightness">
					<input
						type="checkbox"
						title="Light becomes dark; the hues are kept"
						checked={(vectorAppearance?.recolor ?? {}).invertBrightness ?? false}
						onchange={(event) => invert(event.currentTarget.checked)}
					/>
				</Field>

				{#each RECOLOR_SLIDERS as slider (slider.key)}
					{#snippet trail()}
						<span class="amount">{value(slider.key)}{slider.unit}</span>
						{@render clearer(value(slider.key) !== slider.neutral, () => clearRecolor(slider.key), slider.label)}
					{/snippet}
					<Field label={slider.label} {trail}>
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
					</Field>
				{/each}

				<Note>These apply to every colour in the style at once.</Note>

				{#if inert.length > 0}
					{#snippet pruneInert()}
						<button type="button" class="quiet" onclick={() => actions.pruneOverrides(presentIds)}>clear</button>
					{/snippet}
					<!-- S6.7: the tree lists layers, so an override whose layer this theme does not have is
					     invisible. It is kept rather than dropped - the themes share a namespace, and it
					     applies again under one that has the layer - so clearing is offered, never automatic. -->
					<Note tone="aside" action={pruneInert}>
						{inert.length}
						{inert.length === 1 ? 'change applies' : 'changes apply'} to layers this theme does not draw. They come back under
						a theme that has them.
					</Note>
				{/if}
			</Group>
		{/if}

		<!-- The one control here that is not about the selected source: a `style.json` is the map,
		     every drawn source in the Layers pane's order. The Pipeline pane's export writes tiles, so
		     both say what they write (S10.6). -->
		<Group title="Export map style">
			<Note>The whole map: every source that is drawn, in the order the Layers pane shows.</Note>
			<!-- Three short names, so the row is one row at the pane's default width: the long one,
			     "@versatiles/style code", pushed Bundle onto a line of its own, and what the code is for
			     is in the tooltip. -->
			<div class="toolbar">
				<button
					type="button"
					class="button"
					disabled={!rendered || exporting !== null}
					title="The map's style as MapLibre reads it"
					onclick={() => rendered && actions.exportAs('json', null)}
				>
					style.json
				</button>
				<!-- Disabled rather than hidden for the inspector style: the reason it cannot be written as
				     code is worth saying, and a button that vanishes says nothing. -->
				<button
					type="button"
					class="button"
					disabled={!rendered || exporting !== null || code === null}
					title={code !== null
						? 'The theme and what was changed, as @versatiles/style code'
						: 'The inspector style has no builder to call - export it as style.json'}
					onclick={() => rendered && actions.exportAs('ts', code)}
				>
					Code
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

			<!-- **Beside the buttons, before anyone presses one** (S14.9): a style MapLibre refuses is
			     worth knowing about before it is written, not after it fails to load somewhere else. -->
			{#if problems && problems.length === 0}
				<Note tone="aside">The style passes the MapLibre style spec.</Note>
			{:else if problems}
				{@const errors = problems.filter((problem) => problem.severity === 'error').length}
				<Note tone="problem">
					{problems.length}
					{problems.length === 1 ? 'problem' : 'problems'} against the MapLibre style spec{errors > 0
						? ' - MapLibre will refuse the file'
						: ''}.
				</Note>
				<ul class="problems" aria-label="Style problems">
					{#each problems.slice(0, SHOWN) as problem, i (i)}
						<li class:warning={problem.severity === 'warning'}>{problem.message}</li>
					{/each}
				</ul>
				{#if problems.length > SHOWN}
					<Note>And {problems.length - SHOWN} more.</Note>
				{/if}
			{/if}

			{#if missingFonts.length > 0}
				<Note>
					No glyphs were found for {missingFonts.join(', ')} - install the family under Assets, or MapLibre will fall back.
				</Note>
			{/if}
		</Group>
	</div>
{/if}

<style>
	/* The validator's words, which name paths in the style - in its monospace, and broken anywhere,
	   since a path has no spaces to break at. */
	.problems {
		margin: 0;
		padding-left: var(--space-4);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		overflow-wrap: anywhere;
		color: var(--error);

		.warning {
			color: var(--ink-2);
		}
	}

	/* What is this pane's own: the number a slider reads, which must not twitch as digits change
	   width, and the per-field reset that keeps its place while hidden so no row shifts. */
	.amount {
		min-width: 3rem;
		text-align: right;
	}

	.clear.idle {
		visibility: hidden;
	}
</style>
