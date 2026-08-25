import { describe, expect, it } from 'vitest';
import { bytes, count, duration, megabytes } from './format';

describe('duration', () => {
	it('stops pretending to be precise as it gets further away', () => {
		expect(duration(3)).toBe('a few seconds');
		expect(duration(47)).toBe('45s');
		expect(duration(600)).toBe('10 min');
		expect(duration(7200)).toBe('2.0 h');
	});

	// The status bar appends " left" and an export dialog says "about" - neither works if the phrase
	// carries its own subject.
	it('is a phrase a caller can build a sentence from', () => {
		expect(duration(600).startsWith('about')).toBe(false);
		expect(duration(600).endsWith('left')).toBe(false);
	});
});

describe('megabytes', () => {
	// The point of the one unit: a column of these compares by eye, which a mixed-unit column does
	// not - `900 kB` above `1.2 GB` reads as the bigger number on top.
	it('holds the unit steady across the whole range', () => {
		expect(megabytes(900_000)).toBe('0.9 MB');
		expect(megabytes(2_300_000)).toBe('2.3 MB');
		expect(megabytes(1_200_000_000)).toBe('1200.0 MB');
	});

	it('does not round a real size away to nothing it can be confused with', () => {
		expect(megabytes(0)).toBe('0.0 MB');
	});
});

describe('bytes', () => {
	it('uses the units a disk is quoted in', () => {
		expect(bytes(512)).toBe('512 B');
		expect(bytes(2_300)).toBe('2 kB');
		expect(bytes(2_300_000)).toBe('2.3 MB');
		expect(bytes(2_300_000_000)).toBe('2.3 GB');
	});

	it('does not round a real size away to nothing', () => {
		expect(bytes(0)).toBe('0 B');
		expect(bytes(1)).toBe('1 B');
	});
});

describe('count', () => {
	it('groups thousands so a tile count can be read at a glance', () => {
		expect(count(1_048_576)).toBe('1,048,576');
		expect(count(21)).toBe('21');
	});
});
