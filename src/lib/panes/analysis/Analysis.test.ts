// @vitest-environment jsdom

/**
 * What the Analysis pane shows about a source's tile sizes (S14.2).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import Analysis from './Analysis.svelte';
import type { Sizes } from '../../ipc/commands';
import type { Measurement } from '../../state/analysis.svelte';

const sizes: Sizes = {
	tiles: 3,
	bytes: 1_300_000,
	p50: 200_000,
	p95: 900_000,
	max: 900_000,
	levels: [
		{ level: 0, tiles: 1, bytes: 200_000, p50: 200_000, p95: 200_000, max: 200_000 },
		{ level: 1, tiles: 2, bytes: 1_100_000, p50: 200_000, p95: 900_000, max: 900_000 }
	],
	biggest: [
		{ z: 1, x: 1, y: 0, bytes: 900_000 },
		{ z: 0, x: 0, y: 0, bytes: 200_000 }
	]
};

const measured = (over: Partial<Measurement> = {}): Measurement => ({
	sizes: null,
	error: null,
	running: false,
	build: null,
	...over
});

const show = (props: Partial<Parameters<typeof render<typeof Analysis>>[1] & object> = {}) =>
	render(Analysis, {
		graph: 'berlin',
		measurement: measured(),
		onMeasure: vi.fn(),
		onShowTile: vi.fn(),
		onInspectTile: vi.fn(),
		...props
	});

afterEach(cleanup);

describe('the analysis pane', () => {
	it('says so when no source is selected', () => {
		show({ graph: null });
		expect(screen.getByText('No source selected.')).toBeTruthy();
	});

	it('measures nothing until asked, and asks when the button is pressed', async () => {
		const onMeasure = vi.fn();
		show({ onMeasure });
		expect(screen.queryByRole('table')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
		expect(onMeasure).toHaveBeenCalledOnce();
	});

	it('cannot be pressed twice while a walk is running', () => {
		show({ measurement: measured({ running: true }) });
		expect((screen.getByRole('button', { name: 'Measure' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('lists the figures per zoom, and marks a maximum over the budget', () => {
		show({ measurement: measured({ sizes }) });
		const table = screen.getByRole('table', { name: 'Sizes per zoom level' });
		const rows = within(table).getAllByRole('row').slice(1);
		expect(rows.map((row) => [...row.children].map((cell) => cell.textContent?.trim()).join(' '))).toEqual([
			'0 1 200 kB 200 kB',
			'1 2 550 kB 900 kB'
		]);
		expect(within(rows[1]).getByText('900 kB').classList.contains('over')).toBe(true);
		expect(within(rows[0]).getAllByText('200 kB')[1].classList.contains('over')).toBe(false);
	});

	it('frames a tile from the list of the biggest', async () => {
		const onShowTile = vi.fn();
		show({ measurement: measured({ sizes }), onShowTile });
		await fireEvent.click(screen.getByRole('button', { name: '1/1/0' }));
		expect(onShowTile).toHaveBeenCalledWith(1, 1, 0);
	});

	it('opens the tile dialog on one of the biggest', async () => {
		const onInspectTile = vi.fn();
		show({ measurement: measured({ sizes }), onInspectTile });
		await fireEvent.click(screen.getByRole('button', { name: 'Inspect 1/1/0' }));
		expect(onInspectTile).toHaveBeenCalledWith(1, 1, 0);
	});

	it('keeps the last figures beside a failure, and says they may be out of date', () => {
		show({ measurement: measured({ sizes, error: 'no index' }), stale: true });
		expect(screen.getByText('no index')).toBeTruthy();
		expect(screen.getByText('Measured before the last change to this source.')).toBeTruthy();
		expect(screen.getByRole('table', { name: 'Sizes per zoom level' })).toBeTruthy();
	});
});

describe('the heat map switch', () => {
	it('says what pressing it will do, and does it', async () => {
		const onToggleHeat = vi.fn();
		show({ heatOn: false, onToggleHeat });
		await fireEvent.click(screen.getByRole('button', { name: 'Show the heat map' }));
		expect(onToggleHeat).toHaveBeenCalledOnce();
		cleanup();
		show({ heatOn: true, onToggleHeat });
		expect(screen.getByRole('button', { name: 'Hide the heat map' })).toBeTruthy();
	});
});
