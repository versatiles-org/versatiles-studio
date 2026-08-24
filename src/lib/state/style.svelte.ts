/**
 * The project's style, mirrored from the core (S4.2, [Q36]).
 *
 * The core owns the **recipe** — a preset, the adjustments over it, and whatever layers were
 * changed by hand — and this holds the copy the pane draws. What the map renders is generated from
 * it here, because `@versatiles/style` is a JavaScript library and the core is Rust.
 *
 * **Every edit goes to the core and comes back.** A command returns the recipe as it now stands, so
 * this is assigned from the answer rather than updated in advance and hoped about. That is what
 * keeps ⌘Z honest: the undo stack and this mirror cannot hold different ideas of what the style is,
 * because only one of them is ever written to first.
 *
 * [Q36]: ../../../docs/decisions.md
 */

import {
	style as fetchStyle,
	setStylePreset,
	setStyleRecolor,
	setStyleKind,
	setStyleRaster,
	setLayerOverride,
	type LayerOverride,
	type Preset,
	type Recipe,
	type Recolor,
	type SourceKind,
	type RasterAdjust
} from '../ipc/commands';

/** The recipe as the core last reported it. `null` until the first read. */
let recipe = $state<Recipe | null>(null);

/**
 * What is being previewed but has not been committed (D1).
 *
 * A colour or a slider changes sixty times a second while it is being dragged, and each commit is
 * an undo entry — so a gesture previews through this and commits once when it ends. Reading it
 * falls back to the committed recipe, which is what makes every consumer indifferent to whether a
 * gesture is in progress.
 */
let pending = $state<Recolor | null>(null);

export const style = {
	/** The recipe to draw, with any in-flight gesture applied. `null` before the first read. */
	get current(): Recipe | null {
		if (!recipe) return null;
		return pending ? { ...recipe, recolor: pending } : recipe;
	},

	/** The committed recipe, ignoring any gesture in progress. */
	get committed(): Recipe | null {
		return recipe;
	},

	/** Whether a gesture is being previewed. */
	get previewing(): boolean {
		return pending !== null;
	},

	/** Reads the recipe from the core. Called once, at startup. */
	async load(): Promise<void> {
		recipe = await fetchStyle();
	},

	/** What ⌘Z restored — assigned, never merged, because the core is the one that stepped. */
	restored(next: Recipe): void {
		pending = null;
		recipe = next;
	},

	async setPreset(preset: Preset): Promise<void> {
		recipe = await setStylePreset(preset);
	},

	/**
	 * Corrects what the tiles are being read as, or hands the question back with `null` (S6.1).
	 *
	 * One call, not a preview-then-commit pair: this is a picker, and a picker's gesture is over the
	 * moment it is made. The recolour dance above exists for controls that move continuously.
	 */
	async setKind(kind: SourceKind | null): Promise<void> {
		recipe = await setStyleKind(kind);
	},

	/** Records the raster adjustment as one undo entry (S6.3, D11). */
	async setRaster(raster: RasterAdjust): Promise<void> {
		recipe = await setStyleRaster(raster);
	},

	/** Shows a recolouring without recording it. Ends with `commitRecolor` or `cancelRecolor`. */
	previewRecolor(next: Recolor): void {
		pending = next;
	},

	/** Records the previewed recolouring as one undo entry. */
	async commitRecolor(): Promise<void> {
		if (!pending) return;
		const next = pending;
		pending = null;
		recipe = await setStyleRecolor(next);
	},

	/** Abandons the preview, e.g. when a gesture is cancelled. */
	cancelRecolor(): void {
		pending = null;
	},

	async setLayer(layer: string, patch: LayerOverride): Promise<void> {
		recipe = await setLayerOverride(layer, patch);
	}
};
