import { describe, expect, it } from 'vitest';
import { share, step, summarise } from './pixel-stats';

const counts = (at: Record<number, number>) => Array.from({ length: 256 }, (_, value) => at[value] ?? 0);

describe('a channel, summed up', () => {
	it('finds its range and mean, and how much sits at either end', () => {
		expect(summarise(counts({ 0: 1, 100: 2, 255: 1 }))).toEqual({
			pixels: 4,
			min: 0,
			max: 255,
			mean: 113.75,
			atZero: 0.25,
			atTop: 0.25
		});
	});

	it('has no range for a channel with no pixels', () => {
		expect(summarise(counts({}))).toEqual({ pixels: 0, min: null, max: null, mean: null, atZero: 0, atTop: 0 });
	});
});

describe('the steps of a height histogram', () => {
	it('splits the range evenly', () => {
		expect(step(0, 300, 3, 0)).toEqual([0, 100]);
		expect(step(0, 300, 3, 2)).toEqual([200, 300]);
		expect(step(-50, 50, 4, 1)).toEqual([-25, 0]);
	});
});

describe('a share', () => {
	it('says nothing as a dash, little as under 1%, and rounds the rest', () => {
		expect([share(0), share(0.004), share(0.5), share(0.127)]).toEqual(['-', 'under 1%', '50%', '13%']);
	});
});
