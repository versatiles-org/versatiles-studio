import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeatMount } from '../ipc/commands';

/**
 * The heat map's state: what it draws, and that it keeps up with the selection (S14.3).
 */

const ipc = vi.hoisted(() => ({ mountHeat: vi.fn(), unmountHeat: vi.fn() }));
vi.mock('../ipc/commands', () => ipc);
vi.mock('../styles/tokens', () => ({ token: (name: string) => `colour of ${name}` }));

const { heat, squareLevel } = await import('./heat.svelte');

const mount = (deepest: number, max = 500_000): HeatMount => ({ tileUrl: `http://x/heat/${deepest}`, deepest, max });

beforeEach(async () => {
	vi.clearAllMocks();
	ipc.mountHeat.mockImplementation((_graph: number, deepest: number, _colours: string[], max: number) =>
		Promise.resolve(mount(deepest, max))
	);
	ipc.unmountHeat.mockResolvedValue(null);
	await heat.hide();
	await heat.setMax(500_000);
	vi.clearAllMocks();
});

describe('the heat map', () => {
	it('draws the source down to its deepest level, on the theme’s ramp up to 500 kB', async () => {
		await heat.show(1, 'build-a', 14);
		expect(heat.on).toBe(true);
		expect(heat.drawn).toEqual({ graph: 1, deepest: 14 });
		expect(ipc.mountHeat).toHaveBeenCalledWith(
			1,
			14,
			[1, 2, 3, 4, 5].map((stop) => `colour of --map-heat-${stop}`),
			500_000
		);
	});

	it('redraws when the maximum changes, and not when it does not', async () => {
		await heat.show(1, 'build-a', 14);
		await heat.setMax(50_000);
		expect(heat.max).toBe(50_000);
		expect(ipc.mountHeat).toHaveBeenLastCalledWith(1, 14, expect.any(Array), 50_000);
		ipc.mountHeat.mockClear();
		await heat.setMax(50_000);
		await heat.setMax(0);
		expect(ipc.mountHeat).not.toHaveBeenCalled();
		expect(heat.max).toBe(50_000);
	});

	/** A heat tile draws six levels below it, and never deeper than asked; raster tiles round. */
	it('says which level a square is at a map zoom', () => {
		expect(squareLevel(1, 14)).toBe(7);
		expect(squareLevel(1.6, 14)).toBe(8);
		expect(squareLevel(9, 14)).toBe(14);
		expect(squareLevel(3, 5)).toBe(5);
	});

	it('walks the deepest level within the source’s levels', async () => {
		await heat.show(1, 'build-a', 14);
		await heat.step(-1, 4, 14);
		expect(heat.drawn?.deepest).toBe(13);
		await heat.step(5, 4, 14);
		expect(heat.drawn?.deepest).toBe(14);
		ipc.mountHeat.mockClear();
		await heat.step(1, 4, 14);
		expect(ipc.mountHeat).not.toHaveBeenCalled();
	});

	it('follows the selection, and a rebuild, but only while it is on', async () => {
		await heat.follow(2, 'build-b', 12);
		expect(ipc.mountHeat).not.toHaveBeenCalled();

		await heat.show(1, 'build-a', 14);
		await heat.follow(2, 'build-b', 12);
		expect(heat.drawn).toEqual({ graph: 2, deepest: 12 });
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
		expect(heat.drawn).toEqual({ graph: 2, deepest: 9 });
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
