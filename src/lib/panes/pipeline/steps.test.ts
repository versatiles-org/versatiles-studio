import { describe, expect, it } from 'vitest';
import { describeSteps, fromSteps, parseSteps, resolve, toSteps, ZOOMS } from './steps';

/** The first sixteen levels, spelled the way upstream's own test spells them. */
const sixteen = (text: string): string =>
	(resolve(text) ?? [])
		.slice(0, 16)
		.map((value) => (value === null ? '' : String(value)))
		.join(',');

describe('reading the written form', () => {
	// **Upstream's `parse_quality_cases`, verbatim.** These seven are the contract between the two
	// implementations; if `raster_format.rs` changes what it accepts, this is what goes red.
	it.each([
		['80', '80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80'],
		['80,70', '80,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70'],
		['10:30', ',,,,,,,,,,30,30,30,30,30,30'],
		['80,70,14:50,15:20', '80,70,70,70,70,70,70,70,70,70,70,70,70,70,50,20'],
		['', ',,,,,,,,,,,,,,,'],
		[', , ', ',,,,,,,,,,,,,,,'],
		[' ,80 , ,  ', ',80,80,80,80,80,80,80,80,80,80,80,80,80,80,80']
	])('resolves %o the way the parser does', (input, expected) => {
		expect(sixteen(input)).toBe(expected);
	});

	it('fills forward to the last zoom, not just the sixteen upstream prints', () => {
		expect(resolve('10:30')?.[ZOOMS - 1]).toBe(30);
		expect(resolve('10:30')?.[9]).toBeNull();
	});

	// The syntax Studio's own documentation used to claim, and the parser has never accepted.
	it.each(['0-10:80,11-14:90', '0-10:80', 'eighty', '80abc', '0x10', '10:', '32:80', '80:0:1', '101', '-5'])(
		'refuses %o rather than guessing at it',
		(input) => {
			expect(resolve(input)).toBeNull();
		}
	);

	it('refuses a value above the control’s own maximum', () => {
		expect(resolve('50', 40)).toBeNull();
		expect(resolve('30', 40)).not.toBeNull();
	});
});

describe('the breakpoints a curve is made of', () => {
	it('keeps one entry per change and none for a repeat', () => {
		expect(parseSteps('80,70,14:50,15:20')).toEqual([
			{ zoom: 0, value: 80 },
			{ zoom: 1, value: 70 },
			{ zoom: 14, value: 50 },
			{ zoom: 15, value: 20 }
		]);
	});

	it('starts where the curve starts, not at zoom 0', () => {
		expect(parseSteps('10:30')).toEqual([{ zoom: 10, value: 30 }]);
	});

	it('has none at all when nothing is set', () => {
		expect(parseSteps('')).toEqual([]);
	});

	// **The reason resolving comes first.** Read as two rules this is "50 from z14, then 30 from
	// z10"; read as a curve it is one rule, because the second overwrites the first from z10 down.
	it('reduces an overlapping string to the curve it means', () => {
		expect(parseSteps('14:50,10:30')).toEqual([{ zoom: 10, value: 30 }]);
	});

	it('is null for text that is not this language', () => {
		expect(parseSteps('0-10:80')).toBeNull();
	});
});

describe('writing the form back', () => {
	it('writes a single curve-wide value the way a person would', () => {
		expect(fromSteps([{ zoom: 0, value: 80 }])).toBe('80');
	});

	it('spells out every other shape, so no comma has to be counted', () => {
		expect(
			fromSteps([
				{ zoom: 0, value: 80 },
				{ zoom: 14, value: 50 }
			])
		).toBe('0:80,14:50');
		expect(fromSteps([{ zoom: 10, value: 30 }])).toBe('10:30');
	});

	it('sorts by zoom, whatever order the rows are in', () => {
		expect(
			fromSteps([
				{ zoom: 14, value: 50 },
				{ zoom: 0, value: 80 }
			])
		).toBe('0:80,14:50');
	});

	it('keeps the last of two entries for one zoom, as the parser does', () => {
		expect(
			fromSteps([
				{ zoom: 4, value: 80 },
				{ zoom: 4, value: 50 }
			])
		).toBe('4:50');
	});

	it('is empty when there are no breakpoints, which is what clears the parameter', () => {
		expect(fromSteps([])).toBe('');
	});

	// The property that matters: editing a row and writing it back must not change any other zoom.
	it.each(['80', '80,70', '10:30', '80,70,14:50,15:20', '', ' ,80 , ,  ', '14:50,10:30'])(
		'round-trips %o to the same curve',
		(input) => {
			const once = fromSteps(parseSteps(input) ?? []);
			expect(resolve(once)).toEqual(resolve(input));
			// And is stable: writing it a second time changes nothing.
			expect(fromSteps(parseSteps(once) ?? [])).toBe(once);
		}
	);
});

describe('saying what the curve does', () => {
	it('names a range, a single zoom, and the open tail', () => {
		expect(describeSteps(toSteps(resolve('80,70,14:50,15:20') ?? []))).toBe('z0: 80 · z1-13: 70 · z14: 50 · z15+: 20');
	});

	it('says so when nothing is set', () => {
		expect(describeSteps([])).toMatch(/encoder decides/);
	});
});
