/**
 * The one place Studio meets `@versatiles/style`'s builders.
 *
 * **The themes are the library's, by name** ([S11.3](../../../docs/history.md)). Up to v5 each
 * preset was its own builder and Studio stored those five names, translating them to v7's themes
 * through a table here. The library has twenty-four themes now and publishes the list on each builder
 * as `palettes`, so the recipe stores the palette name as the library spells it, this module asks the
 * builder what exists, and a theme added upstream appears in Studio without a change here.
 *
 * **A theme is a theme, and the tiles decide the builder.** Since v7 the library draws three vector
 * schemas - `osm()` for Shortbread, `omt()` for OpenMapTiles, `protomaps()` for the Protomaps Basemap -
 * with the same options and the same themes. So `gray` over OpenMapTiles tiles is
 * `omt({ theme: 'gray' })`, and nobody has to pick a theme per schema.
 */

import { isDarkPalette, osm } from '@versatiles/style';
import type { Palette, RecolorOptions, TileSource } from '@versatiles/style';
import { omt } from '@versatiles/style/omt';
import { protomaps } from '@versatiles/style/protomaps';
import type { StyleSpecification } from 'maplibre-gl';
import type { Recolor, SourceKind } from '../ipc/commands';

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

/** The theme a source draws with when the recipe names none, or names one this build does not know. */
export const DEFAULT_THEME: Palette = 'colorful';

/**
 * The library's own palettes: each a light theme with a dark partner named `<palette>-dark`.
 *
 * **A claim about somebody else's package**, so `builders.test.ts` checks every one of these and its
 * partner is in the builder's list. Everything else in that list is a lookalike (see [`RESEMBLES`]).
 */
export const BASE_PALETTES = ['colorful', 'natural', 'muted', 'gray', 'toner'] as const;

/**
 * What each lookalike theme resembles, in the words the library's README uses.
 *
 * The library names the lookalikes and says what they are after in prose; this is that prose as data,
 * so the dropdown can say "Positrino · after Positron" rather than a name nobody can place. Checked
 * against the builder's list the same way `BASE_PALETTES` is: a lookalike with no entry here is a
 * test failure, not a blank label.
 */
export const RESEMBLES: Record<string, string> = {
	positrino: 'Positron, Dark Matter',
	protocol: 'Protomaps Light, Dark',
	protostar: 'Protomaps White, Black',
	protozoa: 'Protomaps Grayscale',
	fnord: 'Fiord Color',
	classic: 'OpenStreetMap Carto',
	googol: 'Google Maps',
	freedom: 'OSM Liberty',
	macbob: 'Mapbox Streets',
	mactaylor: 'MapTiler Streets',
	bingo: 'Bing Maps'
};

/** One theme as the dropdown lists it. */
export interface ThemeChoice {
	id: Palette;
	label: string;
	dark: boolean;
	/** What a lookalike is after; `null` for the library's own palettes. */
	resembles: string | null;
}

/** The light palette a theme name belongs to: `gray-dark` is `gray`'s, `fnord` is its own. */
export const familyOf = (theme: string): string => theme.replace(/-dark$/, '');

/** `colorful-dark` reads as "Colorful, dark"; `positrino` as "Positrino". */
function labelOf(theme: Palette): string {
	const family = familyOf(theme);
	const name = family.charAt(0).toUpperCase() + family.slice(1);
	return theme.endsWith('-dark') ? `${name}, dark` : name;
}

const isOwnPalette = (theme: string): boolean => (BASE_PALETTES as readonly string[]).includes(familyOf(theme));

/**
 * The themes the builder for a schema offers, as two groups: the library's own palettes, light and
 * dark in turn, and then the lookalikes.
 *
 * **Asked of the builder, not written down.** All three builders answer alike today; asking each one
 * is what keeps that true tomorrow, when one of them might not.
 */
export function themesFor(schema: Schema): { palettes: ThemeChoice[]; lookalikes: ThemeChoice[] } {
	const all = SCHEMAS[schema].builder.palettes;
	const choice = (id: Palette): ThemeChoice => ({
		id,
		label: labelOf(id),
		dark: isDarkPalette(id),
		resembles: isOwnPalette(id) ? null : (RESEMBLES[familyOf(id)] ?? familyOf(id))
	});
	return {
		palettes: all.filter((id) => isOwnPalette(id)).map(choice),
		lookalikes: all.filter((id) => !isOwnPalette(id)).map(choice)
	};
}

/** Whether a builder for this schema knows a theme by this name. */
export function isTheme(schema: Schema, name: string): name is Palette {
	return (SCHEMAS[schema].builder.palettes as readonly string[]).includes(name);
}

/**
 * A stored theme name as the builder will take it: itself when the builder knows it, else the default.
 *
 * A recipe written by hand, or by a build that had a theme this one does not, must still draw - and
 * drawing the default is a better answer than drawing nothing, as long as the pane says which.
 */
export function themeOrDefault(schema: Schema, name: string): Palette {
	return isTheme(schema, name) ? name : DEFAULT_THEME;
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
 * The call a theme is built with over a schema - also what `style-code.ts` writes into the generated
 * code, so the code and the map cannot describe two different styles.
 *
 * Every theme belongs to every schema's builder since v7, so there is always a call to make.
 * `satellite` used to be the exception - imagery with an `osm()` overlay, Shortbread only - and left
 * with [S11.1](../../../docs/history.md): it is a background, not a way to draw vector data.
 */
export function buildCall(theme: Palette, schema: Schema, urls: BuildUrls, recolor: RecolorOptions = {}): BuildCall {
	const { tiles, ...assets } = urls;
	const recolored = Object.keys(recolor).length > 0 ? { recolor } : {};
	const target = SCHEMAS[schema];
	// **`base` always.** In a browser the builders resolve every default they fill in - the satellite
	// imagery, the glyphs and sprites a generated file leaves out - against the *page's* origin, which
	// in Studio is `tauri://localhost`: the imagery was a 404 and the satellite map black. Outside a
	// browser they use versatiles.org, so tests in Node never saw it. Naming the base makes both agree.
	const named = { base: PUBLIC_BASE, ...(tiles === undefined ? {} : { [target.tiles]: tiles }), ...assets };
	return { name: target.name, module: target.module, options: { theme, urls: named, ...recolored } };
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
 * Builds a theme's style over a schema.
 *
 * **Without the slots.** The builders lay four invisible `slot-*` layers where a fill, a street, a
 * symbol and a label run begin, for an application to insert its own layers at. Studio inserts by
 * splitting a source into segments instead ([the layer stack](../../../docs/layers.md)), and a slot
 * sits exactly on the edge between two categories, so it would split each of them in the layer tree
 * as a row of its own that draws nothing.
 */
export function build(
	theme: Palette,
	urls: BuildUrls,
	recolor: RecolorOptions = {},
	schema: Schema = 'shortbread'
): StyleSpecification {
	const call = buildCall(theme, schema, urls, recolor);
	const builder = SCHEMAS[schema].builder as (options: object) => unknown;
	return withoutSlots(builder(call.options) as StyleSpecification);
}

/** A built style without its `slot-*` layers - see [`build`] for why Studio has no use for them. */
export function withoutSlots(style: StyleSpecification): StyleSpecification {
	return { ...style, layers: style.layers.filter((layer) => !layer.id.startsWith('slot-')) };
}
