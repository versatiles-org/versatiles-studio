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
import type {
	Appearance,
	DemEncoding,
	Hillshade,
	LayerOverride,
	RasterAdjust,
	SourceKind,
	SourceStyle
} from '../ipc/commands';
import { throughQueue } from './tile-queue';
import { renderableAs } from './tile-format';

/** The vector half of [`Appearance`], which is what a preset and a layer tree need. */
export type VectorAppearance = Extract<Appearance, { type: 'vector' }>;

/** A source's style, or the default appearance when it has never been styled. */
export function appearanceOf(source: SourceStyle | null | undefined): Appearance {
	return source?.appearance ?? { type: 'vector', preset: 'colorful', recolor: {}, overrides: {} };
}

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
 * Builds the style a vector appearance describes over the given sources.
 *
 * Returns `null` for a recipe with no builder — `derived` is S4.4's, and until that exists there is
 * nothing to render rather than something wrong to render.
 */
export function renderStyle(
	appearance: VectorAppearance,
	sources: StyleSource[],
	serverBaseUrl: string
): StyleSpecification | null {
	const build = BUILDERS[appearance.preset as keyof typeof BUILDERS];
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
		recolor: cleaned(appearance.recolor)
	}) as StyleSpecification;

	return {
		...style,
		layers: style.layers.map((layer) => applyOverride(layer, appearance.overrides[layer.id]))
	};
}

/**
 * Drops the fields a recipe left unset.
 *
 * The core omits them entirely, but a recipe that has been through the webview can carry explicit
 * `undefined`s — and `{ gamma: undefined }` is not the same to the builder as `{}` for any option
 * it tests for presence rather than for value.
 */
