/**
 * The one place Studio's preset names meet `@versatiles/style`'s builders.
 *
 * **The names stored are v5's, and the library's are not any more.** Up to v5 each preset was its own
 * builder - `colorful()`, `graybeard()`, … - and the core stores those names, so every saved project
 * says one. v6 folded the five Shortbread builders into `osm({ theme })`, and renamed the recolour
 * fields while it was at it. Translating here keeps every recipe ever written readable, where renaming
 * the stored values would have meant a migration in the core for no change anyone could see.
 *
 * The theme for each follows the library's own migration table, "Migration from v5" in its
 * `API_DESIGN.md`.
 *
 * **A preset is a theme, and the tiles decide the builder.** Since v7 the library draws three vector
 * schemas - `osm()` for Shortbread, `omt()` for OpenMapTiles, `protomaps()` for the Protomaps Basemap -
 * with the same options and the same themes. So "Graybeard" over OpenMapTiles tiles is
 * `omt({ theme: 'gray' })`, and nobody has to pick a preset per schema.
 */

import { osm } from '@versatiles/style';
import type { RecolorOptions, TileSource } from '@versatiles/style';
import { omt } from '@versatiles/style/omt';
import { protomaps } from '@versatiles/style/protomaps';
import type { StyleSpecification } from 'maplibre-gl';
import type { Preset, Recolor, SourceKind } from '../ipc/commands';

/** A vector tile schema the builders can draw. */
export type Schema = 'shortbread' | 'openmaptiles' | 'protomaps';

/**
 * Each schema's builder, and what differs between them: where it is imported from, which `urls` key
 * takes the tiles, and how far its tiles go.
 */
const SCHEMAS = {
	shortbread: { builder: osm, name: 'osm', module: '@versatiles/style', tiles: 'osm', maxzoom: 14 },
	openmaptiles: { builder: omt, name: 'omt', module: '@versatiles/style/omt', tiles: 'omt', maxzoom: 14 },
	protomaps: {
		builder: protomaps,
		name: 'protomaps',
		module: '@versatiles/style/protomaps',
		tiles: 'protomaps',
		maxzoom: 15
	}
} as const;

/**
 * The schema a kind of source is drawn with.
 *
 * `vectorOther` is Shortbread's, because that is what a preset over unknown tiles has always tried:
 * when nothing matches, `styleFor` sees an empty map and derives a style from the layers instead.
 */
export function schemaOf(kind: SourceKind | null | undefined): Schema {
	if (kind === 'vectorOpenMapTiles') return 'openmaptiles';
	if (kind === 'vectorProtomaps') return 'protomaps';
	return 'shortbread';
}

/** The Shortbread presets, by the name the core stores, and the theme each one now is. */
export const THEMES = {
	colorful: 'colorful',
	eclipse: 'colorful-dark',
	graybeard: 'gray',
	// The library's "closest match": v5's neutrino has no exact v6 equivalent.
	neutrino: 'muted',
	shadow: 'gray-dark'
} as const;

/** A preset that has a builder behind it - every one but `derived`. */
export type BuiltPreset = keyof typeof THEMES;

export function isBuiltPreset(preset: Preset): preset is BuiltPreset {
	return preset in THEMES;
}

/**
 * The sprite sheet the builders' icons are named against.
 *
 * **Always the list form, never a bare URL.** The builders refer to icons as `base:icon-cafe`, and a
 * style whose `sprite` is a single URL has no sheet called `base` - every icon would go missing. The
 * composed style keeps whichever `sprite` it meets first, so a derived style has to say the same thing
 * as a preset, or a derived source under a preset one takes the icons down with it.
 */
export function spriteAt(url: string): { id: string; url: string }[] {
	return [{ id: 'base', url }];
}

/** Where Studio's embedded server has the glyphs and the sprite sheet ([Q9]). */
export function localAssets(serverBaseUrl: string) {
	return {
		glyphsPattern: `${serverBaseUrl}/assets/glyphs/{fontstack}/{range}.pbf`,
		sprite: spriteAt(`${serverBaseUrl}/assets/sprites/base`)
	};
}

/**
 * A stored recolouring in the shape the builders take now.
 *
 * Fields left unset stay absent rather than becoming `undefined`: the builders test some options for
 * presence, and a recipe that has been through the webview can carry explicit `undefined`s.
 */
