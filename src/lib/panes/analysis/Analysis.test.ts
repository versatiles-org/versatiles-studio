// @vitest-environment jsdom

/**
 * What the Analysis pane shows about a source's tile sizes (S14.2).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import Analysis from './Analysis.svelte';
import type { Checks, Sizes } from '../../ipc/commands';
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
		onRepair: vi.fn(),
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
	/** Only to switch it on: once on, the map's button and legend are where it is switched off. */
	it('switches it on, and is gone once it is', async () => {
		const onToggleHeat = vi.fn();
		show({ heatOn: false, onToggleHeat });
		await fireEvent.click(screen.getByRole('button', { name: 'Show the heat map' }));
		expect(onToggleHeat).toHaveBeenCalledOnce();
		cleanup();
		show({ heatOn: true, onToggleHeat });
		expect(screen.queryByRole('button', { name: /heat map/ })).toBeNull();
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
			checks: { tilesWithIssues: 0, issues: [], tilejson: null } as Checks,
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

		/** The bars keep the heaviest layer's scale whichever row comes first. */
		it('sorts by a column, the bars still to one scale', async () => {
			show({ measurement: measured(), scan: scanned });
			const table = screen.getByRole('table', { name: 'Layers' });
			const features = within(table).getByRole('button', { name: 'Features' });
			await fireEvent.click(features);
			await fireEvent.click(features);
			expect(features.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
			expect(names()).toEqual(['water', 'roads']);
			expect((table.querySelector('.bar') as HTMLElement).style.width).toBe('60%');
			await fireEvent.click(features);
			expect(names()).toEqual(['roads', 'water']);
		});

		it('offers to read every tile after a sample', async () => {
			const onScan = vi.fn();
			show({ measurement: measured(), scan: scanned, onScan });
			await fireEvent.click(screen.getByRole('button', { name: 'Read every tile' }));
			expect(onScan).toHaveBeenCalledWith(true);
		});
	});

	describe('the checks', () => {
		const contents = (checks: Checks, sampled = false) => ({
			contents: { sampled, read: 10, undecodable: 0, checks, levels: [] },
			error: null,
			running: false,
			build: 'b'
		});
		const check = (fix: 'repair' | 'drop', label: string, count: number) => ({
			kind: label,
			label,
			count,
			tiles: 2,
			fix,
			example: { z: 14, x: 8800, y: 5373, layer: 'water', feature: 3 }
		});

		it('says a sample with nothing wrong is only a clean sample', () => {
			show({ scan: contents({ tilesWithIssues: 0, issues: [], tilejson: null }, true) });
			expect(screen.getByText('The TileJSON passes.')).toBeTruthy();
			expect(screen.getByText('No violations of the vector tile spec in the tiles read.')).toBeTruthy();
			expect(screen.queryByRole('button', { name: /Repair/ })).toBeNull();
		});

		it('lists each kind with an example to open, and repairs at the end of the chain', async () => {
			const onRepair = vi.fn();
			const onInspectTile = vi.fn();
			show({
				scan: contents({
					tilesWithIssues: 2,
					issues: [check('repair', 'A ring whose vertices lie on one line', 5)],
					tilejson: "Vector tilesets must have 'vector_layers'"
				}),
				onRepair,
				onInspectTile
			});
			expect(screen.getByText("TileJSON: Vector tilesets must have 'vector_layers'")).toBeTruthy();
			expect(screen.getByText('5 violations of the vector tile spec in 2 tiles.')).toBeTruthy();
			await fireEvent.click(
				screen.getByRole('button', { name: 'Inspect an example of: A ring whose vertices lie on one line' })
			);
			expect(onInspectTile).toHaveBeenCalledWith(14, 8800, 5373);
			await fireEvent.click(screen.getByRole('button', { name: 'Repair' }));
			expect(onRepair).toHaveBeenCalledWith(false);
		});

		it('says when the repair will drop features, and asks for it', async () => {
			const onRepair = vi.fn();
			show({
				scan: contents({
					tilesWithIssues: 1,
					issues: [check('repair', 'A layer has no extent', 1), check('drop', 'A point with no coordinates', 1)],
					tilejson: null
				}),
				onRepair
			});
			await fireEvent.click(screen.getByRole('button', { name: 'Repair, dropping what cannot be mended' }));
			expect(onRepair).toHaveBeenCalledWith(true);
		});

		it('does not offer a second repair after one', () => {
			show({
				scan: contents({ tilesWithIssues: 1, issues: [check('repair', 'A layer has no extent', 1)], tilejson: null }),
				endsInRepair: true
			});
			expect(screen.queryByRole('button', { name: /Repair/ })).toBeNull();
			expect(screen.getByText(/already ends in vector_repair/)).toBeTruthy();
		});
	});
});