function cleaned(recolor: VectorAppearance['recolor']): Record<string, unknown> {
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
 * The paint an adjustment means, with everything untouched left out
 * ([S6.3](../../../docs/scope-release-2.md), D11).
 *
 * **Omitted, not defaulted.** A property set to its own default renders identically but exports a
 * style full of values nobody chose, and D8's output is meant to be a file someone can read.
 */
export function rasterPaint(adjust: RasterAdjust): Record<string, unknown> {
	const paint: Record<string, unknown> = {};

	if (adjust.hue != null) paint['raster-hue-rotate'] = adjust.hue;
	if (adjust.saturation != null) paint['raster-saturation'] = adjust.saturation;
	if (adjust.contrast != null) paint['raster-contrast'] = adjust.contrast;
	if (adjust.opacity != null) paint['raster-opacity'] = adjust.opacity;
	if (adjust.resampling != null) paint['raster-resampling'] = adjust.resampling;

	// **One control, two endpoints.** MapLibre remaps the input range onto `brightness-min` and
	// `-max`, so brightening means lifting the floor and darkening means lowering the ceiling.
	// Writing only the endpoint that moved keeps the other at its default rather than restating it.
	if (adjust.brightness != null && adjust.brightness !== 0) {
		const amount = Math.max(-1, Math.min(1, adjust.brightness));
		if (amount > 0) paint['raster-brightness-min'] = amount;
		else paint['raster-brightness-max'] = 1 + amount;
	}

	return paint;
}

/**
 * A style that draws one raster source, adjusted (S6.3, D11).
 *
 * No glyphs and no sprite: nothing here draws text or an icon, and naming assets a style never
 * reaches for would put two more requests on every map that shows a photograph.
 */
export function rasterStyle(
	adjust: RasterAdjust,
	sources: StyleSource[],
	_serverBaseUrl: string
): StyleSpecification | null {
	const source = sources[0];
	if (!source) return null;

	const paint = rasterPaint(adjust);
	return {
		version: 8,
		sources: { [source.name]: { type: 'raster', tiles: [throughQueue(source.tileUrl)] } },
		layers: [
			{
				id: `${source.name}:raster`,
				type: 'raster',
				source: source.name,
				...(Object.keys(paint).length > 0 ? { paint } : {})
			}
		]
	} as StyleSpecification;
}

/**
 * The MapLibre encoding a container's schema means, or `null` when there is none it can decode.
 *
 * **`dem/versatiles` deliberately returns `null`.** MapLibre knows `mapbox`, `terrarium` and a
 * `custom` unpacking defined by three channel factors and a shift — and nothing published says what
 * those are for VersaTiles' own encoding. Guessing would draw convincing relief of the wrong
 * mountains, which is worse than drawing none and saying why.
 */
export function demEncoding(tileSchema: string | null | undefined): DemEncoding | null {
	switch (tileSchema?.toLowerCase()) {
		case 'dem/mapbox':
			return 'mapbox';
		case 'dem/terrarium':
			return 'terrarium';
		default:
			return null;
	}
}

/**
 * The paint a hillshade means, with everything untouched left out (S6.6, D12).
 */
export function hillshadePaint(shade: Hillshade): Record<string, unknown> {
	const paint: Record<string, unknown> = {};
	if (shade.exaggeration != null) paint['hillshade-exaggeration'] = shade.exaggeration;
	if (shade.direction != null) paint['hillshade-illumination-direction'] = shade.direction;
	if (shade.altitude != null) paint['hillshade-illumination-altitude'] = shade.altitude;
	if (shade.shadow) paint['hillshade-shadow-color'] = shade.shadow;
	if (shade.highlight) paint['hillshade-highlight-color'] = shade.highlight;
	if (shade.accent) paint['hillshade-accent-color'] = shade.accent;
	return paint;
}

/**
 * A style that draws one elevation source as relief (S6.6, D12).
 *
 * Returns `null` when the encoding is unknown — the recipe may say, and otherwise the container's
 * schema does. Neither saying anything is the case that has to draw nothing: a `raster-dem` source
 * with the wrong encoding produces relief that looks right and is not.
 */
export function hillshadeStyle(
	shade: Hillshade,
	tileSchema: string | null | undefined,
	sources: StyleSource[]
): StyleSpecification | null {
	const source = sources[0];
	const encoding = shade.encoding ?? demEncoding(tileSchema);
	if (!source || !encoding) return null;

	const paint = hillshadePaint(shade);
	return {
		version: 8,
		sources: {
			[source.name]: { type: 'raster-dem', tiles: [throughQueue(source.tileUrl)], encoding }
		},
		layers: [
			{
				id: `${source.name}:hillshade`,
				type: 'hillshade',
				source: source.name,
				...(Object.keys(paint).length > 0 ? { paint } : {})
			}
		]
	} as StyleSpecification;
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
	/** Drawn as imagery, with whatever adjustment the recipe carries (S6.3). */
	| 'raster'
	/** Drawn as relief from elevation data (S6.6). */
	| 'hillshade'
	/** Nothing draws — an unknown DEM encoding, or a container with no layers to derive from. */
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
	appearance: Appearance,
	target: {
		kind: SourceKind;
		tileFormat: string;
		tileSchema?: string | null;
		layers: DerivableLayer[];
		mountedLayers: string[];
	},
	sources: StyleSource[],
	serverBaseUrl: string
): { style: StyleSpecification | null; basis: StyleBasis } {
	const { kind, tileFormat, tileSchema, layers, mountedLayers } = target;

	// **The format has the final say over the kind.** `kind` can be a guess, and it can be something
	// a person set by hand; neither makes MapLibre able to decode the bytes. A container whose format
	// could not be determined lands on `bin`, and pointing any source at those produces one decode
	// failure per tile and a blank map with nothing to say why — the bug `tile-format.ts` exists for.
	const renderable = renderableAs(tileFormat);
	if (renderable === null) return { style: null, basis: 'none' };

	if (kind === 'rasterImage' && renderable === 'raster') {
		const adjust = appearance.type === 'raster' ? appearance.adjust : {};
		return { style: rasterStyle(adjust, sources, serverBaseUrl), basis: 'raster' };
	}

	if (kind === 'rasterDem' && renderable === 'raster') {
		const shade = appearance.type === 'hillshade' ? appearance.shade : {};
		const style = hillshadeStyle(shade, tileSchema, sources);
		// `null` means no encoding anyone here can decode. The container layer `preview` already
		// added stays, which shows the encoded colours — wrong as a map, honest as a picture.
		return style ? { style, basis: 'hillshade' } : { style: null, basis: 'none' };
	}

	if (!isVectorKind(kind) || renderable !== 'vector') return { style: null, basis: 'none' };

	// A raster appearance on a vector source has nothing to say; derive rather than draw nothing.
	if (appearance.type !== 'vector') {
		const derived = deriveStyle(layers, sources, serverBaseUrl);
		return derived ? { style: derived, basis: 'derived' } : { style: null, basis: 'none' };
	}

	// Built from what the tiles have rather than from what a schema expects (S4.4).
	if (appearance.preset === 'derived') {
		const derived = deriveStyle(layers, sources, serverBaseUrl);
		return derived ? { style: derived, basis: 'derived' } : { style: null, basis: 'none' };
	}

	const rendered = renderStyle(appearance, sources, serverBaseUrl);
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

/** Whether a kind draws from vector tiles. Local to avoid a cycle with `source-kind`. */
function isVectorKind(kind: SourceKind): boolean {
	return kind === 'vectorShortbread' || kind === 'vectorOther';
}

/** One source in the stack, with everything needed to draw it. */
export interface StackEntry {
	/** The graph's name — its mount, and what the style calls the source. */
	name: string;
	tileUrl: string;
	appearance: Appearance;
	kind: SourceKind;
	tileFormat: string;
	/** What the container says its tiles hold, for reading a DEM's encoding (S6.6). */
	tileSchema?: string | null;
	layers: DerivableLayer[];
	mountedLayers: string[];
	/** Where the tiles are and which zooms they cover — see [`extentOf`]. */
	bbox?: [number, number, number, number] | null;
	minZoom?: number;
	maxZoom?: number;
}

/** What a source declares about where its tiles are, in MapLibre's spelling. */
type Extent = { bounds?: [number, number, number, number]; minzoom?: number; maxzoom?: number };

/**
 * Where a source's tiles are, for MapLibre to stop asking outside it.
 *
 * **Each field only if the container has one**, so a source Studio knows nothing about keeps
 * whatever its builder declared rather than being overwritten with a guess. `bbox` is already what
 * `fitToBounds` trusts, so this is not a new claim about the data — it is the same one, told to the
 * one component that was making its own up.
 */
function extentOf(entry: StackEntry): Extent {
	return {
		...(entry.bbox ? { bounds: entry.bbox } : {}),
		...(entry.minZoom === undefined ? {} : { minzoom: entry.minZoom }),
		...(entry.maxZoom === undefined ? {} : { maxzoom: entry.maxZoom })
	};
}

/** What a composed style drew, and from what. */
export interface Composed {
	style: StyleSpecification | null;
	/** One per entry, in the order given, so the pane can say why a source is not on the map. */
	bases: { name: string; basis: StyleBasis }[];
}

/**
 * One style over several sources, drawn bottom-first
 * ([S6.5](../../../docs/scope-release-2.md)).
 *
 * **This is what makes "a basemap under my data" a stack position rather than a feature.** Each
 * entry is styled by exactly the rules a single source already had — `styleFor` decides per entry —
 * and the results are concatenated in order. A source that draws nothing contributes nothing and
 * says so in `bases`, rather than taking the whole style down with it.
 *
 * `entries` is bottom-first: the first drawn is the one everything else covers.
 */
export function composeStyle(
	entries: StackEntry[],
	serverBaseUrl: string,
	/**
	 * A background map to sit under everything, already built.
	 *
	 * **Not a special case — the bottom of the same stack.** It is generated by the same
	 * `@versatiles/style` builders a preset uses, so its layer ids and its source key collide with a
	 * preset entry's exactly. Merging it here rather than choosing between it and the stack is what
	 * makes the collision handling below apply to it too; choosing was the old rule, and it stopped
	 * being reachable the moment S6.2 gave nearly every source something to draw.
	 */
	background?: StyleSpecification | null
): Composed {
	const bases: { name: string; basis: StyleBasis }[] = [];
	const sources: Record<string, unknown> = {};
	const layers: LayerSpecification[] = [];
	let glyphs: string | undefined;
	let sprite: StyleSpecification['sprite'];

	// **Ids are prefixed only when more than one source is drawn.** Two vector sources on the same
	// preset produce identical layer ids, and MapLibre keeps the first — so the upper source would
	// silently vanish. Prefixing unconditionally would instead rename every layer in the
	// single-source case, which is the case every exported `style.json` and every override written
	// before this was added already refers to.
	const drawn: { name: string; style: StyleSpecification; extent: Extent }[] = [];
	// The background is a whole-world basemap and declares its own extent, such as it is.
	if (background) drawn.push({ name: 'background', style: background, extent: {} });

	for (const entry of entries) {
		const { style, basis } = styleFor(
			entry.appearance,
			{
				kind: entry.kind,
				tileFormat: entry.tileFormat,
				tileSchema: entry.tileSchema,
				layers: entry.layers,
				mountedLayers: entry.mountedLayers
			},
			[{ name: entry.name, tileUrl: entry.tileUrl }],
			serverBaseUrl
		);
		bases.push({ name: entry.name, basis });
		if (style) drawn.push({ name: entry.name, style, extent: extentOf(entry) });
	}

	const prefix = drawn.length > 1;

	for (const { name, style, extent } of drawn) {
		glyphs ??= style.glyphs;
		sprite ??= style.sprite;

		// **The source key collides too, not just the layer ids.** `@versatiles/style`'s builders
		// name their source `versatiles-shortbread` whatever they were pointed at, so two preset
		// sources merge into one and the second silently replaces the first's tiles. Each built style
		// has exactly one source — it was built from one — so renaming it to the entry is safe, and
		// the layers that referred to it follow.
		const [built] = Object.keys(style.sources);
		const key = prefix ? name : built;
		// **With what the container says about itself, over what the builder assumed.** Studio's own
		// builders declare a source as a list of tile URLs and nothing else; `@versatiles/style`'s
		// declares `bounds` of the whole world and `maxzoom: 14`, which is true of Shortbread in
		// general and false of the extract in front of you. Either way MapLibre asks for tiles that
		// cannot exist — a Berlin extract answers three of four requests at z1 with a 404, and each
		// of those takes one of the tile queue's six slots ahead of a tile that does.
		sources[key] = { ...style.sources[built], ...extent };

		for (const layer of style.layers) {
			if (!prefix) {
				layers.push(layer);
				continue;
			}
			layers.push({
				...layer,
				id: `${name}/${layer.id}`,
				...('source' in layer ? { source: key } : {})
			} as LayerSpecification);
		}
	}

	if (drawn.length === 0) return { style: null, bases };

	return {
		style: {
			version: 8,
			...(glyphs ? { glyphs } : {}),
			...(sprite ? { sprite } : {}),
			sources,
			layers
		} as StyleSpecification,
		bases
	};
}
