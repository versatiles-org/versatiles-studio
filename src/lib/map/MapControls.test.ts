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

/** Just enough of a MapLibre map for the zoom, the compass and the readout. */
function fakeMap(camera = { zoom: 12.34, bearing: 0, pitch: 0 }) {
	const handlers: Record<string, ((event?: unknown) => void)[]> = {};
	return {
		getZoom: () => camera.zoom,
		getBearing: () => camera.bearing,
		getPitch: () => camera.pitch,
		getCenter: () => ({ lng: 13.4, lat: 52.52 }),
		zoomIn: vi.fn(),
		zoomOut: vi.fn(),
		resetNorthPitch: vi.fn(),
		on: (name: string, handler: (event?: unknown) => void) => (handlers[name] ??= []).push(handler),
		off: vi.fn(),
		fire: (name: string, event?: unknown) => handlers[name]?.forEach((handler) => handler(event))
	};
}

describe('where am I looking', () => {
	// Set into the search strip beside the views: the other half of "where am I looking", and only
	// something to press when there is an extent to fit to.
	it('fits to the data, and only with something to fit', () => {
		open({ canReset: true });
		expect((screen.getByRole('button', { name: 'Fit to the data' }) as HTMLButtonElement).disabled).toBe(false);
		cleanup();
		open();
		expect((screen.getByRole('button', { name: 'Fit to the data' }) as HTMLButtonElement).disabled).toBe(true);
	});

	// The number a tile tool is asked most - which nothing on screen used to show.
	it('reads out the zoom and where the pointer is', () => {
		const map = fakeMap();
		open({ map });
		expect(screen.getByText('z12.3')).toBeTruthy();
		expect(screen.getByText('13.40000, 52.52000')).toBeTruthy();

		map.fire('mousemove', { lngLat: { lng: 1, lat: 2 } });
		flushSync();
		expect(screen.getByText('1.00000, 2.00000')).toBeTruthy();
	});
});

describe('the camera', () => {
	it('zooms and points north through the map', () => {
		const map = fakeMap();
		open({ map });
		screen.getByRole('button', { name: 'Zoom in' }).click();
		screen.getByRole('button', { name: 'Zoom out' }).click();
		screen.getByRole('button', { name: 'Reset bearing and pitch' }).click();
		expect([
			map.zoomIn.mock.calls.length,
			map.zoomOut.mock.calls.length,
			map.resetNorthPitch.mock.calls.length
		]).toEqual([1, 1, 1]);
	});

	it('has nothing to press before the map exists', () => {
		open();
		expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(true);
	});

	// A reading as well as a button: marked while the map is turned or tilted, quiet when it is not.
	it('marks the compass while the map is turned', () => {
		open({ map: fakeMap({ zoom: 3, bearing: 30, pitch: 0 }) });
		expect(screen.getByRole('button', { name: 'Reset bearing and pitch' }).classList.contains('turned')).toBe(true);
		cleanup();
		open({ map: fakeMap() });
		expect(screen.getByRole('button', { name: 'Reset bearing and pitch' }).classList.contains('turned')).toBe(false);
	});
});

describe('the grid button', () => {
	it('says whether the grid is on, and switches it', () => {
		const onToggleGrid = vi.fn();
		open({ showGrid: false, onToggleGrid });
		const grid = screen.getByRole('button', { name: 'Tile grid' });
		expect(grid.getAttribute('aria-pressed')).toBe('false');
		grid.click();
		expect(onToggleGrid).toHaveBeenCalledTimes(1);
	});
});

/**
 * The background picker was a native `<select>`, which on macOS opens a popup obeying none of the
 * map's chrome. It is the saved views' own `Dropdown` now, so what is asserted here is that it
 * behaves like one: closed until asked, reports the current choice, and shuts on choosing.
 */
describe('the background picker', () => {
	const toggle = () => screen.getByRole('button', { name: 'Background map' });

	// An icon in the column now, so the choice is reported where a pointer looks for it.
	it('says which background is on rather than only what it opens', () => {
		open({ background: 'colorful' });
		expect(toggle().title).toContain('Colorful');
	});

	it('opens a panel of the choices, each with a swatch of its colours', () => {
		open();
		expect(screen.queryByRole('group', { name: 'Background map' })).toBeNull();
		toggle().click();
		flushSync();
		const panel = screen.getByRole('group', { name: 'Background map' });
		expect(panel.querySelectorAll('.swatch').length).toBe(8);
		expect(panel.querySelectorAll('.swatch.none').length).toBe(1);
	});

	it('chooses one and closes', () => {
		const onBackground = vi.fn();
		open({ showGrid: false, onBackground });
		toggle().click();
		flushSync();

		screen.getByRole('button', { name: /Colorful dark/ }).click();
		flushSync();

		expect(onBackground).toHaveBeenCalledWith('colorful-dark');
		expect(screen.queryByRole('group', { name: 'Background map' })).toBeNull();
	});
	// Left open on change: flipping it is how you compare.
	it('switches the background’s labels, and stays open', () => {
		const onBackgroundLabels = vi.fn();
		open({ background: 'positrino', onBackgroundLabels });
		toggle().click();
		flushSync();

		const labels = screen.getByRole('checkbox', { name: 'Labels' }) as HTMLInputElement;
		expect(labels.checked).toBe(true);
		labels.click();
		flushSync();

		expect(onBackgroundLabels).toHaveBeenCalledWith(false);
		expect(screen.getByRole('group', { name: 'Background map' })).toBeTruthy();
	});

	it('has no labels to switch on imagery only, or with no background', () => {
		open({ background: 'satellite-plain' });
		toggle().click();
		flushSync();
		expect((screen.getByRole('checkbox', { name: 'Labels' }) as HTMLInputElement).disabled).toBe(true);
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
