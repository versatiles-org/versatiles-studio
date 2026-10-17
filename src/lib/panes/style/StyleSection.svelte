<script lang="ts">
	import StylePane from './StylePane.svelte';
	import { composition } from '../../map/composition.svelte';
	import { sourceKind } from '../../map/source-kind';
	import { declaredLayers } from '../../map/tile-json';
	import { style } from '../../state/style.svelte';
	import { styleExport } from '../../state/style-export.svelte';
	import { workbench } from '../../state/workbench.svelte';

	// The Style pane, connected (S10.10).
	//
	// **The wiring that used to be one arm of `App.svelte`**, and the one rule that belongs to this
	// pane alone: which source its controls edit.

	// **What the style pane edits** (S6.4).
	//
	// The pane holds one graph at a time, and until this existed nothing ever told it which - so every
	// control in it read the unstyled default and wrote nowhere. It looked right, because the default
	// is what an untouched source shows, and it stayed wrong until an end-to-end test pressed a preset
	// and asked the core what it had recorded ([the plan](../../../../docs/scope-e2e.md)).
	//
	// Name as well as id, because the recipe files a source's style under its name and a rename has to
	// move the pane with it - `focus` ignores a repeat of what it already holds. Here rather than in
	// the page root because the focus exists for this pane: it is what its sliders preview against,
	// and nothing else reads it.
	$effect(() => {
		style.focus(workbench.selected);
	});

	const build = $derived(composition.editedBuild);

	/// What the built tiles are, read without any correction - the correction, if there is one, lives
	/// in the stored style, which `sourceOr` returns whole. This decides only what an *unstyled*
	/// source is shown as ([S11.2]).
	const kind = $derived(
		build ? sourceKind(build.info.tileFormat, build.info.tileSchema, declaredLayers(build.info)).kind : null
	);
</script>

<StylePane
	sourceStyle={style.sourceOr(kind)}
	rendered={composition.style}
	basis={composition.edited?.basis ?? 'none'}
	own={composition.edited?.style ?? null}
	source={build
		? { tileFormat: build.info.tileFormat, tileSchema: build.info.tileSchema, layers: declaredLayers(build.info) }
		: null}
	exporting={styleExport.exporting}
	missingFonts={styleExport.missingFonts}
	actions={{
		setPreset: (preset) => void style.setPreset(preset),
		setKind: (kind) => void style.setKind(kind),
		setRaster: (adjust) => void style.setRaster(adjust),
		setHillshade: (shade) => void style.setHillshade(shade),
		previewRecolor: (recolor) => style.previewRecolor(recolor),
		commitRecolor: () => void style.commitRecolor(),
		cancelRecolor: () => style.cancelRecolor(),
		pruneOverrides: (present) => void style.pruneOverrides(present),
		// The whole stack, not the selected source: a `style.json` is the map.
		exportAs: (kind, code) => composition.style && void styleExport.write(kind, composition.style, code),
		exportBundle: () => composition.style && void styleExport.bundle(composition.style)
	}}
/>
