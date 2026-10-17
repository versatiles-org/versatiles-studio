import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeatMount } from '../ipc/commands';

/**
 * The heat map's state: what it draws, and that it keeps up with the selection (S14.3).
 */

const ipc = vi.hoisted(() => ({ mountHeat: vi.fn(), unmountHeat: vi.fn() }));
vi.mock('../ipc/commands', () => ipc);
vi.mock('../styles/tokens', () => ({ token: (name: string) => `colour of ${name}` }));

const { heat } = await import('./heat.svelte');

const mount = (detail: number): HeatMount => ({
	tileUrl: `http://x/heat/${detail}`,
	minZoom: detail - 10,
	maxZoom: detail,
	bands: [50_000, 200_000, 500_000]
});

beforeEach(async () => {
	vi.clearAllMocks();
	ipc.mountHeat.mockImplementation((_graph: number, detail: number) => Promise.resolve(mount(detail)));
	ipc.unmountHeat.mockResolvedValue(null);
	await heat.hide();
	vi.clearAllMocks();
});

describe('the heat map', () => {
	it('draws the source at its deepest level, in the theme’s four colours', async () => {
		await heat.show(1, 'build-a', 14);
		expect(heat.on).toBe(true);
		expect(heat.drawn).toEqual({ graph: 1, detail: 14 });
		expect(ipc.mountHeat).toHaveBeenCalledWith(1, 14, [
			'colour of --map-heat-1',
			'colour of --map-heat-2',
			'colour of --map-heat-3',
			'colour of --map-heat-4'
		]);
	});

	it('walks the detail level within the source’s levels', async () => {
		await heat.show(1, 'build-a', 14);
		await heat.step(-1, 4, 14);
		expect(heat.drawn?.detail).toBe(13);
		await heat.step(5, 4, 14);
		expect(heat.drawn?.detail).toBe(14);
		ipc.mountHeat.mockClear();
		await heat.step(1, 4, 14);
		expect(ipc.mountHeat).not.toHaveBeenCalled();
	});

	it('follows the selection, and a rebuild, but only while it is on', async () => {
		await heat.follow(2, 'build-b', 12);
		expect(ipc.mountHeat).not.toHaveBeenCalled();

		await heat.show(1, 'build-a', 14);
		await heat.follow(2, 'build-b', 12);
		expect(heat.drawn).toEqual({ graph: 2, detail: 12 });
		await heat.follow(2, 'build-c', 12);
		expect(ipc.mountHeat).toHaveBeenCalledTimes(3);
		await heat.follow(2, 'build-c', 12);
		expect(ipc.mountHeat).toHaveBeenCalledTimes(3);
	});

	/** Selecting three sources quickly sends three mounts; the last one asked is the one that counts. */
	it('drops an answer that a newer request has overtaken', async () => {
		let slow: (value: HeatMount) => void = () => {};
		ipc.mountHeat.mockImplementationOnce(() => new Promise((resolve) => (slow = resolve)));
		const first = heat.show(1, 'build-a', 14);
		await heat.follow(2, 'build-b', 9);
		slow(mount(14));
		await first;
		expect(heat.drawn).toEqual({ graph: 2, detail: 9 });
	});

	it('says why a source has none, and takes its mount down when switched off', async () => {
		ipc.mountHeat.mockRejectedValueOnce(new Error('no index'));
		await heat.show(1, 'build-a', 14);
		expect(heat.error).toBe('no index');
		expect(heat.mount).toBeNull();

		await heat.follow(1, 'build-b', 14);
		await heat.hide();
		expect(heat.on).toBe(false);
		expect(ipc.unmountHeat).toHaveBeenCalledWith(1);
	});
});
