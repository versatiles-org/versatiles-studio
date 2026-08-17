/**
 * The optional background map, generated with `@versatiles/style`.
 *
 * Studio draws what a pipeline produces, which on its own floats over nothing — useful for judging
 * a filter, useless for judging whether a road is in the right place. A background gives the tiles
 * something to sit on.
 *
 * **Generated, not fetched.** `tiles.versatiles.org` hosts finished style JSONs, and using one would
 * have been fewer lines — but a hosted style also carries *its* sprite and glyph URLs, so every font
 * and icon would come over the network too. Building the style here lets the tiles come from
 * versatiles.org while the assets come from Studio's own embedded server, which already has them
 * (Q9). That is the difference between a background costing tiles and costing everything.
 *
 * **Off by default**, because G5 promises Studio works with no network once its assets are
 * installed. Choosing a background is the user asking for remote data, explicitly.
 *
 * Depending on `@versatiles/style` is not the thing [Q18](../../../docs/decisions.md) declined —
 * that was the *component* library. This is the style generator D1 and D8 already name as their
 * basis.
 */

import { colorful, eclipse, graybeard, neutrino, satellite, shadow } from '@versatiles/style';
import type { StyleSpecification } from 'maplibre-gl';

/** Where the background's tiles come from. Only this is remote. */
const TILES = 'https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}';

export type BackgroundId = 'none' | 'colorful' | 'neutrino' | 'graybeard' | 'shadow' | 'eclipse' | 'satellite';

export interface Background {
	id: BackgroundId;
	/** What it says in the menu. */
	label: string;
	/** Grouping, so light and dark options are not shuffled together. */
	group: 'off' | 'light' | 'dark' | 'imagery';
}

/**
 * The choices, in the order they are offered: off, then light to dark, then imagery.
 *
 * A subset of what the package builds — it also offers per-language and terrain variants, which are
 * a different decision from "what does the map sit on" and would make this a menu of thirty.
 */
export const BACKGROUNDS: Background[] = [
	{ id: 'none', label: 'No background', group: 'off' },
	{ id: 'colorful', label: 'Colorful', group: 'light' },
	{ id: 'neutrino', label: 'Neutrino — minimal', group: 'light' },
	{ id: 'graybeard', label: 'Graybeard — grey', group: 'light' },
	{ id: 'shadow', label: 'Shadow — grey', group: 'dark' },
	{ id: 'eclipse', label: 'Eclipse', group: 'dark' },
	{ id: 'satellite', label: 'Satellite', group: 'imagery' }
];

/** Assets come from Studio's own server, so only the tiles are fetched from the network. */
function assets(serverUrl: string) {
	return {
		glyphs: `${serverUrl}/assets/glyphs/{fontstack}/{range}.pbf`,
		sprite: [{ id: 'basics', url: `${serverUrl}/assets/sprites/basics/sprites` }]
	};
}

/**
 * Builds the background style, or `null` for none.
 *
 * `satellite` is async because the package resolves its raster TileJSON; the rest are synchronous.
 * Both are awaited here so callers have one shape to handle.
 */
export async function buildBackground(id: BackgroundId, serverUrl: string): Promise<StyleSpecification | null> {
	if (id === 'none') return null;

	const options = { ...assets(serverUrl), tiles: [TILES] };
	switch (id) {
		case 'satellite':
			// The satellite builder resolves its own raster source and overlays the vector one, so it
			// takes no `tiles` of its own.
			return (await satellite(assets(serverUrl))) as StyleSpecification;
		case 'colorful':
			return colorful(options) as StyleSpecification;
		case 'neutrino':
			return neutrino(options) as StyleSpecification;
		case 'graybeard':
			return graybeard(options) as StyleSpecification;
		case 'shadow':
			return shadow(options) as StyleSpecification;
		case 'eclipse':
			return eclipse(options) as StyleSpecification;
	}
}

/** Whether an id is one we know, so a stale persisted value cannot break the map. */
export function isBackgroundId(value: unknown): value is BackgroundId {
	return typeof value === 'string' && BACKGROUNDS.some((background) => background.id === value);
}
