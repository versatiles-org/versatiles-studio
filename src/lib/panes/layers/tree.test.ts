import { describe, expect, it } from 'vitest';
import { colorful, neutrino } from '@versatiles/style';
import { ancestors, hiddenBy, tree, type Group, type Node, type Row } from './tree';

/**
 * **Read from the real presets, not from a fixture.** The category table is a claim about what
 * `@versatiles/style` produces, and a fixture would only ever assert that the claim was copied
 * correctly once. A preset that grows a prefix has to fail here rather than quietly appear as a
 * category of its own.
 */
const rowsOf = (style: { layers: { id: string; type: string }[] }, source = 'osm'): Row[] =>
	style.layers.map((layer) => ({ id: `${source}/${layer.id}`, ownId: layer.id, source, type: layer.type }));

const labels = (nodes: Node[]) => nodes.map((node) => (node.kind === 'group' ? node.label : node.ownId));
const counts = (nodes: Node[]) => nodes.map((node) => (node.kind === 'group' ? node.count : 1));

/** Every layer under a node, in order - what the node would move if it were dragged. */
const flatten = (node: Node): string[] => (node.kind === 'layer' ? [node.ownId] : node.children.flatMap(flatten));

describe('the categories a preset collapses to', () => {
	it('turns colorful’s 324 layers into nine rows', () => {
		const [source] = tree(rowsOf(colorful({})));
		expect(source.count).toBe(324);
		expect(labels(source.children)).toEqual([
			'Background',
			'Land & water',
			'Sites',
			'Airport',
			'Buildings',
			'Roads & rails',
			'Points of interest',
			'Boundaries',
			'Labels'
		]);
		expect(counts(source.children)).toEqual([1, 28, 9, 5, 2, 231, 9, 6, 33]);
	});

	it('turns neutrino’s 207 into seven', () => {
		const [source] = tree(rowsOf(neutrino({})));
		expect(source.count).toBe(207);
		expect(labels(source.children)).toEqual([
			'Background',
			'Land & water',
			'Sites',
			'Buildings',
			'Roads & rails',
			'Boundaries',
			'Labels'
		]);
	});

	// The property the whole design rests on: a node is a *range*, so dragging it moves a range. A
	// category that turned out not to be contiguous would be a row that cannot be moved as one.
	it('leaves every row a contiguous run of the paint order', () => {
		const rows = rowsOf(colorful({}));
		const [source] = tree(rows);
		const painted = rows.map((row) => row.ownId);

		let at = 0;
		for (const child of source.children) {
			const covered = flatten(child);
			expect(painted.slice(at, at + covered.length)).toEqual(covered);
			at += covered.length;
		}
		expect(at).toBe(painted.length);
	});
});

describe('the stack', () => {
	const dataviz: Row[] = [{ id: 'dataviz/cases', ownId: 'cases', source: 'dataviz', type: 'fill' }];

	it('has one row per source, in paint order', () => {
		const rows = [...rowsOf(colorful({})), ...dataviz];
		expect(tree(rows).map((node) => node.label)).toEqual(['osm', 'dataviz']);
	});

	// The gesture the design exists for. Nothing tells this module that a split happened - the layers
	// arrive interleaved, and two runs is what interleaved layers *are*.
	it('shows a source drawn in two places as two rows', () => {
		const all = rowsOf(colorful({}));
		const isLabel = (row: Row) => ['label', 'marking', 'symbol'].includes(row.ownId.split(/[-:.]/)[0]);
		const lifted = all.filter(isLabel);
		const rest = all.filter((row) => !isLabel(row));

		const stack = tree([...rest, ...dataviz, ...lifted]);
		expect(stack.map((node) => node.label)).toEqual(['osm', 'dataviz', 'osm']);
		expect(stack[2].count).toBe(33);
		expect(labels(stack[2].children)).toEqual(['Labels']);
		// What a segment starting here would name, which is the first layer of the run.
		expect(stack[2].from).toBe('label-address-housenumber');
	});
});

describe('an id no category claims', () => {
	// A derived style, a third-party preset, or a preset that grew a prefix: the tree falls back to
	// the id's own first component rather than to a category that would be a guess.
	it('keeps its raw path, and puts the tile layer one level down', () => {
		const rows: Row[] = [
			{ id: 'c/derived:water_polygons', ownId: 'derived:water_polygons', source: 'c', type: 'fill' },
			{ id: 'c/derived:water_polygons:edge', ownId: 'derived:water_polygons:edge', source: 'c', type: 'line' },
			{ id: 'c/derived:buildings', ownId: 'derived:buildings', source: 'c', type: 'fill' }
		];

		const [source] = tree(rows);
		expect(labels(source.children)).toEqual(['derived']);
		const derived = source.children[0] as Group;
		expect(labels(derived.children)).toEqual(['water_polygons', 'derived:buildings']);
	});
});

describe('what an eye covers', () => {
	it('names every path that would hide a layer, nearest first', () => {
		expect(ancestors('label-place-city')).toEqual([
			'Labels/label/place/city',
			'Labels/label/place',
			'Labels/label',
			'Labels'
		]);
	});

	it('says which eye is the one that closed', () => {
		expect(hiddenBy('label-place-city', ['Labels'])).toBe('Labels');
		expect(hiddenBy('label-place-city', ['Labels/label/place'])).toBe('Labels/label/place');
		// The nearer eye wins, because that is the one a person would press to undo it.
		expect(hiddenBy('label-place-city', ['Labels', 'Labels/label/place'])).toBe('Labels/label/place');
		expect(hiddenBy('street-motorway', ['Labels'])).toBeNull();
	});
});
