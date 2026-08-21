import { describe, expect, it } from 'vitest';
import { grouped, matching, pickable, type PickerItem } from './picker';

const OPERATIONS: PickerItem[] = [
	{ value: 'filter', description: 'Narrows the tiles', group: 'Fits these tiles' },
	{ value: 'vector_filter_layers', description: 'Keeps named layers', group: 'Fits these tiles' },
	{
		value: 'raster_flatten',
		unavailable: '`raster_flatten` needs raster tiles; this source is mvt',
		group: 'Not for these tiles'
	},
	{
		value: 'raster_tile_resize',
		unavailable: '`raster_tile_resize` needs raster tiles; this source is mvt',
		group: 'Not for these tiles'
	}
];

describe('matching', () => {
	it('finds an operation by a fragment of its name', () => {
		expect(matching(OPERATIONS, 'layers').map((i) => i.value)).toEqual(['vector_filter_layers']);
	});

	it('is case-insensitive, because a name is half-remembered', () => {
		expect(matching(OPERATIONS, 'RASTER_FLAT').map((i) => i.value)).toEqual(['raster_flatten']);
	});

	// The reason is searchable too: someone looking for what to do about raster tiles should find
	// the operations refused for wanting them.
	it('searches the description and the refusal, not only the name', () => {
		expect(matching(OPERATIONS, 'narrows').map((i) => i.value)).toEqual(['filter']);
		expect(matching(OPERATIONS, 'needs raster').map((i) => i.value)).toEqual(['raster_flatten', 'raster_tile_resize']);
	});

	it('an empty query is everything, and whitespace is an empty query', () => {
		expect(matching(OPERATIONS, '')).toHaveLength(4);
		expect(matching(OPERATIONS, '   ')).toHaveLength(4);
	});

	it('returns nothing rather than everything when nothing matches', () => {
		expect(matching(OPERATIONS, 'zzz')).toEqual([]);
	});
});

describe('grouped', () => {
	it('draws a heading where it changes and keeps the caller’s order', () => {
		const groups = grouped(OPERATIONS);
		expect(groups.map((g) => g.name)).toEqual(['Fits these tiles', 'Not for these tiles']);
		expect(groups[0].items.map((i) => i.value)).toEqual(['filter', 'vector_filter_layers']);
	});

	// The failure this guards: bucketing by name would pull the second `a` up beside the first and
	// silently reorder a list whose order the caller chose.
	it('does not gather rows that share a heading but are not adjacent', () => {
		const groups = grouped([
			{ value: 'one', group: 'a' },
			{ value: 'two', group: 'b' },
			{ value: 'three', group: 'a' }
		]);
		expect(groups.map((g) => g.name)).toEqual(['a', 'b', 'a']);
		expect(groups.flatMap((g) => g.items.map((i) => i.value))).toEqual(['one', 'two', 'three']);
	});

	it('ungrouped items form a run with no heading', () => {
		const groups = grouped([{ value: 'one' }, { value: 'two' }]);
		expect(groups).toHaveLength(1);
		expect(groups[0].name).toBeNull();
	});

	it('has nothing to draw for nothing', () => {
		expect(grouped([])).toEqual([]);
	});
});

describe('pickable', () => {
	it('is what the arrow keys walk — the unavailable rows are shown, not visited', () => {
		expect(pickable(OPERATIONS).map((i) => i.value)).toEqual(['filter', 'vector_filter_layers']);
	});
});
