/**
 * A recipe as `@versatiles/style` code (S4.6, D8).
 *
 * **This is what the recipe is for.** [Q36] keeps a preset, its adjustments and the layers someone
 * changed, rather than the 125 kB style they render to - and the reason given there was that a
 * design storing only the output could emit `style.json` and never the code. This is that half.
 *
 * The output is meant to be read as much as run: someone taking a style out of Studio and into a
 * build wants to see which preset it started from and what was done to it, not a wall of layers.
 *
 * [Q36]: ../../../docs/decisions.md
 */

import { isExpression } from '@maplibre/maplibre-gl-style-spec';
import type { StyleSpecification } from 'maplibre-gl';
import type { Appearance } from '../ipc/commands';
import { SCHEME } from './tile-queue';

/**
 * Where an exported style says its tiles are.
 *
 * **Not where Studio's are.** The map reads them from `studio://127.0.0.1:<an ephemeral port>`,
 * which is a URL that stops existing when the window closes - writing it into a file someone is
 * taking away would be a style that works exactly once, on one machine, until it does not. A
 * placeholder is a thing to replace; a dead localhost URL is a thing to debug.
 */
export const TILE_URL_PLACEHOLDER = 'https://example.org/tiles/{z}/{x}/{y}';

/**
 * The same placeholder, named after the source it stands for.
 *
 * **Because a style carries several sources now.** Collapsing all of them onto one URL left the
 * reader of an exported `style.json` holding two identical addresses and nothing saying which was
 * the hillshade - a file that cannot be pointed at anything without opening Studio again to find
 * out. The source key is a graph name, which is lowercase ASCII, digits and `-` by construction, so
 * it needs no escaping to sit in a path.
 */
export const placeholderFor = (source: string): string => `https://example.org/tiles/${source}/{z}/{x}/{y}`;

/**
 * Where an exported style says its glyphs and sprites are.
 *
 * **The tiles are a placeholder and these are not**, because they are different questions. Nobody
 * else can host your tiles, so the URL has to be replaced; everybody's glyphs and sprites are the
 * same files, and these are the addresses `@versatiles/style` uses when nothing overrides them. An
 * exported style therefore draws as soon as its tiles are pointed somewhere real.
 *
 * Studio itself overrides both to the embedded server so the map works offline ([Q9]) - which is
 * exactly why they have to be put back here. A file carrying `http://127.0.0.1:<ephemeral port>`
 * renders as a map with no labels and no icons, on someone else's machine, with nothing to say why.
 */
const PUBLIC_ASSETS = 'https://tiles.versatiles.org/assets';

/** Where a bundle's own copies sit, relative to the `style.json` beside them (D8, S4.6). */
export const BUNDLED_GLYPHS = 'fonts/{fontstack}/{range}.pbf';
export const BUNDLED_SPRITE = 'sprites/basics/sprites';

/**
 * The style with every URL that only works inside Studio replaced.
 *
 * `assets` decides where the glyphs and sprites are said to be: `'public'` for a file someone will
 * host, `'bundled'` for one written into a bundle that carries its own copies.
 */
export function forExport(style: StyleSpecification, assets: 'public' | 'bundled' = 'public'): StyleSpecification {
	const copy = structuredClone(style) as StyleSpecification;
	for (const [name, source] of Object.entries(copy.sources ?? {})) {
		if (!('tiles' in source) || !Array.isArray(source.tiles)) continue;
		// **Only the sources Studio serves itself.** `throughQueue` puts every mount behind
		// `studio://`, so that scheme is exactly the set of URLs that stop existing when the window
		// closes. Anything else names a real host - the background map most obviously - and is
		// somebody's working URL; replacing it turned a style that draws into one that does not, and
		// said nothing about having done so.
		if (!source.tiles.some((url) => typeof url === 'string' && url.startsWith(`${SCHEME}://`))) continue;
		source.tiles = [placeholderFor(name)];
	}
	copy.glyphs = assets === 'bundled' ? BUNDLED_GLYPHS : `${PUBLIC_ASSETS}/glyphs/{fontstack}/{range}.pbf`;
	copy.sprite = assets === 'bundled' ? BUNDLED_SPRITE : `${PUBLIC_ASSETS}/sprites/basics/sprites`;
	return copy;
}

/**
 * Every font stack the style names, each once.
 *
 * What a bundle has to carry. Read from the rendered style rather than from the recipe, because a
 * preset decides its own fonts and the recipe only says which preset.
 */
