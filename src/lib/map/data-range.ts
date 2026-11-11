/**
 * Whether the camera can see any of a source's tiles, and if not, why (#16).
 *
 * A map that shows nothing can mean the pipeline produced nothing, or that the camera is looking
 * where the data is not. From the map alone the two look the same, so this tells them apart:
 * below the lowest level with tiles MapLibre asks for none, outside the extent there are none to
 * ask for, and far above the highest level every tile on screen is one tile stretched.
 *
 * Pure, so the rules are tested without a map. `MapRange.svelte` feeds it the camera.
 */

/** West, south, east, north, in degrees. */
export type Bbox = [number, number, number, number];

/** What the source has: its zoom range and where its tiles are, from the container's pyramid. */
export interface Extent {
	minZoom: number;
	maxZoom: number;
	bbox: Bbox | null;
}

/** Why there is nothing of the source on screen, in a sentence, or `null` when there is. */
export interface Absence {
	reason: 'below' | 'above' | 'outside';
	message: string;
}

/**
 * How many levels past the deepest tile counts as nothing to see: 16 times enlarged.
 *
 * Overzooming is how vector tiles are meant to be used, and a z14 source looked at a level or two
 * deeper is the ordinary case, so saying something there would say it all the time. Four levels
 * down, one tile covers the whole window several times over, which is example 3 in #16: a flat
 * colour, or nothing that reads as data.
 */
export const ENLARGED = 4;

/**
 * What is wrong with this view of the source, if anything.
 *
 * `level` is the tile level MapLibre asks the source for at this camera - see `requestedZoom`, which
 * is not always the map's zoom. `view` is what the window shows.
 */
export function absence(level: number, view: Bbox, extent: Extent): Absence | null {
	const range = extent.minZoom === extent.maxZoom ? `z${extent.minZoom}` : `z${extent.minZoom}–z${extent.maxZoom}`;

	// The level first: below it there is nothing anywhere, so where the camera is does not matter yet.
	if (level < extent.minZoom) return { reason: 'below', message: `No tiles at this zoom. The data is at ${range}.` };
	if (extent.bbox && !overlaps(view, extent.bbox)) {
		return { reason: 'outside', message: 'The data is outside this view.' };
	}
	if (level - extent.maxZoom >= ENLARGED) {
		const times = 2 ** (level - extent.maxZoom);
		return { reason: 'above', message: `The data ends at z${extent.maxZoom}, so this is one tile enlarged ${times}×.` };
	}
	return null;
}

/**
 * Whether two boxes share any ground, across the antimeridian too.
 *
 * MapLibre's bounds keep going past ±180 when the world repeats, so a view of Fiji can run from 170
 * to 190 while the data says -180 to -178. Comparing the data a world to either side catches that.
 */
function overlaps(view: Bbox, data: Bbox): boolean {
	if (view[2] - view[0] >= 360) return view[1] <= data[3] && data[1] <= view[3];
	return [-360, 0, 360].some(
		(shift) => view[0] <= data[2] + shift && data[0] + shift <= view[2] && view[1] <= data[3] && data[1] <= view[3]
	);
}
