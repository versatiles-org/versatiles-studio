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
 */

import { osm, satellite } from '@versatiles/style';
import type { RecolorOptions, TileSource } from '@versatiles/style';
import type { StyleSpecification } from 'maplibre-gl';
import type { Preset, Recolor } from '../ipc/commands';

/** The Shortbread presets, by the name the core stores, and the `osm()` theme each one now is. */
export const THEMES = {
	colorful: 'colorful',
	eclipse: 'colorful-dark',
	graybeard: 'gray',
	// The library's "closest match": v5's neutrino has no exact v6 equivalent.
	neutrino: 'muted',
	shadow: 'gray-dark'
} as const;

/** A preset that has a builder behind it - every one but `derived`. */
export type BuiltPreset = keyof typeof THEMES | 'satellite';

export function isBuiltPreset(preset: Preset): preset is BuiltPreset {
	return preset === 'satellite' || preset in THEMES;
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

/**
 * What a builder needs to be told: where the vector tiles are, and where the assets are. Each one
 * omitted is the builder's own default, on versatiles.org.
 */
export interface BuildUrls {
	/**
	 * A tile URL template, or a TileJSON.
	 */
	osm?: TileSource;
	glyphsPattern?: string;
	sprite?: { id: string; url: string }[];
}

/**
 * The options a preset is built with - also what `style-code.ts` writes into the generated call, so
 * the code and the map cannot describe two different styles.
 *
 * `satellite` draws the vector tiles as an overlay on imagery, so the recolouring applies to the
 * overlay; the imagery has its own raster controls, which Studio does not offer for this preset.
 */
export function buildOptions(preset: BuiltPreset, urls: BuildUrls, recolor: RecolorOptions) {
	const recolored = Object.keys(recolor).length > 0 ? { recolor } : {};
	if (preset === 'satellite') {
		return { urls, ...(Object.keys(recolored).length > 0 ? { osmOverlay: recolored } : {}) };
	}
	return { theme: THEMES[preset], urls, ...recolored };
}

/**
 * Shortbread tiles at the given URLs, with the extent Shortbread has: the whole world, zoom 0 to 14.
 *
 * **A TileJSON rather than the bare template**, because given a template the builders declare no
 * extent at all, and a vector source without a `maxzoom` is one MapLibre asks for z15 and beyond
 * instead of overzooming z14 - a map that goes blank past street level. v5 wrote these three fields
 * itself. `composeStyle` replaces them with the container's own where it has them.
 *
 * An empty list is a source with nothing in it, which is what a preset with no source to draw from
 * needs: left out, the builders fall back to versatiles.org's tiles.
 */
export function shortbread(tiles: string[]): TileSource {
	return {
		tilejson: '3.0.0',
		tiles,
		vector_layers: [],
		bounds: [-180, -85.0511287798066, 180, 85.0511287798066],
		minzoom: 0,
		maxzoom: 14
	};
}

/**
 * Builds a preset's style.
 *
 * **Without the slots.** The builders lay four invisible `slot-*` layers where a fill, a street, a
 * symbol and a label run begin, for an application to insert its own layers at. Studio inserts by
 * splitting a source into segments instead ([the layer stack](../../../docs/layers.md)), and a slot
 * sits exactly on the edge between two categories, so it would split each of them in the layer tree
 * as a row of its own that draws nothing.
 */
export function build(preset: BuiltPreset, urls: BuildUrls, recolor: RecolorOptions = {}): StyleSpecification {
	const options = buildOptions(preset, urls, recolor);
	const style = (preset === 'satellite' ? satellite(options) : osm(options)) as StyleSpecification;
	return { ...style, layers: style.layers.filter((layer) => !layer.id.startsWith('slot-')) };
}
