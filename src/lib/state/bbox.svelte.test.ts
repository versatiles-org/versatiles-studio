/**
 * The rectangle a bbox field puts on the map ([Q53]).
 *
 * Two ends of the window agree through this and nothing else, so what is asserted here is the
 * handover: who holds the map, when it is given back, and the one case where giving it back would
 * cancel the very drag it was about to start.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bboxField, formatBbox, parseBbox, type BBox } from './bbox.svelte';

const BERLIN: BBox = [13.0, 52.3, 13.8, 52.7];

beforeEach(() => {
	// Whatever a previous test left holding it.
	bboxField.finish([0, 0, 0, 0]);
	bboxField.release('a');
	bboxField.release('b');
	bboxField.release('cleanup');
});

describe('the map a bbox field borrows', () => {
	it('shows nothing until a field asks', () => {
		bboxField.release('a');
		expect(bboxField.drawing).toBe(false);
	});

	it('draws what the field holds as soon as it is focused', () => {
		bboxField.focus('a', BERLIN, () => {});
		expect(bboxField.shown).toEqual(BERLIN);
		expect(bboxField.holds('a')).toBe(true);
	});

	// Two dimmed rectangles at once are two crops as far as the eye is concerned.
	it('is held by one field at a time', () => {
		bboxField.focus('a', BERLIN, () => {});
		bboxField.focus('b', null, () => {});
		expect(bboxField.holds('a')).toBe(false);
		expect(bboxField.holds('b')).toBe(true);
		expect(bboxField.shown).toBeNull();
	});

	it('is given back when the field is done with it', () => {
		bboxField.focus('a', BERLIN, () => {});
		bboxField.release('a');
		expect(bboxField.shown).toBeNull();
		expect(bboxField.holds('a')).toBe(false);
	});

	// A field that no longer has it must not be able to take it from the one that does.
	it('ignores a release from a field that does not hold it', () => {
		bboxField.focus('a', BERLIN, () => {});
		bboxField.release('b');
		expect(bboxField.shown).toEqual(BERLIN);
	});

	it('only draws for the field holding it', () => {
		bboxField.focus('a', null, () => {});
		bboxField.toggleDraw('b');
		expect(bboxField.drawing).toBe(false);
		bboxField.toggleDraw('a');
		expect(bboxField.drawing).toBe(true);
	});

	/**
	 * The one that is easy to get wrong: pressing the draw button blurs the input, and a blur that
	 * released the map would cancel the drawing before the first pointer-down reached the canvas.
	 */
	it('is not given back mid-drag', () => {
		bboxField.focus('a', BERLIN, () => {});
		bboxField.toggleDraw('a');
		bboxField.release('a');
		expect(bboxField.drawing).toBe(true);
		expect(bboxField.holds('a')).toBe(true);
	});

	it('hands a finished rectangle to the field and stops drawing', () => {
		const commit = vi.fn();
		bboxField.focus('a', null, commit);
		bboxField.toggleDraw('a');
		bboxField.finish(BERLIN);

		expect(commit).toHaveBeenCalledWith(BERLIN);
		expect(bboxField.drawing).toBe(false);
		// Taking the rectangle away at the moment it becomes the answer would read as a failed drag.
		expect(bboxField.shown).toEqual(BERLIN);
	});
});

describe('reading a bbox out of a field', () => {
	// All three are VPL somebody types, and a rectangle should appear for each of them.
	it('takes the four numbers however they are written', () => {
		expect(parseBbox('[13,52.3,13.8,52.7]')).toEqual([13, 52.3, 13.8, 52.7]);
		expect(parseBbox('13, 52.3, 13.8, 52.7')).toEqual([13, 52.3, 13.8, 52.7]);
		expect(parseBbox(' [ 13 , 52.3 , 13.8 , 52.7 ] ')).toEqual([13, 52.3, 13.8, 52.7]);
	});

	it('reads the southern and western hemispheres', () => {
		expect(parseBbox('[-58.5,-34.7,-58.3,-34.5]')).toEqual([-58.5, -34.7, -58.3, -34.5]);
	});

	// Half-typed, or not a rectangle at all. Drawing a guess is worse than drawing nothing.
	it('is nothing until there are four of them', () => {
		expect(parseBbox('')).toBeNull();
		expect(parseBbox('13, 52')).toBeNull();
		expect(parseBbox('13, 52, 14, 53, 15')).toBeNull();
		expect(parseBbox('13,')).toBeNull();
	});

	// MapLibre would take these and fly somewhere nobody meant.
	it('refuses degrees that are not on the globe', () => {
		expect(parseBbox('[200, 52, 201, 53]')).toBeNull();
		expect(parseBbox('[13, 91, 14, 92]')).toBeNull();
	});
});

describe('writing a drawn rectangle back', () => {
	it('is short enough to read and finer than a drag can mean', () => {
		expect(formatBbox([13.123456789, 52.3, 13.8, 52.7])).toBe('13.123457, 52.3, 13.8, 52.7');
	});

	it('leaves a whole degree whole', () => {
		expect(formatBbox([13, 52, 14, 53])).toBe('13, 52, 14, 53');
	});

	// What comes out has to go back in, or a drawn rectangle stops being drawable a second time.
	it('round-trips through the parser', () => {
		expect(parseBbox(formatBbox(BERLIN))).toEqual(BERLIN);
	});
});
