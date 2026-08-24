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
import { renderableAs } from './tile-format';

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

/**
 * Which route produced the style on the map ([S6.2](../../../docs/scope-release-2.md)).
 *
 * The pane says which, because "your preset is not what you are looking at" is not something to
 * leave someone to work out from the map.
 */
export type StyleBasis =
	/** The chosen preset draws these tiles. */
	| 'preset'
	/** `derived` was chosen, and it drew. */
	| 'derived'
	/** A preset was chosen, could not draw these tiles, and derived layers stood in for it. */
	| 'fallback'
	/** Nothing draws — raster tiles, or a container with no layers to derive from. */
	| 'none';

/**
 * The style to draw, and how it was arrived at ([S6.2](../../../docs/scope-release-2.md)).
 *
 * **A preset that draws nothing is not an answer.** The six are written against Shortbread's layer
 * names, so pointing one at a `from_csv` result matched no `source-layer` and the map fell back to a
 * bare background — the most common thing the pipeline pane produces, rendered as though the style
 * pane were broken. Deriving from the layers the probe actually found is the answer that was already
 * written and already tested; it was just not reachable unless someone picked it by hand.
 *
 * Raster still returns `none`: `deriveStyle` has no vector layers to work from, and inventing
 * something to draw would be worse than the honest background. S6.3 and S6.6 are what fill that in.
 */
export function styleFor(
	recipe: Recipe,
	tileFormat: string,
	layers: DerivableLayer[],
	sources: StyleSource[],
	serverBaseUrl: string,
	mountedLayers: string[]
): { style: StyleSpecification | null; basis: StyleBasis } {
	// **Nothing vector-shaped over tiles the map cannot read as vector.** A container whose format
	// could not be determined lands on `bin`, and a style pointing a vector source at those produces
	// one `createImageBitmap` failure per tile and a blank map with nothing to say why — the bug
	// `tile-format.ts` was written for. Refusing here also makes raster's `none` deliberate rather
	// than a side effect of there being no layers to derive from.
	if (renderableAs(tileFormat) !== 'vector') return { style: null, basis: 'none' };

	// Built from what the tiles have rather than from what a schema expects (S4.4).
	if (recipe.preset === 'derived') {
		const derived = deriveStyle(layers, sources, serverBaseUrl);
		return derived ? { style: derived, basis: 'derived' } : { style: null, basis: 'none' };
	}

	const rendered = renderStyle(recipe, sources, serverBaseUrl);
	if (rendered && drawsAnything(rendered, mountedLayers)) return { style: rendered, basis: 'preset' };

	const derived = deriveStyle(layers, sources, serverBaseUrl);
	return derived ? { style: derived, basis: 'fallback' } : { style: null, basis: 'none' };
}

/**
 * Whether a generated style would draw anything from the tiles it was pointed at.
 *
 * **The presets assume Shortbread**, a layer naming scheme most of the world's vector tiles do not
 * use. Point `colorful` at a container of `buildings` and `admin` and it renders its background and
 * nothing else — a blank map where the hairlines used to be, with no error to explain it.
 *
 * So the caller asks first, and keeps the hairlines when the answer is no. Deriving a style from the
 * layers a container actually has is [S4.4](../../../docs/scope-release-1.md); until then this is
 * the difference between "styled" and "silently empty".
 */
export function drawsAnything(style: StyleSpecification, available: string[]): boolean {
	if (available.length === 0) return false;
	const wanted = new Set(available);
	return style.layers.some((layer) => 'source-layer' in layer && wanted.has(layer['source-layer'] as string));
}

/** What a layer is made of, and what it is called — the whole input a derived style needs. */
export interface DerivableLayer {
	name: string;
	/** `point`, `line`, `polygon` or `unknown`, from the core's probe (S4.4). */
	geometry: string;
}

/**
 * A style built from the layers the tiles actually contain (S4.4, D2).
 *
 * **Not a good-looking map, and not trying to be.** The presets know what `water_polygons` means;
 * this knows nothing about any layer except its name and what it is made of. What it can promise is
 * that every layer is visible and told apart from its neighbours — which is what you need before
 * you can style anything, and what a Shortbread preset over a non-Shortbread container cannot give.
 *
 * Colours come from the layer's *name*, so they are stable across reloads and across two people
 * looking at the same container. They are deliberately not design tokens: a token is a decision
 * about Studio's own surfaces, and these are as many distinct hues as there happen to be layers.
 */
export function deriveStyle(
	layers: DerivableLayer[],
	sources: StyleSource[],
	serverBaseUrl: string
): StyleSpecification | null {
	const source = sources[0];
	if (!source || layers.length === 0) return null;

	// Polygons underneath, then lines, then points — the order things cover each other in. Without
	// it a layer of building footprints hides every road beneath it, which is exactly the map a
	// derived style is supposed to rescue you from.
	const order = { polygon: 0, line: 1, point: 2, unknown: 3 } as const;
	const sorted = [...layers].sort(
		(a, b) => (order[a.geometry as keyof typeof order] ?? 3) - (order[b.geometry as keyof typeof order] ?? 3)
	);

	return {
		version: 8,
		glyphs: `${serverBaseUrl}/assets/glyphs/{fontstack}/{range}.pbf`,
		sprite: `${serverBaseUrl}/assets/sprites/basics/sprites`,
		sources: { [source.name]: { type: 'vector', tiles: [throughQueue(source.tileUrl)] } },
		layers: sorted.flatMap((layer) => paint(layer, source.name))
	} as StyleSpecification;
}

/** One MapLibre layer for one source layer, of the kind its geometry can be drawn as. */
function paint(layer: DerivableLayer, source: string): LayerSpecification[] {
	const colour = hue(layer.name);
	const common = { id: `derived:${layer.name}`, source, 'source-layer': layer.name };

	if (layer.geometry === 'polygon') {
		return [
			{ ...common, type: 'fill', paint: { 'fill-color': colour, 'fill-opacity': 0.35 } },
			{
				...common,
				id: `${common.id}:edge`,
				type: 'line',
				paint: { 'line-color': colour, 'line-width': 0.8 }
			}
		] as LayerSpecification[];
	}
	if (layer.geometry === 'point') {
		return [
			{
				...common,
				type: 'circle',
				paint: { 'circle-color': colour, 'circle-radius': 2.5, 'circle-opacity': 0.85 }
			}
		] as LayerSpecification[];
	}
	// Lines, and anything whose geometry the probe could not name: a hairline shows a line as itself
	// and a polygon as its outline, so it is the guess that hides the least.
	return [{ ...common, type: 'line', paint: { 'line-color': colour, 'line-width': 1 } }] as LayerSpecification[];
}

/**
 * A colour for a layer name — the same one every time, and far from its neighbours'.
 *
 * The hash is spread around the wheel by the golden angle rather than used directly: consecutive
 * hashes land next to each other on the circle, which is how two adjacent layers end up two
 * indistinguishable greens apart.
 */
function hue(name: string): string {
	let hash = 0;
	for (const character of name) hash = (hash * 31 + character.codePointAt(0)!) % 360;
	return `hsl(${Math.round((hash * 137.508) % 360)}, 70%, 45%)`;
}
