/**
 * Turning what is built and what the recipe says into the stack the map draws
 * ([S6.5](../../../docs/scope-release-2.md)).
 *
 * `composeStyle` next door knows how to draw a list of sources. This is what decides *which* list,
 * and it is the half that had nowhere to be tested: it lived in a `$derived` inside `App.svelte`,
 * where a rule can be wrong for three releases without anything failing.
 *
 * **It has already happened once.** The map's style used to choose between a styled recipe and the
 * background map, and S6.2 gave nearly every source something to draw — so the background became
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
		layers: built.layers,
		mountedLayers: layers
	};
}

/**
 * The sources to draw, bottom first.
 *
 * Everything `order` names and is actually built, then everything else by name. The core's
 * `Recipe::draw_order` applies the same two rules for the same reasons — `order` is a preference,
 * not a register, so a graph it names but nobody built must not leave a hole, and one built but
 * unnamed must not be invisible.
 */
export function drawOrder(recipe: Recipe, built: Record<string, Preview>): string[] {
	const names = Object.keys(built);
	const order = recipe.order.filter((name) => names.includes(name));
	for (const name of [...names].sort()) if (!order.includes(name)) order.push(name);
	return order;
}

/** What the map should draw, and what each source contributed. */
export function stackFor(input: {
	recipe: Recipe | null;
	built: Record<string, Preview>;
	/** The node being looked at, when one is pinned. */
	pinned: Preview | null;
	serverUrl: string | null;
	background: StyleSpecification | null;
}): Composed {
	const { recipe, built, pinned, serverUrl, background } = input;
	if (!serverUrl) return { style: null, bases: [] };

	// No recipe yet — the background alone is still a map worth drawing.
	if (!recipe) return composeStyle([], '', background);

	// **Pinned means "look at this node alone."** The stack is what a project draws; a pin is a
	// question about one step of one graph, and stacking the rest under it would answer a different
	// one. The background stays: it is context, not content.
	if (pinned) return composeStyle([entryFor(pinned, recipe)], serverUrl, background);

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
 * draws, and a background map produces a style without drawing any of it — so asking the wrong
 * question hides the one thing being edited the moment a basemap is switched on.
 */
export function drawn(composed: Composed, name: string | null | undefined): boolean {
	if (!name) return false;
	return composed.bases.some((entry) => entry.name === name && entry.basis !== 'none');
}
