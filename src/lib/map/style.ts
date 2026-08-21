/**
 * Turning a recipe into a MapLibre style (S4.2, [Q36]).
 *
 * The core stores what the style is made from; this is where it becomes one. `@versatiles/style` is
 * a JavaScript library, so the generator was always going to live on this side — [Q36] makes that
 * the design rather than an accident, by keeping the 125 kB it produces out of the core entirely.
 *
 * Here rather than in a directory of its own, beside `background.ts` and `default-style.ts`: this
 * is about the map, and `lib/styles` next door is the CSS design tokens.
 *
 * **Assets come from the embedded server, never from the network.** The builders default to
 * versatiles.org for glyphs and sprites; Studio has both bundled (Q9, S0.6), and G5 promises it
 * works offline. `background.ts` makes the same substitution for the same reason.
 *
 * [Q36]: ../../../docs/decisions.md
 */

import { colorful, eclipse, graybeard, neutrino, satellite, shadow } from '@versatiles/style';
import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';
import type { LayerOverride, Recipe } from '../ipc/commands';
import { throughQueue } from './tile-queue';

/** The six builders, by the name the core stores. */
const BUILDERS = { colorful, eclipse, graybeard, neutrino, satellite, shadow } as const;

/** One graph, as the style will name it. */
export interface StyleSource {
	/** The graph's name — its server mount, its `style.json` source and its `.vpl` file ([Q32]). */
	name: string;
	/** Where its tiles come from. */
	tileUrl: string;
}

/**
 * Builds the style a recipe describes over the given sources.
 *
 * Returns `null` for a recipe with no builder — `derived` is S4.4's, and until that exists there is
 * nothing to render rather than something wrong to render.
 */
export function renderStyle(recipe: Recipe, sources: StyleSource[], serverBaseUrl: string): StyleSpecification | null {
	const build = BUILDERS[recipe.preset as keyof typeof BUILDERS];
	if (!build) return null;

	// The builders are overloaded: they return a promise when asked for terrain or hillshade, which
	// have to be fetched, and a style directly otherwise. Nothing here asks for either, so this is
	// the synchronous overload — TypeScript cannot see that through the lookup in `BUILDERS`.
	const style = build({
		// The first source is what the preset's own layers draw from. A preset knows one schema and
		// one source; naming several is S4.4's problem, not this function's.
		tiles: sources.length > 0 ? [throughQueue(sources[0].tileUrl)] : [],
		glyphs: `${serverBaseUrl}/assets/glyphs/{fontstack}/{range}.pbf`,
		sprite: `${serverBaseUrl}/assets/sprites/basics/sprites`,
		recolor: cleaned(recipe.recolor)
	}) as StyleSpecification;

	return {
		...style,
		layers: style.layers.map((layer) => applyOverride(layer, recipe.overrides[layer.id]))
	};
}

/**
 * Drops the fields a recipe left unset.
 *
 * The core omits them entirely, but a recipe that has been through the webview can carry explicit
 * `undefined`s — and `{ gamma: undefined }` is not the same to the builder as `{}` for any option
 * it tests for presence rather than for value.
 */
function cleaned(recolor: Recipe['recolor']): Record<string, unknown> {
	return Object.fromEntries(Object.entries(recolor).filter(([, value]) => value !== undefined && value !== null));
}

/**
 * Applies one layer's patch, or returns the layer untouched.
 *
 * Paint is *merged* and filter is *replaced*, which is the difference between the two: a paint
 * override says "this property, not that one" and leaves the rest of the preset's work in place,
 * while half a filter expression is not a filter.
 */
function applyOverride(layer: LayerSpecification, patch: LayerOverride | undefined): LayerSpecification {
	if (!patch) return layer;

	const next = { ...layer } as LayerSpecification & {
		paint?: Record<string, unknown>;
		filter?: unknown;
		layout?: Record<string, unknown>;
		minzoom?: number;
		maxzoom?: number;
	};

	if (patch.paint) next.paint = { ...(next.paint ?? {}), ...(patch.paint as Record<string, unknown>) };
	if (patch.filter !== undefined && patch.filter !== null) next.filter = patch.filter;
	if (patch.minZoom !== undefined && patch.minZoom !== null) next.minzoom = patch.minZoom;
	if (patch.maxZoom !== undefined && patch.maxZoom !== null) next.maxzoom = patch.maxZoom;
	if (patch.visible !== undefined && patch.visible !== null) {
		// `visibility` is a layout property in MapLibre, not a top-level field — setting it anywhere
		// else is ignored silently, which looks exactly like a broken checkbox.
		next.layout = { ...(next.layout ?? {}), visibility: patch.visible ? 'visible' : 'none' };
	}

	return next as LayerSpecification;
}
