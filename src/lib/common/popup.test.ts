/**
 * Where a popup goes ([Q58]).
 *
 * Checked against a window of a known size, which is the whole reason this is a function rather than
 * a few lines inside three components: a rectangle can be asserted, a rendered popup can only be
 * looked at.
 */

import { describe, expect, it } from 'vitest';
import { place } from './popup';

const WINDOW = { width: 1000, height: 800 };

/** A trigger somewhere sensible, overridable per test. */
const trigger = (over: Partial<{ left: number; top: number; bottom: number; width: number }> = {}) => ({
	left: 100,
	top: 200,
	bottom: 220,
	width: 160,
	...over
});

describe('placing a popup', () => {
	it('opens under the trigger and lines up with its left edge', () => {
		const at = place(trigger(), WINDOW);
		expect(at.top).toBe(224);
		expect(at.bottom).toBeUndefined();
		expect(at.left).toBe(100);
	});

	// A trigger narrower than the list it opens - `+ new graph…` is a few characters wide.
	it('is at least wide enough to read, whatever the trigger is', () => {
		expect(place(trigger({ width: 40 }), WINDOW).width).toBe(240);
		expect(place(trigger({ width: 400 }), WINDOW).width).toBe(400);
	});

	/**
	 * **Flipping is the ordinary case**: a node near the bottom of a long chain is where most of these
	 * open, and a list drawn downward from there would run off the window.
	 */
	it('opens upward when there is more room above', () => {
		const at = place(trigger({ top: 700, bottom: 720 }), WINDOW);
		expect(at.top).toBeUndefined();
		expect(at.bottom).toBe(104);
	});

	// Room below is what decides it, not which half of the window the trigger is in.
	it('stays downward when there is room, however low the trigger is', () => {
		expect(place(trigger({ top: 500, bottom: 520 }), WINDOW).top).toBe(524);
	});

	it('is pulled back inside the window rather than running off the right', () => {
		const at = place(trigger({ left: 950, width: 40 }), WINDOW);
		expect(at.left + at.width).toBeLessThanOrEqual(WINDOW.width);
		expect(at.left).toBe(752);
	});

	it('does not go off the left either', () => {
		expect(place(trigger({ left: -50 }), WINDOW).left).toBe(8);
	});

	// A window narrower than the minimum is not a reason to render a popup wider than the screen.
	it('never asks for more width than the window has', () => {
		const at = place(trigger(), { width: 200, height: 800 });
		expect(at.width).toBeLessThanOrEqual(200);
		expect(at.left).toBeGreaterThanOrEqual(0);
	});
});
