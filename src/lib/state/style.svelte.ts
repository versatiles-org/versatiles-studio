/**
 * The project's style, mirrored from the core (S4.2, [Q36]).
 *
 * The core owns the **recipe** - a preset, the adjustments over it, and whatever layers were
 * changed by hand - and this holds the copy the pane draws. What the map renders is generated from
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
	setStyleOrder,
	setStyleHillshade,
	pruneStyleOverrides,
	setLayerHidden,
	setLayerOverride,
	type LayerOverride,
	type Preset,
	type Recipe,
	type Recolor,
	type Segment,
	type SourceKind,
	type RasterAdjust,
	type SourceStyle,
	type Hillshade
} from '../ipc/commands';

/** The recipe as the core last reported it. `null` until the first read. */
let recipe = $state<Recipe | null>(null);

/**
 * The graph whose style the pane is editing (S6.4).
 *
 * **Id and name both, because the two ends key differently.** Commands take a `GraphId`, because a
 * rename must not invalidate a reference held mid-edit; the recipe files each source under its
 * name, because that is what a MapLibre style calls a source. Holding both here means no consumer
 * has to know that.
 */
let graph = $state<{ id: number; name: string } | null>(null);

/**
 * What is being previewed but has not been committed (D1).
 *
 * A colour or a slider changes sixty times a second while it is being dragged, and each commit is
 * an undo entry - so a gesture previews through this and commits once when it ends. Reading it
 * falls back to the committed value, which is what makes every consumer indifferent to whether a
 * gesture is in progress.
 */
let pending = $state<Recolor | null>(null);
let pendingRaster = $state<RasterAdjust | null>(null);

/** What a source that has never been styled looks like. */
const UNSTYLED: SourceStyle = {
	kind: null,
	appearance: { type: 'vector', preset: 'colorful', recolor: {}, overrides: {} }
};

/** The focused source's style, with any in-flight gesture applied. */
function focused(): SourceStyle {
	const stored = (graph && recipe?.sources?.[graph.name]) || UNSTYLED;
	if (!pending && !pendingRaster) return stored;

	if (pending && stored.appearance.type === 'vector') {
		return { ...stored, appearance: { ...stored.appearance, recolor: pending } };
	}
	if (pendingRaster && stored.appearance.type === 'raster') {
		return { ...stored, appearance: { ...stored.appearance, adjust: pendingRaster } };
	}
	return stored;
}

export const style = {
	/** The whole recipe, with any in-flight gesture applied. `null` before the first read. */
	get current(): Recipe | null {
		if (!recipe) return null;
		if (!graph || (!pending && !pendingRaster)) return recipe;
		return { ...recipe, sources: { ...recipe.sources, [graph.name]: focused() } };
	},

	/** The focused source's style, which is what the pane edits. */
	get source(): SourceStyle {
		return focused();
	},

	/** The committed recipe, ignoring any gesture in progress. */
	get committed(): Recipe | null {
		return recipe;
	},

	/** Whether a gesture is being previewed. */
	get previewing(): boolean {
		return pending !== null || pendingRaster !== null;
	},

	/**
	 * Points the pane at a graph.
	 *
	 * Clears any in-flight gesture: a slider half-dragged on one source must not commit onto
	 * another, which is what would happen if the preview outlived the selection.
	 */
	focus(next: { id: number; name: string } | null): void {
		if (next?.id === graph?.id && next?.name === graph?.name) return;
		pending = null;
		pendingRaster = null;
		graph = next;
	},

	/** Reads the recipe from the core. Called once, at startup. */
	async load(): Promise<void> {
		recipe = await fetchStyle();
	},

	/** What ⌘Z restored - assigned, never merged, because the core is the one that stepped. */
	restored(next: Recipe): void {
		pending = null;
		pendingRaster = null;
		recipe = next;
	},

	async setPreset(preset: Preset): Promise<void> {
		if (graph) recipe = await setStylePreset(graph.id, preset);
	},

	/**
	 * Corrects what the tiles are being read as, or hands the question back with `null` (S6.1).
	 *
	 * One call, not a preview-then-commit pair: this is a picker, and a picker's gesture is over the
	 * moment it is made. The recolour dance below exists for controls that move continuously.
	 */
	async setKind(kind: SourceKind | null): Promise<void> {
		if (graph) recipe = await setStyleKind(graph.id, kind);
	},

	/** Shows a raster adjustment without recording it. */
	previewRaster(next: RasterAdjust): void {
		pendingRaster = next;
	},

	/** Records the previewed raster adjustment as one undo entry (S6.3, D11). */
	async setRaster(raster: RasterAdjust): Promise<void> {
		pendingRaster = null;
		if (graph) recipe = await setStyleRaster(graph.id, raster);
	},

	cancelRaster(): void {
		pendingRaster = null;
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
		if (graph) recipe = await setStyleRecolor(graph.id, next);
	},

	/** Abandons the preview, e.g. when a gesture is cancelled. */
	cancelRecolor(): void {
		pending = null;
	},

	/** Records the hillshade settings as one undo entry (S6.6, D12). */
	async setHillshade(shade: Hillshade): Promise<void> {
		if (graph) recipe = await setStyleHillshade(graph.id, shade);
	},

	/** Clears overrides for layers the current style has no place for (S6.7). */
	async pruneOverrides(present: string[]): Promise<void> {
		if (graph) recipe = await pruneStyleOverrides(graph.id, present);
	},

	/**
	 * Sets the draw order, bottom first (S6.5).
	 *
	 * **Named sources, until something can split one.** The core stores segments so that a source can
	 * be drawn in two places, and every caller today moves whole sources - so the names are widened
	 * here rather than at each call site, and the day a run is dragged this takes segments instead.
	 */
	async setOrder(order: string[]): Promise<void> {
		recipe = await setStyleOrder(order.map((source) => ({ source, from: null })));
	},

	/** The order as runs - what the Layers pane produces when something is moved. */
	async setSegments(order: Segment[]): Promise<void> {
		recipe = await setStyleOrder(order);
	},

	async setLayer(layer: string, patch: LayerOverride): Promise<void> {
		if (graph) recipe = await setLayerOverride(graph.id, layer, patch);
	},

	/**
	 * The same, for a graph that is not the focused one.
	 *
	 * **The layer tree spans every source now**, so which recipe an edit lands in is a property of
	 * the row rather than of the pane. `setLayer` stays for the controls that genuinely act on the
	 * selection; this is for the ones that act on what was clicked.
	 */
	async setLayerFor(id: number, layer: string, patch: LayerOverride): Promise<void> {
		recipe = await setLayerOverride(id, layer, patch);
	},

	/** Switches one path of the layer tree on or off - the eye, at whatever depth it was pressed. */
	async setHidden(id: number, path: string, hidden: boolean): Promise<void> {
		recipe = await setLayerHidden(id, path, hidden);
	}
};