export function fontsUsed(style: StyleSpecification): string[] {
	const fonts = new Set<string>();
	for (const layer of style.layers ?? []) {
		// Narrowed by hand: `layout` is a union across nine layer types and only `symbol`'s member
		// has `text-font`, which TypeScript will not index across the union even after the check.
		if (layer.type !== 'symbol') continue;
		const stack = layer.layout?.['text-font'];
		// **A literal stack and an expression are both arrays**, and `['case', …]` would otherwise
		// contribute a font called "case". The style spec's own `isExpression` is what tells them
		// apart; reimplementing it would mean keeping a list of every operator.
		//
		// An expression can name a font this cannot see, and those are left out rather than guessed
		// at: a bundle missing one falls back, and a bundle carrying every font installed would be
		// tens of megabytes.
		if (!Array.isArray(stack) || isExpression(stack)) continue;
		for (const name of stack) if (typeof name === 'string') fonts.add(name);
	}
	return [...fonts].sort();
}

/** A preset with no builder behind it cannot be written as a builder call. */
export function canGenerateCode(appearance: Appearance): boolean {
	// Raster and hillshade have no `@versatiles/style` builder at all, so there is no call to write
	// - `style.json` is the honest form for those (S6.4).
	return appearance.type === 'vector' && appearance.preset !== 'derived';
}

/**
 * The code for a recipe, or `null` when there is none to write.
 *
 * `derived` has no `@versatiles/style` builder - it is assembled from whatever layers the tiles
 * turned out to have (S4.4), so there is nothing to name in an import. Those export as `style.json`,
 * which is the honest form for a style that has no shorter description than itself.
 */
export function styleCode(appearance: Appearance, present?: string[]): string | null {
	if (!canGenerateCode(appearance) || appearance.type !== 'vector') return null;

	const options: string[] = [`\ttiles: ['${TILE_URL_PLACEHOLDER}']`];
	const recolor = Object.entries(appearance.recolor).filter(([, value]) => value !== undefined && value !== null);
	if (recolor.length > 0) {
		options.push(
			`\trecolor: {\n${recolor.map(([key, value]) => `\t\t${key}: ${JSON.stringify(value)}`).join(',\n')}\n\t}`
		);
	}

	const lines = [
		'// Generated by VersaTiles Studio. Point `tiles` at where yours are published.',
		`import { ${appearance.preset} } from '@versatiles/style';`,
		'',
		`const style = ${appearance.preset}({`,
		options.join(',\n'),
		'});'
	];

	// **Only the overrides the generated style can apply** ([S6.7](../../../docs/history.md)).
	// The six presets share a namespace and a smaller one is a subset of a larger, so an override
	// made under `colorful` sits inert under `neutrino` and comes back on the way over - which is
	// why the recipe keeps it. Emitting it into a `neutrino` file is different: the loop would set a
	// property on a layer that file does not contain, which is dead code someone has to work out.
	const overrides = Object.entries(appearance.overrides).filter(
		([id]) => present === undefined || present.includes(id)
	);
	if (overrides.length > 0) {
		// Applied as a loop over the built style rather than folded into the call: these are changes
		// to *layers*, and the builder takes no argument for them. Written out so the file runs
		// as-is, which is the difference between code and a description of code.
		lines.push(
			'',
			'// Layer changes made in Studio.',
			`const overrides: Record<string, { visible?: boolean; minZoom?: number; maxZoom?: number; paint?: object }> = ${JSON.stringify(
				Object.fromEntries(overrides.map(([id, patch]) => [id, clean(patch)])),
				null,
				'\t'
			)};`,
			'',
			'for (const layer of style.layers) {',
			'\tconst patch = overrides[layer.id];',
			'\tif (!patch) continue;',
			"\tif (patch.visible === false) layer.layout = { ...layer.layout, visibility: 'none' };",
			'\tif (patch.minZoom !== undefined) layer.minzoom = patch.minZoom;',
			'\tif (patch.maxZoom !== undefined) layer.maxzoom = patch.maxZoom;',
			'\tif (patch.paint) layer.paint = { ...layer.paint, ...patch.paint };',
			'}'
		);
	}

	lines.push('', 'export default style;', '');
	return lines.join('\n');
}

/** Drops the keys a patch left unset, so the emitted object says only what was changed. */
function clean(patch: object): object {
	return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined && value !== null));
}
