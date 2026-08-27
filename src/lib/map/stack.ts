/**
 * Turning what is built and what the recipe says into the stack the map draws
 * ([S6.5](../../../docs/history.md)).
 *
 * `composeStyle` next door knows how to draw a list of sources. This is what decides *which* list,
 * and it is the half that had nowhere to be tested: it lived in a `$derived` inside `App.svelte`,
 * where a rule can be wrong for three releases without anything failing.
 *
 * **It has already happened once.** The map's style used to choose between a styled recipe and the
 * background map, and S6.2 gave nearly every source something to draw - so the background became
 * unreachable however it was set, and nothing said so. The functions below are pure for that reason:
 * a rule about what the map shows should be something a test can ask about.
 */

import type { StyleSpecification } from 'maplibre-gl';
import type { Preview, Recipe, SourceStyle } from '../ipc/commands';
import { sourceKind } from './source-kind';
import { composeStyle, type Composed, type StackEntry } from './style';

/**
 * What a source that has never been styled looks like.
 *
 * The same default the core creates on first touch. Duplicated deliberately rather than fetched:
 * the webview draws before it has asked the core anything, and a source with no entry yet must draw
 * as a preset rather than as nothing.
 */
export const UNSTYLED_SOURCE: SourceStyle = {
	kind: null,
	appearance: { type: 'vector', preset: 'colorful', recolor: {}, overrides: {} }
};

/** The vector layers a preview's tiles contain, for deciding what can draw them. */
export function layersOf(built: Preview): string[] {
	return ((built.info.tileJson?.vector_layers ?? []) as { id?: string }[])
		.map((layer) => layer.id)
		.filter((id): id is string => typeof id === 'string');
}

/**
 * The layers a derived style should draw: **every layer the source declares**, not the ones a probe
 * happened to see.
 *
 * `Preview.layers` is a report about one tile - `probe_layers` decodes the middle of the bounds at
 * the source's *lowest* zoom, which is the emptiest tile in the pyramid. A German basemap declaring
 * 34 layers has two at z0, so the derived style drew two hairlines and the layer tree listed two,
 * for a source with 34. The counts and byte sizes in that report are honest and are what the export
 * dialog shows; what is wrong is using it as the list of what exists.
 *
 * The TileJSON's `vector_layers` is that list, and it is what `add-source.ts` has always used for a
 * mounted container - so the two paths agreed about a container and disagreed about a pipeline
 * reading the same tiles.
 *
 * **Geometry still comes from the sample**, because `vector_layers` does not carry it. A layer the
 * probe did not see is drawn as `unknown`, which `deriveStyle` renders as a line - a hairline, which
 * is the right thing to draw for a layer nobody has looked at yet.
 */
export function drawableLayers(built: Preview): { name: string; geometry: string }[] {
	const declared = layersOf(built);
	if (declared.length === 0) {
		return built.layers.map(({ name, geometry }) => ({ name, geometry }));
	}
	const sampled = new Map(built.layers.map((layer) => [layer.name, layer.geometry]));
	return declared.map((name) => ({ name, geometry: sampled.get(name) ?? 'unknown' }));
}

/** One source's place in the stack, from what was built and how the recipe says to draw it. */
export function entryFor(built: Preview, recipe: Recipe): StackEntry {
	const style = recipe.sources[built.name] ?? UNSTYLED_SOURCE;
	const layers = layersOf(built);
	return {
		name: built.name,
		tileUrl: built.tileUrl,
		appearance: style.appearance,
		kind: sourceKind(built.info.tileFormat, built.info.tileSchema, layers, style.kind).kind,
		tileFormat: built.info.tileFormat,
		tileSchema: built.info.tileSchema,
		layers: drawableLayers(built),
		mountedLayers: layers,
		// What the container says about itself, passed through so the composed style can tell
		// MapLibre where to stop asking - see `extentOf`.
		bbox: built.info.bbox,
		minZoom: built.info.minZoom,
		maxZoom: built.info.maxZoom
	};
}

/**
 * The sources to draw, bottom first.
 *
 * Everything `order` names and is actually built, then everything else by name. The core's
 * `Recipe::draw_order` applies the same two rules for the same reasons - `order` is a preference,
 * not a register, so a graph it names but nobody built must not leave a hole, and one built but
 * unnamed must not be invisible.
 */
export function drawOrder(recipe: Recipe, built: Record<string, Preview>): string[] {
	return ordered(recipe, Object.keys(built));
}

/**
 * The same two rules over any set of names, bottom first.
 *
 * **The sources list draws itself from this too** ([Q50]). It lists every graph, built or not, and
 * its order *is* the draw order - so a graph that will not build keeps its place in the stack
 * rather than disappearing from the one control that could move it, which is what the style pane's
 * own copy of this list did.
 */
export function ordered(recipe: Recipe, names: string[]): string[] {
	// **Each source once, where it first draws.** `order` holds segments, so a source that is drawn
	// in two places names itself twice; this answers about sources - which mounts there are and in
	// what order they were introduced - and the composition below is what reads the runs themselves.
	const order: string[] = [];
	for (const segment of recipe.order) {
		if (names.includes(segment.source) && !order.includes(segment.source)) order.push(segment.source);
	}
	for (const name of [...names].sort()) if (!order.includes(name)) order.push(name);
	return order;
}

/**
 * What the map should draw, and what each source contributed.
 *
 * **Every graph that has tiles, and nothing else** ([Q49]). This used to have a second mode: a
 * pinned node replaced the whole stack with itself, so the map showed one step of one graph and
 * hid the rest of the project. The eyes say the same thing without a mode - a graph switched off
 * is not in `built` at all, and a graph with nodes switched off is in it as the pipeline that is
 * switched on.
 *
 * Losing that branch fixes something it took with it: `styleText` serialises what this returns, so
 * saving a project while a node was pinned wrote a `style.json` naming that one source.
 */
export function stackFor(input: {
	recipe: Recipe | null;
	built: Record<string, Preview>;
	serverUrl: string | null;
	background: StyleSpecification | null;
}): Composed {
	const { recipe, built, serverUrl, background } = input;
	if (!serverUrl) return { style: null, bases: [] };

	// No recipe yet - the background alone is still a map worth drawing.
	if (!recipe) return composeStyle([], '', background);

	return composeStyle(
		drawOrder(recipe, built).map((name) => entryFor(built[name], recipe)),
		serverUrl,
		background
	);
}

/**
 * Whether a named source's own tiles are being drawn by a style.
 *
 * **Not "is there a style at all".** The hairlines exist to show pipeline output that nothing else
 * draws, and a background map produces a style without drawing any of it - so asking the wrong
 * question hides the one thing being edited the moment a basemap is switched on.
 */
export function drawn(composed: Composed, name: string | null | undefined): boolean {
	if (!name) return false;
	return composed.bases.some((entry) => entry.name === name && entry.basis !== 'none');
}
