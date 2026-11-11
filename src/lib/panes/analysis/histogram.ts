/**
 * The tile size histogram's arithmetic (#23), kept apart from its drawing so it can be tested.
 *
 * The buckets are the core's - `measure.rs`'s `CHART_STEPS`, two to the doubling - so a bucket's
 * bounds are worked out here rather than sent: bucket `i` holds the tiles from `2^(i/2)` bytes up to,
 * but not including, `2^((i+1)/2)`.
 */

import type { Histogram } from '../../ipc/commands';
import { count, kilobytes, megabytes } from '../../common/format';

/** Buckets per doubling. Must match `CHART_STEPS` in `measure.rs`. */
export const STEPS = 2;

/** One bar: a bucket of sizes, or the tiles of no bytes at all. */
export interface Bar {
	/** The bucket, or `null` for the empty tiles, which a log scale has nowhere to put. */
	bucket: number | null;
	/** The smallest and largest whole byte count the bar holds. */
	low: number;
	high: number;
	tiles: number;
}

/** The smallest size in bucket `i`, in bytes - fractional, as the scale is. */
export const lowerBound = (bucket: number): number => 2 ** (bucket / STEPS);

/** Every bar, in size order: the empty tiles first when there are any, then each bucket sent. */
export function bars(histogram: Histogram): Bar[] {
	const sized = histogram.counts.map((tiles, at) => {
		const bucket = histogram.first + at;
		// Whole bytes: the first size at or above the bound, up to the last one below the next.
		const low = Math.ceil(lowerBound(bucket));
		return { bucket, low, high: Math.max(low, Math.ceil(lowerBound(bucket + 1)) - 1), tiles };
	});
	return histogram.empty > 0 ? [{ bucket: null, low: 0, high: 0, tiles: histogram.empty }, ...sized] : sized;
}

/** A size as the chart writes it: bytes under a kilobyte, then the units the Analysis pane uses. */
export function size(bytes: number): string {
	if (bytes < 1000) return `${Math.round(bytes)} B`;
	if (bytes < 1e6) return kilobytes(bytes);
	return megabytes(bytes);
}

/** What a bar holds, in a sentence: "2,341 tiles from 32 to 45 kB". */
export function describe(bar: Bar): string {
	const tiles = `${count(bar.tiles)} ${bar.tiles === 1 ? 'tile' : 'tiles'}`;
	if (bar.bucket === null) return `${tiles} of no bytes`;
	if (bar.low === bar.high) return `${tiles} of ${size(bar.low)}`;
	// One unit for both ends when they share one, so "from 32 to 45 kB" rather than "32 kB to 45 kB".
	const from = size(bar.low);
	const to = size(bar.high);
	const unit = (text: string) => text.split(' ')[1];
	return unit(from) === unit(to) ? `${tiles} from ${from.split(' ')[0]} to ${to}` : `${tiles} from ${from} to ${to}`;
}

/** The sizes the axis names - round powers of ten - that fall inside `[low, high]`. */
export function ticks(low: number, high: number): number[] {
	return [10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8].filter((tick) => tick >= low && tick <= high);
}

/** The top of the count axis: the biggest bar rounded up to 1, 2 or 5 times a power of ten. */
export function ceiling(highest: number): number {
	if (highest <= 0) return 1;
	const power = 10 ** Math.floor(Math.log10(highest));
	return ([1, 2, 5, 10].map((step) => step * power).find((nice) => nice >= highest) ?? 10 * power) as number;
}

/** A count for the axis: in full under ten thousand, compact above ("12K"). */
export function compact(value: number): string {
	if (value < 10_000) return count(value);
	if (value < 1e6) return `${Math.round(value / 1e3)}K`;
	return `${Math.round(value / 1e5) / 10}M`;
}
