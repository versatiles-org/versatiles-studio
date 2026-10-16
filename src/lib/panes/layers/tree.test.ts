import { describe, expect, it } from 'vitest';
import { build, THEMES } from '../../map/builders';
import { currentPath } from '../../map/categories';
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
	it('turns colorful’s 253 layers into seven rows', () => {
		const [source] = tree(rowsOf(build('colorful', {})!));
		expect(source.count).toBe(253);
		expect(labels(source.children)).toEqual([
			'Background',
			'Land & water',
			'Airport',
			'Buildings',
			'Roads & rails',
			'Boundaries',
			'Labels'
		]);
		expect(counts(source.children)).toEqual([1, 35, 5, 2, 155, 7, 48]);
	});

	// Since v6 every Shortbread preset is one builder with a different palette, so the layers - and
	// with them the rows - are the same for all of them.
	it('turns every other Shortbread preset into the same seven', () => {
		const expected = labels(tree(rowsOf(build('colorful', {})!))[0].children);
		for (const preset of Object.keys(THEMES) as (keyof typeof THEMES)[]) {
			expect(labels(tree(rowsOf(build(preset, {})!))[0].children), preset).toEqual(expected);
		}
	});

	// The same table serves the other schemas: their builders name layers by what they draw, not by
	// the source-layer they read, so the prefixes are the same.
	it('files OpenMapTiles and Protomaps under the same seven, one run each', () => {
		for (const schema of ['openmaptiles', 'protomaps'] as const) {
			const children = tree(rowsOf(build('colorful', { tiles: 'x/{z}/{x}/{y}' }, {}, schema)!))[0].children;
			expect(labels(children), schema).toEqual(labels(tree(rowsOf(build('colorful', {})!))[0].children));
		}
	});

	// The property the whole design rests on: a node is a *range*, so dragging it moves a range. A
	// category that turned out not to be contiguous would be a row that cannot be moved as one.
	it('leaves every row a contiguous run of the paint order', () => {
		const rows = rowsOf(build('colorful', {})!);
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
		const rows = [...rowsOf(build('colorful', {})!), ...dataviz];
		expect(tree(rows).map((node) => node.label)).toEqual(['osm', 'dataviz']);
	});

	// The gesture the design exists for. Nothing tells this module that a split happened - the layers
	// arrive interleaved, and two runs is what interleaved layers *are*.
	it('shows a source drawn in two places as two rows', () => {
		const all = rowsOf(build('colorful', {})!);
		const isLabel = (row: Row) => ['label', 'marking', 'poi', 'symbol'].includes(row.ownId.split(/[-:.]/)[0]);
		const lifted = all.filter(isLabel);
		const rest = all.filter((row) => !isLabel(row));

		const stack = tree([...rest, ...dataviz, ...lifted]);
		expect(stack.map((node) => node.label)).toEqual(['osm', 'dataviz', 'osm']);
		expect(stack[2].count).toBe(48);
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

	/**
	 * **Projects written before v7 still say "Sites" and "Points of interest".** Both categories were
	 * folded into others, and an eye stored under either would otherwise cover nothing - the POIs back
	 * on, with no row left to switch them off from.
	 */
	it('still honours an eye stored under a category that was folded into another', () => {
		expect(hiddenBy('poi-amenity', ['Points of interest'])).toBe('Points of interest');
		expect(hiddenBy('site-hospital', ['Sites'])).toBe('Sites');
		expect(hiddenBy('site-hospital', ['Sites/site/hospital'])).toBe('Sites/site/hospital');
		// What it held, and nothing more: the rest of the category it joined stays on.
		expect(hiddenBy('label-place-city', ['Points of interest'])).toBeNull();
		expect(hiddenBy('land-forest', ['Sites'])).toBeNull();
	});

	it('reads such a path as where its layers are now', () => {
		expect(currentPath('Points of interest')).toBe('Labels/poi');
		expect(currentPath('Sites/site/education')).toBe('Land & water/site/education');
		expect(currentPath('Labels/label')).toBe('Labels/label');
	});
});
