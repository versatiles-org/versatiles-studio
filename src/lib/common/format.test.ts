import { describe, expect, it } from 'vitest';
import { bytes, count, duration } from './format';

describe('duration', () => {
	it('stops pretending to be precise as it gets further away', () => {
		expect(duration(3)).toBe('a few seconds');
		expect(duration(47)).toBe('45s');
		expect(duration(600)).toBe('10 min');
		expect(duration(7200)).toBe('2.0 h');
	});

	// The status bar appends " left" and an export dialog says "about" — neither works if the phrase
	// carries its own subject.
	it('is a phrase a caller can build a sentence from', () => {
		expect(duration(600).startsWith('about')).toBe(false);
		expect(duration(600).endsWith('left')).toBe(false);
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
