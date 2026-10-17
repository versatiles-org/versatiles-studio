// @vitest-environment jsdom

/**
 * The map's popup and the tile under a click (S14.6): the drawn tile, at the level the map asked
 * for, opened on a click with or without a feature, and one click from the dialog.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Map as MaplibreMap } from 'maplibre-gl';
import type { TileSummary } from '../ipc/commands';

const ipc = vi.hoisted(() => ({ summariseTile: vi.fn() }));
vi.mock('../ipc/commands', () => ipc);

const { default: FeaturePopup } = await import('./FeaturePopup.svelte');

type Handler = (event: unknown) => void;

/** As much of a map as the popup touches: its events, a hit test, and our source's spec. */
function fakeMap(zoom: number, source: { type: string; tileSize?: number; maxzoom?: number }) {
	const handlers = new Map<string, Handler[]>();
	let hits: unknown[] = [];
	const map = {
		on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		off: (name: string, handler: Handler) =>
			handlers.set(
				name,
				(handlers.get(name) ?? []).filter((h) => h !== handler)
			),
		getStyle: () => ({ layers: [{ id: 'berlin:streets', source: 'berlin' }] }),
		queryRenderedFeatures: () => hits,
		project: () => ({ x: 400, y: 300 }),
		getZoom: () => zoom,
		getSource: (id: string) => (id === 'berlin' ? source : undefined),
		getCanvas: () => ({ style: {} })
	};
	return {
		map: map as unknown as MaplibreMap,
		hits: (next: unknown[]) => (hits = next),
		/** A click in the middle of Berlin. */
		click: async () => {
			for (const handler of handlers.get('click') ?? [])
				handler({ point: { x: 400, y: 300 }, lngLat: { lng: 13.4, lat: 52.52 } });
			await tick();
			await Promise.resolve();
			await tick();
		}
	};
}

const summary = (z: number, x: number, y: number): TileSummary => ({
	z,
	x,
	y,
	storedBytes: 216_000,
	rawBytes: 469_000,
	layers: [{ name: 'streets', features: 4581, bytes: 188_000 }]
});

// jsdom has no `ResizeObserver`, and the popup measures itself to know which way to flip.
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
} as unknown as typeof ResizeObserver;

beforeEach(() => {
	ipc.summariseTile.mockImplementation((_graph: number, z: number, x: number, y: number) =>
		Promise.resolve(summary(z, x, y))
	);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const show = (fake: ReturnType<typeof fakeMap>, onInspect = vi.fn()) =>
	render(FeaturePopup, { map: fake.map, graph: 4, mount: 'berlin', drawing: false, onInspect });

describe('the tile under a click', () => {
	it('asks the drawn source for the tile at the level the map requested, and says stored from decompressed', async () => {
		const fake = fakeMap(13.7, { type: 'vector', maxzoom: 14 });
		show(fake);
		await fake.click();
		expect(ipc.summariseTile).toHaveBeenCalledWith(4, 13, 4400, 2686);
		expect(screen.getByText('216 kB stored').getAttribute('title')).toBe('469 kB decompressed');
		expect(screen.getByText('streets')).toBeTruthy();
	});

	/** Past the source's deepest level the map stretches its deepest tile; that is the one to name. */
	it('names the deepest tile when the map is overzoomed', async () => {
		const fake = fakeMap(17.2, { type: 'vector', maxzoom: 14 });
		show(fake);
		await fake.click();
		expect(ipc.summariseTile).toHaveBeenCalledWith(4, 14, 8801, 5373);
	});

	it('asks a 256 px raster source one level deeper, as MapLibre does', async () => {
		const fake = fakeMap(10.6, { type: 'raster', tileSize: 256, maxzoom: 18 });
		show(fake);
		await fake.click();
		expect(ipc.summariseTile).toHaveBeenCalledWith(4, 12, 2200, 1343);
	});

	it('opens on a click that hits no feature, and closes on the next one', async () => {
		const fake = fakeMap(14, { type: 'vector', maxzoom: 14 });
		show(fake);
		await fake.click();
		expect(screen.getByText('tile 14/8801/5373', { exact: false })).toBeTruthy();
		await fake.click();
		expect(screen.queryByText('tile 14/8801/5373', { exact: false })).toBeNull();
	});

	it('opens the dialog on the tile, and gets out of its way', async () => {
		const fake = fakeMap(14, { type: 'vector', maxzoom: 14 });
		const onInspect = vi.fn();
		show(fake, onInspect);
		fake.hits([{ source: 'berlin', sourceLayer: 'streets', properties: { name: 'Unter den Linden' } }]);
		await fake.click();
		await fireEvent.click(screen.getByRole('button', { name: 'Inspect tile…' }));
		expect(onInspect).toHaveBeenCalledWith(14, 8801, 5373);
		expect(screen.queryByText('streets')).toBeNull();
	});
});
