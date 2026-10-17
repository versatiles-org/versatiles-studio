// @vitest-environment jsdom

/**
 * What the heat map's legend says, and what it sets (S14.3).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import HeatLegend from './HeatLegend.svelte';

afterEach(cleanup);

const base = { source: 'berlin', deepest: 14, zoom: 8, max: 500_000, opacity: 0.75, only: false };

describe('the heat map legend', () => {
	it('runs the ramp from nought to the maximum, and names the level a square is', () => {
		render(HeatLegend, base);
		expect(screen.getByText('0')).toBeTruthy();
		expect(screen.getByText('500 kB and over')).toBeTruthy();
		expect(screen.getByText(/each square a tile of zoom 14/)).toBeTruthy();
	});

	/** Far out, a square is a tile six levels below the map's, not the deepest level. */
	it('names a shallower level when the map is zoomed out', () => {
		render(HeatLegend, { ...base, zoom: 1 });
		expect(screen.getByText(/each square a tile of zoom 7/)).toBeTruthy();
	});

	it('sets the maximum in kilobytes, the opacity, and the heat map alone', async () => {
		const onMax = vi.fn();
		const onOpacity = vi.fn();
		const onOnly = vi.fn();
		render(HeatLegend, { ...base, onMax, onOpacity, onOnly });

		const maximum = screen.getByRole('spinbutton', { name: /Maximum/ }) as HTMLInputElement;
		expect(maximum.value).toBe('500');
		await fireEvent.change(maximum, { target: { value: '50' } });
		expect(onMax).toHaveBeenCalledWith(50_000);
		await fireEvent.change(maximum, { target: { value: '0' } });
		expect(onMax).toHaveBeenCalledOnce();
		expect(maximum.value).toBe('500');

		await fireEvent.input(screen.getByRole('slider', { name: /Opacity/ }), { target: { value: '40' } });
		expect(onOpacity).toHaveBeenCalledWith(0.4);

		await fireEvent.click(screen.getByRole('checkbox', { name: 'Heat map only' }));
		expect(onOnly).toHaveBeenCalledWith(true);
	});

	it('shows the figures when the source has been measured', () => {
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
		expect(screen.queryByRole('checkbox')).toBeNull();
	});
});
