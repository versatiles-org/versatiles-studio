import { describe, expect, it } from 'vitest';
import { colorful } from '@versatiles/style';
import { applyMoves, minimalMoves, planReorder } from './reorder';
import type { StyleSpecification } from 'maplibre-gl';

/** Replays the moves the way MapLibre would, so a plan can be checked by its result. */
function replay(before: string[], moves: { id: string; before: string | null }[]): string[] {
	const order = [...before];
	for (const move of moves) {
		order.splice(order.indexOf(move.id), 1);
		const at = move.before === null ? order.length : order.indexOf(move.before);
		order.splice(at, 0, move.id);
	}
	return order;
}

describe('minimalMoves', () => {
	it('has nothing to do when nothing moved', () => {
		expect(minimalMoves(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([]);
	});

	it('arrives at the order it was asked for', () => {
		const before = ['a', 'b', 'c', 'd', 'e'];
		const after = ['c', 'a', 'e', 'b', 'd'];
		expect(replay(before, minimalMoves(before, after))).toEqual(after);
	});

	it('moves the smaller side of a swap', () => {
		const before = ['a', 'b', 'c', 'd'];
		const after = ['d', 'a', 'b', 'c'];
		expect(minimalMoves(before, after)).toEqual([{ id: 'd', before: 'a' }]);
	});

	/**
	 * The measurement the whole module exists for, against the real preset.
	 *
	 * Lifting the labels of `colorful` above a three-layer source is **three** calls, because moving
	 * the three is the same picture as moving the thirty-three. The style spec's diff would issue 66
	 * commands for it, and each `addLayer` would put the source into `reload`.
	 */
	it('lifts a category of colorful past a small source in three calls', () => {
		const layers = colorful({}).layers.map((layer) => layer.id);
		const isLabel = (id: string) => ['label', 'marking', 'symbol'].includes(id.split(/[-:.]/)[0]);
		const data = ['data/a', 'data/b', 'data/c'];

		const before = [...layers, ...data];
		const after = [...layers.filter((id) => !isLabel(id)), ...data, ...layers.filter(isLabel)];

		const moves = minimalMoves(before, after);
		expect(moves.length).toBe(3);
		expect(replay(before, moves)).toEqual(after);
	});

	// The other direction: lifting the 231 road layers moves the 51 that are cheaper to move.
	it('takes 51 calls for the largest category, not 231', () => {
		const layers = colorful({}).layers.map((layer) => layer.id);
		const isRoad = (id: string) => ['tunnel', 'bridge', 'street', 'way', 'transport'].includes(id.split(/[-:.]/)[0]);
		const data = ['data/a', 'data/b', 'data/c'];

		const before = [...layers, ...data];
		const after = [...layers.filter((id) => !isRoad(id)), ...data, ...layers.filter(isRoad)];

		const moves = minimalMoves(before, after);
		expect(moves.length).toBe(51);
		expect(replay(before, moves)).toEqual(after);
	});
});

describe('planReorder', () => {
	const style = (ids: string[]): StyleSpecification =>
		({
			version: 8,
			sources: { s: { type: 'vector', tiles: ['x'] } },
			layers: ids.map((id) => ({ id, type: 'fill', source: 's', 'source-layer': 'l' }))
		}) as unknown as StyleSpecification;

	it('plans the moves when only the order changed', () => {
		const plan = planReorder(style(['a', 'b', 'c']), style(['c', 'a', 'b']));
		expect(plan?.moves).toEqual([{ id: 'c', before: 'a' }]);
	});

	// When in doubt, full: every one of these is `setStyle`'s, and being wrong the other way would
	// leave the map showing something nobody asked for.
	it('declines anything that is not the same layers in a new order', () => {
		expect(planReorder(null, style(['a']))).toBeNull();
		expect(planReorder(style(['a', 'b']), style(['a', 'b']))).toBeNull();
		expect(planReorder(style(['a', 'b']), style(['a', 'b', 'c']))).toBeNull();
		expect(planReorder(style(['a', 'b']), style(['a', 'c']))).toBeNull();

		const painted = style(['a', 'b']);
		painted.layers[0] = { ...painted.layers[0], paint: { 'fill-color': '#f00' } } as never;
		expect(planReorder(style(['a', 'b']), painted)).toBeNull();

		const moved = style(['b', 'a']);
		moved.sources = { s: { type: 'vector', tiles: ['y'] } } as never;
		expect(planReorder(style(['a', 'b']), moved)).toBeNull();
	});
});

describe('applyMoves', () => {
	it('calls moveLayer once per move, with the id to insert before', () => {
		const calls: [string, string | undefined][] = [];
		const map = { moveLayer: (id: string, before?: string) => calls.push([id, before]) };

		applyMoves(map as never, [
			{ id: 'a', before: 'b' },
			{ id: 'c', before: null }
		]);

		expect(calls).toEqual([
			['a', 'b'],
			['c', undefined]
		]);
	});
});
