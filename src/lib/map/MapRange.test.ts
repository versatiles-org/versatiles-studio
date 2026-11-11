// @vitest-environment jsdom

/**
 * The notice that says the camera is where the data is not (#16).
 *
 * What it says is `data-range.ts`'s, and tested there. What is tested here is the wiring: it asks
 * again when the camera stops, it goes away when the camera is back, and its button is the way back.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import MapRange from './MapRange.svelte';

/** A city extract at z14-z16. */
const CITY = { minZoom: 14, maxZoom: 16, bbox: [13.3, 52.4, 13.5, 52.6] as [number, number, number, number] };

/** A camera that can be moved, and tells its `moveend` listeners when it is. */
function camera(zoom: number) {
	let current = { zoom, bounds: [13.2, 52.3, 13.6, 52.7] };
	const listeners: (() => void)[] = [];
	const map = {
		getZoom: () => current.zoom,
		getBounds: () => ({
			getWest: () => current.bounds[0],
			getSouth: () => current.bounds[1],
			getEast: () => current.bounds[2],
			getNorth: () => current.bounds[3]
		}),
		getSource: () => ({ type: 'vector' }),
		on: (_event: string, listener: () => void) => void listeners.push(listener),
		off: (_event: string, listener: () => void) => void listeners.splice(listeners.indexOf(listener), 1)
	} as unknown as MaplibreMap;
	return {
		map,
		moveTo(next: Partial<typeof current>) {
			current = { ...current, ...next };
			for (const listener of [...listeners]) listener();
		},
		listening: () => listeners.length
	};
}

afterEach(cleanup);

describe('the data range notice', () => {
	it('says nothing while the data is in view', () => {
		const { map } = camera(15);
		render(MapRange, { map, mount: 'pipeline', extent: CITY, onShow: () => {} });
		expect(screen.queryByRole('status')).toBeNull();
	});

	it('says so when the camera moves out of the range, and goes when it is back', async () => {
		const view = camera(15);
		render(MapRange, { map: view.map, mount: 'pipeline', extent: CITY, onShow: () => {} });

		view.moveTo({ zoom: 11 });
		expect((await screen.findByRole('status')).textContent).toContain('The data is at z14–z16');

		view.moveTo({ zoom: 15 });
		await vi.waitFor(() => expect(screen.queryByRole('status')).toBeNull());
	});

	it('offers the way back', async () => {
		const onShow = vi.fn();
		render(MapRange, { map: camera(11).map, mount: 'pipeline', extent: CITY, onShow });
		await fireEvent.click(screen.getByRole('button', { name: 'Show the data' }));
		expect(onShow).toHaveBeenCalledOnce();
	});

	// Nothing built means nothing to look for, so an empty map says nothing here.
	it('says nothing with nothing built', () => {
		render(MapRange, { map: camera(3).map, mount: null, extent: null, onShow: () => {} });
		expect(screen.queryByRole('status')).toBeNull();
	});

	it('stops listening when it goes', () => {
		const view = camera(15);
		const shown = render(MapRange, { map: view.map, mount: 'pipeline', extent: CITY, onShow: () => {} });
		expect(view.listening()).toBe(1);
		shown.unmount();
		expect(view.listening()).toBe(0);
	});
});