export function recolorOptions(recolor: Recolor): RecolorOptions {
	const set = <T>(value: T | null | undefined): value is T => value !== undefined && value !== null;
	const out: RecolorOptions = {};
	if (set(recolor.invertBrightness)) out.invertBrightness = recolor.invertBrightness;
	if (set(recolor.rotate)) out.rotateHue = recolor.rotate;
	if (set(recolor.saturate)) out.saturate = recolor.saturate;
	if (set(recolor.gamma)) out.gamma = recolor.gamma;
	if (set(recolor.contrast)) out.contrast = recolor.contrast;
	if (set(recolor.brightness)) out.brightness = recolor.brightness;
	if (set(recolor.tint) || set(recolor.tintColor)) {
		out.tint = {
			...(set(recolor.tint) ? { amount: recolor.tint } : {}),
			...(set(recolor.tintColor) ? { color: recolor.tintColor } : {})
		};
	}
	if (set(recolor.blend) || set(recolor.blendColor)) {
		out.blend = {
			...(set(recolor.blend) ? { amount: recolor.blend } : {}),
			...(set(recolor.blendColor) ? { color: recolor.blendColor } : {})
		};
	}
	return out;
}

/** Where the builders' defaults are published - tiles, imagery, glyphs and sprites. */
export const PUBLIC_BASE = 'https://tiles.versatiles.org';

/**
 * What a builder needs to be told: where the vector tiles are, and where the assets are. Each one
 * omitted is the builder's own default under [`PUBLIC_BASE`] - except the tiles of `protomaps()`,
 * which has no default and throws without them.
 */
export interface BuildUrls {
	/** A tile URL template, or a TileJSON. */
	tiles?: TileSource;
	glyphsPattern?: string;
	sprite?: { id: string; url: string }[];
}

/** A builder call: which function, where it is imported from, and what it is passed. */
export interface BuildCall {
	name: string;
	module: string;
	options: Record<string, unknown>;
}

/**
 * The call a preset is built with over a schema - also what `style-code.ts` writes into the generated
 * code, so the code and the map cannot describe two different styles.
 *
 * Every preset is a theme of every schema's builder since v7, so there is always a call to make.
 * `satellite` used to be the exception - imagery with an `osm()` overlay, Shortbread only - and left
 * with [S11.1](../../../docs/history.md): it is a background, not a way to draw vector data.
 */
export function buildCall(
	preset: BuiltPreset,
	schema: Schema,
	urls: BuildUrls,
	recolor: RecolorOptions = {}
): BuildCall {
	const { tiles, ...assets } = urls;
	const recolored = Object.keys(recolor).length > 0 ? { recolor } : {};
	const target = SCHEMAS[schema];
	// **`base` always.** In a browser the builders resolve every default they fill in - the satellite
	// imagery, the glyphs and sprites a generated file leaves out - against the *page's* origin, which
	// in Studio is `tauri://localhost`: the imagery was a 404 and the satellite map black. Outside a
	// browser they use versatiles.org, so tests in Node never saw it. Naming the base makes both agree.
	const named = { base: PUBLIC_BASE, ...(tiles === undefined ? {} : { [target.tiles]: tiles }), ...assets };
	return { name: target.name, module: target.module, options: { theme: THEMES[preset], urls: named, ...recolored } };
}

/**
 * Vector tiles at the given URLs, with the extent the schema has: the whole world, from zoom 0 to the
 * schema's last - 14, or 15 for Protomaps.
 *
 * **A TileJSON rather than the bare template**, because given a template the builders declare no
 * extent at all, and a vector source without a `maxzoom` is one MapLibre asks for tiles beyond the last
 * zoom of instead of overzooming it - a map that goes blank past street level. v5 wrote these three
 * fields itself. `composeStyle` replaces them with the container's own where it has them.
 *
 * An empty list is a source with nothing in it, which is what a preset with no source to draw from
 * needs: left out, the builders fall back to versatiles.org's tiles.
 */
export function tileset(schema: Schema, tiles: string[]): TileSource {
	return {
		tilejson: '3.0.0',
		tiles,
		vector_layers: [],
		bounds: [-180, -85.0511287798066, 180, 85.0511287798066],
		minzoom: 0,
		maxzoom: SCHEMAS[schema].maxzoom
	};
}

/**
 * Builds a preset's style over a schema.
 *
 * **Without the slots.** The builders lay four invisible `slot-*` layers where a fill, a street, a
 * symbol and a label run begin, for an application to insert its own layers at. Studio inserts by
 * splitting a source into segments instead ([the layer stack](../../../docs/layers.md)), and a slot
 * sits exactly on the edge between two categories, so it would split each of them in the layer tree
 * as a row of its own that draws nothing.
 */
export function build(
	preset: BuiltPreset,
	urls: BuildUrls,
	recolor: RecolorOptions = {},
	schema: Schema = 'shortbread'
): StyleSpecification {
	const call = buildCall(preset, schema, urls, recolor);
	const builder = SCHEMAS[schema].builder as (options: object) => unknown;
	return withoutSlots(builder(call.options) as StyleSpecification);
}

/** A built style without its `slot-*` layers - see [`build`] for why Studio has no use for them. */
export function withoutSlots(style: StyleSpecification): StyleSpecification {
	return { ...style, layers: style.layers.filter((layer) => !layer.id.startsWith('slot-')) };
}
