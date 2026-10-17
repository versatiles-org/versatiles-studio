// @vitest-environment jsdom

/**
 * What the heat map's legend says (S14.3).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import HeatLegend from './HeatLegend.svelte';

afterEach(cleanup);

const base = { source: 'berlin', bands: [50_000, 200_000, 500_000], detail: 14, minZoom: 4, zoom: 8 };

describe('the heat map legend', () => {
	it('names the four bands from the core’s numbers, and the level a square is a tile of', () => {
		render(HeatLegend, base);
		expect(screen.getAllByRole('listitem').map((item) => item.textContent?.trim())).toEqual([
			'under 50 kB',
			'under 200 kB',
			'under 500 kB',
			'500 kB and over'
		]);
		expect(screen.getByText(/each square a tile of zoom 14/)).toBeTruthy();
	});

	it('says to zoom in when the map is too far out to draw anything', () => {
		render(HeatLegend, { ...base, zoom: 3 });
		expect(screen.getByText('Zoom in to 4 or closer to see the squares.')).toBeTruthy();
	});

	it('shows the detail level’s figures when the source has been measured', () => {
		render(HeatLegend, {
			...base,
			figures: { level: 14, tiles: 9, bytes: 9, p50: 12_000, p95: 340_000, max: 610_000 }
		});
		expect(screen.getByText('340 kB')).toBeTruthy();
		expect(screen.getByText('610 kB')).toBeTruthy();
	});

	it('says why there is no heat map instead of a key to nothing', () => {
		render(HeatLegend, { ...base, error: 'this source transforms its tiles' });
		expect(screen.getByText('this source transforms its tiles')).toBeTruthy();
		expect(screen.queryAllByRole('listitem')).toHaveLength(0);
	});
});
