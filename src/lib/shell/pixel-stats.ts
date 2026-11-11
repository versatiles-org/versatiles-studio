/**
 * Figures read off a raster tile's histograms, for the tile dialog. Kept apart from the drawing so
 * they can be tested.
 */

/** What one channel's 256 counts add up to. */
export interface ChannelSummary {
	/** Pixels counted - every pixel that shows, since a fully transparent one is left out. */
	pixels: number;
	/** The lowest and highest value any pixel has, or `null` for a channel with no pixels. */
	min: number | null;
	max: number | null;
	mean: number | null;
	/** The shares at either end, from 0 to 1: where a channel has been clipped, if anywhere. */
	atZero: number;
	atTop: number;
}

export function summarise(counts: readonly number[]): ChannelSummary {
	const pixels = counts.reduce((sum, count) => sum + count, 0);
	if (pixels === 0) return { pixels, min: null, max: null, mean: null, atZero: 0, atTop: 0 };
	const min = counts.findIndex((count) => count > 0);
	const max = counts.length - 1 - [...counts].reverse().findIndex((count) => count > 0);
	const mean = counts.reduce((sum, count, value) => sum + count * value, 0) / pixels;
	return { pixels, min, max, mean, atZero: counts[0] / pixels, atTop: counts[counts.length - 1] / pixels };
}

/** The heights one step of a DEM's height histogram covers, from `min` to `max` in `bins` steps. */
export function step(min: number, max: number, bins: number, index: number): [number, number] {
	const width = (max - min) / bins;
	return [min + index * width, min + (index + 1) * width];
}

/** A share as the table writes it: "3%", "under 1%" rather than a "0%" that is not nothing, or "-". */
export function share(part: number): string {
	if (part === 0) return '-';
	const percent = part * 100;
	return percent < 1 ? 'under 1%' : `${Math.round(percent)}%`;
}
