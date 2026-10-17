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
		scan: { contents: null, error: null, running: false, build: null },
		onScan: vi.fn(),
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

	describe('the layers', () => {
		const layer = (name: string, bytes: number, features: number) => ({
			name,
			tiles: 1,
			features,
			bytes,
			geometryBytes: bytes / 2,
			propertyBytes: bytes / 4,
			tagBytes: bytes / 8,
			idBytes: 0,
			otherBytes: bytes / 8
		});
		const contents = {
			sampled: true,
			read: 4,
			undecodable: 0,
			levels: [
				{ level: 13, tiles: 4, read: 2, layers: [layer('water', 3000, 5), layer('roads', 1000, 7)] },
				{ level: 14, tiles: 16, read: 2, layers: [layer('roads', 4000, 9)] }
			]
		};
		const scanned = { contents, error: null, running: false, build: 'b' };
		const names = () =>
			screen
				.getAllByRole('row')
				.slice(1)
				.map((row) => row.querySelector('.name')?.textContent);

		it('reads them only when asked', async () => {
			const onScan = vi.fn();
			show({ onScan });
			await fireEvent.click(screen.getByRole('button', { name: 'Read layers' }));
			expect(onScan).toHaveBeenCalledWith(false);
		});

		it('ranks them over every level by their share, and says the answer is a sample', () => {
			show({ measurement: measured(), scan: scanned });
			const table = screen.getByRole('table', { name: 'Layers' });
			const rows = within(table).getAllByRole('row').slice(1);
			expect(rows.map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent))).toEqual([
				['63%', '5 kB', '16'],
				['38%', '3 kB', '5']
			]);
			expect(screen.getByText(/A sample: 4 of 20 tiles read/)).toBeTruthy();
		});

		it('narrows to one level', async () => {
			show({ measurement: measured(), scan: scanned });
			await fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '13' } });
			expect(names()).toEqual(['water', 'roads']);
			expect(screen.getByText(/A sample: 2 of 4 tiles read/)).toBeTruthy();
		});

		it('offers to read every tile after a sample', async () => {
			const onScan = vi.fn();
			show({ measurement: measured(), scan: scanned, onScan });
			await fireEvent.click(screen.getByRole('button', { name: 'Read every tile' }));
			expect(onScan).toHaveBeenCalledWith(true);
		});
	});
});
