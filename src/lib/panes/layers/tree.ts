/**
 * The map's paint stack, as a tree ([the layer stack](../../../../docs/layers.md)).
 *
 * Three levels under each run of a source: the **category** a layer is about, the path in its own
 * id, and the layer. `osm ▸ Labels ▸ label ▸ place ▸ city`.
 *
 * **Runs, not buckets** - the rule `panes/style/layer-tree.ts` already applied one level up, and the
 * reason it is load-bearing here. Prefixes taken globally are not faithful to paint order: in
 * `colorful`, `label` spans positions 291-323 with `marking-oneway` and seven `symbol-transit-*`
 * inside that span. So every node is a run of *consecutive* layers, and a name may legitimately
 * appear twice with something else between - honestly, because those layers really are painted at
 * different depths. A tree over buckets would describe a map that is not on screen.
 *
 * That is also what makes the whole thing draggable: **every node is a contiguous range**, so moving
 * one is moving a range, and the boundary it would become is the own id of its first layer.
 *
 * **The top level is read from the paint order, not from the segments.** A source drawn in two
 * places arrives here as two runs because that is what its layers do; nothing has to tell this
 * module that a split happened, and nothing can tell it one happened when it did not.
 *
 * **What is not here: the background.** It is a map control rather than a row in the stack, so the
 * caller passes the rows it wants shown and leaves the background's out.
 */

import { componentAt } from '../../map/categories';

// `ancestors` and `hiddenBy` live beside the table in `map/categories.ts`: composition needs the
// same rule, and a pane is the wrong direction for `map/` to import from.
export { ancestors, hiddenBy } from '../../map/categories';

/** One layer of the composed style, with what the tree needs to file it. */
export interface Row {
	/** The id in the composed style - prefixed when more than one source draws. */
	id: string;
	/** The id in the source's own style, which is what an override and a boundary are keyed on. */
	ownId: string;
	/** The graph this layer was contributed by. */
	source: string;
	/** MapLibre's layer type, for the icon and for knowing which paint key to colour. */
	type: string;
}

/** A single layer. */
export interface Leaf extends Row {
	kind: 'layer';
}

/** A run of consecutive layers that share a source and a path. */
export interface Group {
	kind: 'group';
	/** What it is called: a category, an id component, or a source name at the top level. */
	label: string;
	/**
	 * Its path within the source, which is what an eye is stored as - `Labels/label/place`.
	 *
	 * Empty at the top level, where the node is the whole source and its eye is the source's own.
	 * **Not unique**: a category split across two places is two nodes with one path, which is what
	 * makes one eye hide both parts.
	 */
	path: string;
	source: string;
	children: Node[];
	/** How many layers are under it, at any depth. */
	count: number;
	/** The own id of its first layer - the boundary a segment starting here would name. */
	from: string;
}

export type Node = Group | Leaf;

/** Groups consecutive items that answer `key` alike. */
function runs<T>(items: T[], key: (item: T) => string): { key: string; items: T[] }[] {
	const out: { key: string; items: T[] }[] = [];
	for (const item of items) {
		const k = key(item);
		const last = out.at(-1);
		if (last && last.key === k) last.items.push(item);
		else out.push({ key: k, items: [item] });
	}
	return out;
}

/**
 * The key for a layer that has no component left at this depth.
 *
 * **It has to be a run of its own, not a skipped item.** `boundary-country` and
 * `boundary-country:outline` sit side by side, and dropping the shorter one because it has nothing
 * at that depth would leave the tree describing 323 of 324 layers - with the count still saying 324.
 */
const ITSELF = '\u0000';

/** Builds the nodes below `path`, splitting by the component at `depth` and recursing. */
function below(rows: Row[], source: string, path: string, depth: number): Node[] {
	const grouped = runs(rows, (row) => componentAt(row.ownId, depth) ?? ITSELF);
	const out: Node[] = [];

	for (const run of grouped) {
		// A layer with nothing left of its id is the leaf it always was.
		if (run.key === ITSELF) {
			out.push(...run.items.map((row): Leaf => ({ kind: 'layer', ...row })));
			continue;
		}
		const here = path ? `${path}/${run.key}` : run.key;
		// One layer under a name is that layer, not a box holding it - a tree that makes you open
		// `label ▸ place ▸ city` to reach one row is a tree that costs three clicks to say nothing.
		//
		// **Except at the top of a source**, where the categories are the rows a person reads down.
		// A category holding one layer that appeared as that layer would put `background` in a list
		// of nine headings, which reads as a mistake even though it is the same nine rows.
		const deeper = run.items.some((row) => componentAt(row.ownId, depth + 1) !== null);
		if (depth > 0 && (run.items.length === 1 || !deeper)) {
			out.push(...run.items.map((row): Leaf => ({ kind: 'layer', ...row })));
			continue;
		}
		out.push({
			kind: 'group',
			label: run.key,
			path: here,
			source,
			children: below(run.items, source, here, depth + 1),
			count: run.items.length,
			from: run.items[0].ownId
		});
	}

	return out;
}

/**
 * The stack as a tree, bottom of the map first - the order the rows are drawn in.
 *
 * The top level is one node per run of a source, so a source drawn in two places appears twice. Its
 * `path` is empty: that row's eye is the source's own, and the paths below it are what
 * `SourceStyle.hidden` stores.
 */
export function tree(rows: Row[]): Group[] {
	return runs(rows, (row) => row.source).map(({ key, items }) => ({
		kind: 'group' as const,
		label: key,
		path: '',
		source: key,
		children: below(items, key, '', 0),
		count: items.length,
		from: items[0].ownId
	}));
}
