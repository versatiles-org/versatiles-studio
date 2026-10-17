// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

// A marker needs a real map; what is asserted is that one is placed, and where.
const markers: { at?: unknown; removed: boolean }[] = [];
vi.mock('maplibre-gl', () => ({
	Marker: class {
		record = { at: undefined as unknown, removed: false };
		constructor() {
			markers.push(this.record);
		}
		setLngLat(at: unknown) {
			this.record.at = at;
			return this;
		}
		addTo() {
			return this;
		}
		remove() {
			this.record.removed = true;
		}
	}
}));

const { default: SearchBox } = await import('./SearchBox.svelte');

afterEach(() => {
	cleanup();
	markers.length = 0;
});

function fakeMap() {
	return {
		getCenter: () => ({ lng: 13.4, lat: 52.5 }),
		getZoom: () => 10,
		flyTo: vi.fn(),
		fitBounds: vi.fn()
	};
}

function show(search = vi.fn().mockResolvedValue([])) {
	const map = fakeMap();
	render(SearchBox, { map, search } as never);
	return { map, search, field: screen.getByRole('combobox') as HTMLInputElement };
}

async function type(field: HTMLInputElement, text: string) {
	await fireEvent.input(field, { target: { value: text } });
}

const options = () => screen.queryAllByRole('option').map((option) => option.textContent?.replace(/\s+/g, ' ').trim());

describe('what it reads without asking anyone', () => {
	// The point of the list: the reading is on screen before anything moves.
	it('lists both readings of a coordinate pair, and goes nowhere until one is picked', async () => {
		const { map, field, search } = show();
		await type(field, '52.52, 13.40');
		expect(options()).toEqual([
			'⌖ 52.52° N, 13.4° E read as latitude, longitude',
			'⌖ 13.4° N, 52.52° E read as longitude, latitude'
		]);
		expect(map.flyTo).not.toHaveBeenCalled();
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(search, 'a coordinate never leaves the machine').not.toHaveBeenCalled();
	});

	it('goes to the first on Enter, and marks the spot', async () => {
		const { map, field } = show();
		await type(field, '52.52, 13.40');
		await fireEvent.keyDown(field, { key: 'Enter' });
		expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [13.4, 52.52] }));
		expect(markers.map((marker) => marker.at)).toEqual([[13.4, 52.52]]);
	});

	it('takes the other reading with the arrow key', async () => {
		const { map, field } = show();
		await type(field, '52.52, 13.40');
		await fireEvent.keyDown(field, { key: 'ArrowDown' });
		await fireEvent.keyDown(field, { key: 'Enter' });
		expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [52.52, 13.4] }));
	});

	// A tile is its own outline - the grid draws it - so it fits the view and leaves no pin.
	it('fits a tile to the view, without a marker', async () => {
		const { map, field } = show();
		await type(field, '12/2200/1343');
		await fireEvent.keyDown(field, { key: 'Enter' });
		expect(map.fitBounds).toHaveBeenCalledTimes(1);
		expect(markers).toEqual([]);
	});
});

describe('places', () => {
	const BERLIN = {
		type: 'place' as const,
		title: 'Berlin',
		context: 'Germany',
		target: { kind: 'point' as const, center: [13.4, 52.5] as [number, number], zoom: 11 },
		marker: true
	};

	it('asks the geocoder once the typing pauses, near where the map is', async () => {
		const { field, search } = show(vi.fn().mockResolvedValue([BERLIN]));
		await type(field, 'Ber');
		await type(field, 'Berl');
		await type(field, 'Berlin');
		await vi.waitFor(() => expect(options()).toEqual(['⌂ Berlin Germany']));
		expect(search).toHaveBeenCalledTimes(1);
		expect(search).toHaveBeenCalledWith('Berlin', { lng: 13.4, lat: 52.5 }, expect.anything());
	});

	// The chosen title stays in the field to say where you are - not as a new query.
	it('does not search again for what was just chosen', async () => {
		const { field, search } = show(vi.fn().mockResolvedValue([BERLIN]));
		await type(field, 'Berlin');
		await vi.waitFor(() => expect(options()).toHaveLength(1));
		await fireEvent.keyDown(field, { key: 'Enter' });
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(search).toHaveBeenCalledTimes(1);
	});

	// Offline is a state Studio works in, and "nothing found" would be a lie about it.
	it('says when the geocoder cannot be reached', async () => {
		const { field } = show(vi.fn().mockRejectedValue(new TypeError('offline')));
		await type(field, 'Berlin');
		expect(await screen.findByText(/unavailable - Studio may be offline/)).toBeTruthy();
	});

	it('says when there is nothing to find', async () => {
		const { field } = show();
		await type(field, 'Xyzzyville');
		expect(await screen.findByText('Nothing found')).toBeTruthy();
	});
});

it('clears the text and the marker on a second Escape', async () => {
	const { field } = show();
	await type(field, '13.40, 52.52');
	await fireEvent.keyDown(field, { key: 'Enter' });
	await fireEvent.keyDown(field, { key: 'Escape' });
	expect(field.value).toBe('');
	expect(markers[0].removed).toBe(true);
});

describe('the hint', () => {
	const hint = () => screen.getByRole('tooltip', { hidden: true });

	it('describes the field, in place of a native title', () => {
		const { field } = show();
		expect(field.getAttribute('aria-describedby')).toBe(hint().id);
		expect(field.hasAttribute('title')).toBe(false);
		expect(hint().textContent).toContain('52.52, 13.40');
	});

	it('shows while the field is focused and empty, and is not there before', async () => {
		const { field } = show();
		expect(hint().hidden).toBe(true);
		await fireEvent.focus(field);
		expect(hint().hidden).toBe(false);
	});

	// The list sits where the hint does, and says more.
	it('gives way to the result list', async () => {
		const { field } = show();
		await fireEvent.focus(field);
		await type(field, '12/2200/1343');
		expect(options()).toHaveLength(1);
		expect(hint().hidden).toBe(true);
	});

	it('goes away on Escape', async () => {
		const { field } = show();
		await fireEvent.focus(field);
		await fireEvent.keyDown(field, { key: 'Escape' });
		expect(hint().hidden).toBe(true);
	});
});
