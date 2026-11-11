import { describe as group, expect, it } from 'vitest';
import { bars, ceiling, compact, describe, lowerBound, size, ticks } from './histogram';

group('the buckets (#23)', () => {
	// Bucket 19 runs from 2^9.5 to 2^10: 725 to 1,023 whole bytes. 1,024 starts bucket 20.
	it('names the whole bytes each bucket holds', () => {
		const [first, second] = bars({ empty: 0, first: 19, counts: [3, 1] });
		expect(first).toEqual({ bucket: 19, low: 725, high: 1023, tiles: 3 });
		expect(second).toEqual({ bucket: 20, low: 1024, high: 1448, tiles: 1 });
	});

	it('puts the empty tiles first, apart from the sizes', () => {
		expect(bars({ empty: 4, first: 20, counts: [1] }).map((bar) => bar.bucket)).toEqual([null, 20]);
		expect(bars({ empty: 0, first: 20, counts: [1] }).map((bar) => bar.bucket)).toEqual([20]);
	});

	// The smallest buckets are narrower than a byte: bucket 0 is 1 to 1.41 bytes, so one size.
	it('never names a range that runs backwards', () => {
		for (const bar of bars({ empty: 0, first: 0, counts: [1, 1, 1, 1, 1, 1] })) {
			expect(bar.high, `bucket ${bar.bucket}`).toBeGreaterThanOrEqual(bar.low);
		}
	});

	it('keeps every tile it is given', () => {
		const histogram = { empty: 7, first: 22, counts: [5, 0, 12, 3] };
		expect(bars(histogram).reduce((sum, bar) => sum + bar.tiles, 0)).toBe(27);
	});

	it('agrees with the core on where a bucket starts', () => {
		expect(lowerBound(20)).toBe(1024);
		expect(lowerBound(21)).toBeCloseTo(1448.15, 2);
	});
});

group('what a bar says', () => {
	it('says how many tiles, and between which sizes', () => {
		expect(describe({ bucket: 30, low: 32_769, high: 46_340, tiles: 2341 })).toBe('2,341 tiles from 33 to 46 kB');
	});

	it('gives each end its unit when they differ', () => {
		expect(describe({ bucket: 19, low: 725, high: 1023, tiles: 1 })).toBe('1 tile from 725 B to 1.0 kB');
	});

	it('names one size once, and the empty tiles as such', () => {
		expect(describe({ bucket: 0, low: 1, high: 1, tiles: 2 })).toBe('2 tiles of 1 B');
		expect(describe({ bucket: null, low: 0, high: 0, tiles: 12 })).toBe('12 tiles of no bytes');
	});

	it('writes sizes in the units the pane uses', () => {
		expect(size(512)).toBe('512 B');
		expect(size(4_500)).toBe('4.5 kB');
		expect(size(2_400_000)).toBe('2.4 MB');
	});
});

group('the axes', () => {
	it('ticks the powers of ten inside the range', () => {
		expect(ticks(700, 2_000_000)).toEqual([1e3, 1e4, 1e5, 1e6]);
		expect(ticks(2000, 3000)).toEqual([]);
	});

	it('rounds the count axis up to a clean number', () => {
		expect([ceiling(0), ceiling(1), ceiling(7), ceiling(13), ceiling(4100), ceiling(50_000)]).toEqual([
			1, 1, 10, 20, 5000, 50_000
		]);
	});

	it('writes counts in full under ten thousand and compact above', () => {
		expect([compact(5000), compact(20_000), compact(2_500_000)]).toEqual(['5,000', '20K', '2.5M']);
	});
});
