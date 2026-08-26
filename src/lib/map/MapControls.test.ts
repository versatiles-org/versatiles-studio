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
