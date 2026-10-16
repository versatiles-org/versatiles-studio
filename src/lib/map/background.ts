/**
 * The optional background map, generated with `@versatiles/style`.
 *
 * Studio draws what a pipeline produces, which on its own floats over nothing - useful for judging
 * a filter, useless for judging whether a road is in the right place. A background gives the tiles
 * something to sit on.
 *
 * **Generated, not fetched.** `tiles.versatiles.org` hosts finished style JSONs, and using one would
 * have been fewer lines - but a hosted style also carries *its* sprite and glyph URLs, so every font
 * and icon would come over the network too. Building the style here lets the tiles come from
 * versatiles.org while the assets come from Studio's own embedded server, which already has them
 * (Q9). That is the difference between a background costing tiles and costing everything.
 *
 * **Off by default**, because G5 promises Studio works with no network once its assets are
 * installed. Choosing a background is the user asking for remote data, explicitly.
 *
 * Depending on `@versatiles/style` is not the thing [Q18](../../../docs/decisions.md) declined -
 * that was the *component* library. This is the style generator D1 and D8 already name as their
 * basis.
 */

import type { StyleSpecification } from 'maplibre-gl';
import { osm, satellite, type Palette } from '@versatiles/style';
import { IMAGERY, localAssets, PUBLIC_BASE, tileset, withoutSlots } from './builders';

/** Where the background's tiles come from. Only this is remote. */
const TILES = `${PUBLIC_BASE}/tiles/osm/{z}/{x}/{y}`;

export type BackgroundId =
	'none' | 'positrino' | 'positrino-dark' | 'colorful' | 'muted' | 'colorful-dark' | 'satellite' | 'satellite-plain';

export interface Background {
	id: BackgroundId;
	/** What it says in the menu. */
	label: string;
	/** Grouping by purpose, so the quiet ones and the full maps are not shuffled together. */
	group: 'off' | 'data' | 'context' | 'imagery';
}

/**
 * The choices, grouped by what a background is *for*.
 *
 * **Quiet ones first.** A background is what data sits on, so the default answer is one that stays
 * out of its way - `positrino`, the library's Positron and Dark Matter, which are what data maps use
 * for exactly that reason. The full maps are for the other question, whether the data lines up with
 * the streets. A curated eight out of the library's twenty-four palettes: the rest are lookalikes of
 * other maps (`classic`, `googol`, …), near-duplicates (`natural`), nearly white (`protostar`), or busy
 * under data (`toner`'s yellow roads). Adding one is a line here.
 */
export const BACKGROUNDS: Background[] = [
	{ id: 'none', label: 'No background', group: 'off' },
	{ id: 'positrino', label: 'Light', group: 'data' },
	{ id: 'positrino-dark', label: 'Dark', group: 'data' },
	{ id: 'colorful', label: 'Colorful', group: 'context' },
	{ id: 'muted', label: 'Muted', group: 'context' },
	{ id: 'colorful-dark', label: 'Colorful dark', group: 'context' },
	{ id: 'satellite', label: 'Satellite', group: 'imagery' },
	{ id: 'satellite-plain', label: 'Satellite, imagery only', group: 'imagery' }
];

/**
 * Ids an earlier build stored, and what each became.
 *
 * They were v5's style names, kept as ids after v6 folded them into themes. The mapping is by
 * character rather than by name: `graybeard` drew a quiet grey map, which `positrino` now does
 * better than `gray`, its literal successor, whose water and parks all but vanish.
 */
const RENAMED: Record<string, BackgroundId> = {
	neutrino: 'muted',
	graybeard: 'positrino',
	shadow: 'positrino-dark',
	eclipse: 'colorful-dark'
};

/**
 * The background a stored value means, or `none` for one this build does not know.
 *
 * An old layout must not be able to open a window onto a background this version cannot build -
 * and one from before the renaming must not lose its background either.
 */
export function backgroundOf(value: unknown): BackgroundId {
	if (typeof value !== 'string') return 'none';
	const id = RENAMED[value] ?? value;
	return BACKGROUNDS.some((background) => background.id === id) ? (id as BackgroundId) : 'none';
}

/**
 * Builds the background style, or `null` for none.
 *
 * Assets come from Studio's own server, so only the tiles are fetched from the network.
 *
 * `labels` is the menu's switch: a background's names are what collide with the data's own, and
 * switching them off is the same answer for every background, so it is one setting rather than a
 * second copy of each.
 *
 * Async although every builder is synchronous now - v5's `satellite` resolved its raster TileJSON
 * first - so that callers keep the one shape they already handle.
 */
export async function buildBackground(
	id: BackgroundId,
	serverUrl: string,
	labels = true
): Promise<StyleSpecification | null> {
	if (id === 'none') return null;
	const urls = { base: PUBLIC_BASE, osm: tileset('shortbread', [TILES]), ...localAssets(serverUrl) };
	const layers = labels ? {} : { layers: { labels: false } };

	if (id === 'satellite' || id === 'satellite-plain') {
		const osmOverlay = id === 'satellite-plain' ? false : labels ? true : layers;
		return withoutSlots(satellite({ urls: { ...urls, satellite: IMAGERY }, osmOverlay }) as StyleSpecification);
	}
	return withoutSlots(osm({ theme: id as Palette, urls, ...layers }) as StyleSpecification);
}

/** Whether a background draws labels the switch can turn off. */
export const hasLabels = (id: BackgroundId): boolean => id !== 'none' && id !== 'satellite-plain';

/** The three colours a background is recognised by in its menu: the land, the water, a main road. */
export interface Swatch {
	land: string;
	water: string;
	road: string;
}

/**
 * What a background looks like, small - or `null` for none.
 *
 * **From the palette itself**, so a theme retuned upstream is a swatch retuned here. Imagery has no
 * palette; its three are tokens (`--swatch-imagery-*`), so they are CSS values rather than colours.
 */
export function swatchOf(id: BackgroundId): Swatch | null {
	if (id === 'none') return null;
	if (id === 'satellite' || id === 'satellite-plain') {
		return {
			land: 'var(--swatch-imagery-land)',
			water: 'var(--swatch-imagery-water)',
			road: 'var(--swatch-imagery-road)'
		};
	}
	const colors = osm.colors(id);
	return { land: colors.land, water: colors.water, road: colors.roadMotorway };
}
