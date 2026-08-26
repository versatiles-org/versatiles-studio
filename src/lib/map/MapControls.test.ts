// @vitest-environment jsdom

/**
 * The grid's level stepper (A5).
 *
 * **The number must never be the quiet part.** The grid was one level out for three of the four
 * source combinations and said nothing about it, which is the whole reason this control exists - so
 * what it draws is on screen, and being off the source's own level is marked rather than merely
 * different. See `requestedZoom` for where the default comes from.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import MapControls from './MapControls.svelte';

afterEach(cleanup);

function open(over: Record<string, unknown> = {}) {
	const onGridLevel = vi.fn();
	render(MapControls, {
		background: 'none',
		showGrid: true,
		gridLevel: 14,
		canReset: false,
		onBackground: () => {},
		onToggleGrid: () => {},
		onGridLevel,
		onReset: () => {},
		...over
	} as never);
	return { onGridLevel };
}

const level = () => screen.getByRole('button', { name: /^z\d+$/ });

describe('the cluster', () => {
	// "Reset view" said what it does twice: it sits beside the views dropdown, which is the other
	// half of "where am I looking".
	it('offers reset beside the views, and only with something to fit', () => {
		open({ canReset: true });
		expect((screen.getByRole('button', { name: 'reset' }) as HTMLButtonElement).disabled).toBe(false);
		cleanup();
		open();
		expect((screen.getByRole('button', { name: 'reset' }) as HTMLButtonElement).disabled).toBe(true);
	});

	// The z/x/y is in the grid's own labels and in the box below it; the button only has to say
	// which overlay it is.
	it('calls the grid button “grid”', () => {
		open();
		expect(screen.getByRole('button', { name: 'grid' })).toBeTruthy();
	});
});

/**
 * The background picker was a native `<select>`, which on macOS opens a popup obeying none of the
 * map's chrome. It is the saved views' own `Dropdown` now, so what is asserted here is that it
 * behaves like one: closed until asked, reports the current choice, and shuts on choosing.
 */
describe('the background picker', () => {
	const toggle = () => screen.getByRole('button', { name: /No background|Positron|Dark/ });

	it('says which background is on rather than only what it opens', () => {
		open({ background: 'none' });
		expect(toggle().textContent).toContain('No background');
	});

	it('opens a panel of the choices', () => {
		open();
		expect(screen.queryByRole('group', { name: 'Background map' })).toBeNull();
		toggle().click();
		flushSync();
		expect(screen.getByRole('group', { name: 'Background map' })).toBeTruthy();
	});

	it('chooses one and closes', () => {
		const onBackground = vi.fn();
		render(MapControls, {
			background: 'none',
			showGrid: false,
			gridLevel: 14,
			canReset: false,
			onBackground,
			onToggleGrid: () => {},
			onGridLevel: () => {},
			onReset: () => {}
		} as never);
		screen.getByRole('button', { name: /No background/ }).click();
		flushSync();

		const pick = screen.getAllByRole('button').find((node) => node.classList.contains('option'))!;
		pick.click();
		flushSync();

		expect(onBackground).toHaveBeenCalled();
		expect(screen.queryByRole('group', { name: 'Background map' })).toBeNull();
	});
});

describe('the grid level stepper', () => {
	// Off, the cluster is one button doing one thing - which is what it was before this existed.
	it('is not there while the grid is off', () => {
		open({ showGrid: false });
		expect(screen.queryByRole('group', { name: 'Grid zoom level' })).toBeNull();
	});

	it('shows the level the grid is drawing', () => {
		open({ gridLevel: 15 });
		expect(level().textContent?.trim()).toBe('z15');
	});

	it('walks a level in and out', () => {
		const { onGridLevel } = open();
		screen.getByTitle('One level in').click();
		screen.getByTitle('One level out').click();
		expect(onGridLevel.mock.calls).toEqual([[1], [-1]]);
	});

	// The number is the readout and the way back, rather than a fourth button in the corner.
	it('puts the level back when the number is pressed', () => {
		const { onGridLevel } = open({ gridNudged: true });
		level().click();
		expect(onGridLevel).toHaveBeenCalledWith(0);
	});

	it('marks a level that is off the one being requested', () => {
		open({ gridNudged: true });
		expect(level().classList.contains('nudged')).toBe(true);
		expect(level().title).toMatch(/back/i);
	});

	it('leaves the source’s own level unmarked', () => {
		open();
		expect(level().classList.contains('nudged')).toBe(false);
	});

	// There is nothing above z0, and a control that offers it would draw a grid of one tile that is
	// not the one being asked for.
	it('cannot walk out past the top of the pyramid', () => {
		open({ gridLevel: 0 });
		expect((screen.getByTitle('One level out') as HTMLButtonElement).disabled).toBe(true);
	});
});
