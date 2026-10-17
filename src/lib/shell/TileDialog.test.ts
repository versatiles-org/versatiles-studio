// @vitest-environment jsdom

/**
 * The tile dialog: the tile beside its numbers, one selection across both, and moving between tiles
 * without closing (S14.5).
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import TileDialog from './TileDialog.svelte';
import type { Dissection, FeatureDissection, LayerDissection } from '../ipc/commands';

// jsdom has no `showModal`, and `Modal` calls it on mount.
beforeAll(() => {
	HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
		this.open = true;
	};
});

afterEach(cleanup);

const layer = (name: string, features: number): LayerDissection => ({
	name,
	extent: 4096,
	version: 2,
	features,
	vertices: features * 4,
	bytes: 1000 * features,
	geometryBytes: 600,
	tagBytes: 100,
	keyBytes: 100,
	valueBytes: 100,
	idBytes: 50,
	otherBytes: 50,
	attributes: [{ key: 'name', features, distinct: features, bytes: 300 }]
});

const square = (layer: number, index: number, area = 100): FeatureDissection => ({
	layer,
	index,
	id: index + 1,
	kind: 'polygon',
	vertices: 4,
	geometryBytes: 20,
	properties: { name: `feature ${layer}/${index}` },
	parts: [
		{
			points: [
				[0, 0],
				[10, 0],
				[10, 10],
				[0, 10]
			],
			closed: true,
			area
		}
	],
	malformed: false
});

const tile: Dissection = {
	z: 14,
	x: 8800,
	y: 5373,
	format: 'mvt',
	compression: 'gzip',
	storedBytes: 610_000,
	rawBytes: 1_200_000,
	layers: [layer('water', 1), layer('buildings', 2)],
	features: [square(0, 0), square(1, 0), square(1, 1, -50)],
	every: 1,
	issues: [{ layer: 'buildings', feature: 1, kind: 'OrphanInnerRing', label: 'a ring winds the wrong way' }],
	repair: { rawBytes: 1_100_000, issuesLeft: 0 }
};

const at = { graph: 3, z: 14, x: 8800, y: 5373 };

function show(props: Partial<Parameters<typeof render<typeof TileDialog>>[1]> = {}) {
	const handlers = { onGo: vi.fn(), onShowOnMap: vi.fn(), onClose: vi.fn() };
	render(TileDialog, { at, dissection: tile, error: null, loading: false, ...handlers, ...props });
	return handlers;
}

describe('the tile dialog', () => {
	it('names the tile and says what it weighs, marking a size over the budget', () => {
		show();
		expect(screen.getByRole('dialog', { name: 'Tile 14/8800/5373' })).toBeTruthy();
		expect((screen.getByLabelText('Tile address') as HTMLInputElement).value).toBe('14/8800/5373');
		expect(screen.getByText('610 kB stored').classList.contains('over')).toBe(true);
		expect(screen.getByText(/1200 kB decompressed/)).toBeTruthy();
	});

	it('lists the layers, and shows where a picked one spends its bytes', async () => {
		show();
		const rows = within(screen.getByRole('table', { name: 'Layers' })).getAllByRole('row');
		expect(rows.slice(1).map((row) => row.querySelector('th')?.textContent?.trim())).toEqual(['water', 'buildings']);
		await fireEvent.click(screen.getByRole('button', { name: 'buildings' }));
		expect(screen.getByLabelText("Where buildings's bytes go")).toBeTruthy();
	});

	it('picks a feature from an issue, and shows its properties', async () => {
		show();
		await fireEvent.click(screen.getByRole('tab', { name: /Issues/ }));
		expect(screen.getByText('a ring winds the wrong way')).toBeTruthy();
		expect(screen.getByText(/A repair would leave 1100 kB decompressed, and no issues/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: '#1' }));
		expect(screen.getByRole('tab', { name: 'Features' }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByRole('button', { name: 'buildings #1' }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByText(/feature 1\/1/)).toBeTruthy();
	});

	/** The top row of the world has nothing north of it; west of x = 0 wraps round, as the map does. */
	it('cannot step past the pole, and wraps round the antimeridian', async () => {
		const { onGo } = show({ at: { graph: 1, z: 2, x: 0, y: 0 } });
		for (const name of ['North-west', 'North', 'North-east']) {
			expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
		}
		await fireEvent.click(screen.getByRole('button', { name: 'West' }));
		expect(onGo).toHaveBeenLastCalledWith(2, 3, 0);
	});

	it('draws a hole dashed, apart from an outer ring', () => {
		show();
		const rings = [...document.querySelectorAll('path.ring')];
		expect(rings.map((ring) => ring.classList.contains('hole'))).toEqual([false, false, true]);
	});

	it('moves to the parent, a child, a neighbour and a typed address', async () => {
		const { onGo } = show();
		await fireEvent.click(screen.getByRole('button', { name: 'Parent' }));
		expect(onGo).toHaveBeenLastCalledWith(13, 4400, 2686);
		await fireEvent.click(screen.getByRole('button', { name: 'Child south-east' }));
		expect(onGo).toHaveBeenLastCalledWith(15, 17601, 10747);
		await fireEvent.click(screen.getByRole('button', { name: 'East' }));
		expect(onGo).toHaveBeenLastCalledWith(14, 8801, 5373);
		await fireEvent.click(screen.getByRole('button', { name: 'North-west' }));
		expect(onGo).toHaveBeenLastCalledWith(14, 8799, 5372);

		const field = screen.getByLabelText('Tile address');
		await fireEvent.input(field, { target: { value: '12/2200/1343' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Go' }));
		expect(onGo).toHaveBeenLastCalledWith(12, 2200, 1343);

		await fireEvent.input(field, { target: { value: 'nowhere' } });
		expect((screen.getByRole('button', { name: 'Go' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('says when the source has no tile there, and when a tile was too big to list', () => {
		show({ dissection: null });
		expect(screen.getByText('This source has no tile at 14/8800/5373.')).toBeTruthy();
		cleanup();
		show({ dissection: { ...tile, every: 3 } });
		expect(screen.getByText(/Every 3rd feature of each layer is drawn and listed - 3 of/)).toBeTruthy();
	});

	it('takes a raster tile no further than its size', () => {
		show({ dissection: { ...tile, format: 'png', layers: [], features: [], issues: [], repair: null } });
		expect(screen.getByText('A raster tile has nothing to take apart beyond its size.')).toBeTruthy();
		expect(screen.queryByRole('tablist')).toBeNull();
	});
});
