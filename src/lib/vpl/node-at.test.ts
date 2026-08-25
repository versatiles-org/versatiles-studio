import { describe, expect, it } from 'vitest';
import { isChainHead, isOn, nodeAt, nodeAtPath, samePath, selectionSurvives, walk } from './node-at';
import type { VplNode, VplPipeline } from '../ipc/commands';

/** A minimal node, positioned. Only the fields these functions read. */
function node(name: string, start: number, end: number, sources: VplPipeline[] = []): VplNode {
	return {
		name,
		nameSpan: { start, end: start + name.length },
		properties: [],
		sources,
		sourcesSpan: null,
		span: { start, end }
	};
}

const pipeline = (nodes: VplNode[]): VplPipeline => ({
	nodes,
	span: { start: nodes[0]?.span.start ?? 0, end: nodes.at(-1)?.span.end ?? 0 }
});

//  merge [ read(10..14), write(16..21) ] | tile_convert(25..37)
const nested = pipeline([
	node('merge', 0, 23, [pipeline([node('read', 10, 14), node('write', 16, 21)])]),
	node('tile_convert', 25, 37)
]);

describe('nodeAt', () => {
	it('finds the node a caret sits in', () => {
		expect(nodeAt(nested, 2)?.node.name).toBe('merge');
		expect(nodeAt(nested, 30)?.node.name).toBe('tile_convert');
	});

	it('prefers the nested node over the one it feeds', () => {
		expect(nodeAt(nested, 12)?.node.name).toBe('read');
		expect(nodeAt(nested, 18)?.node.name).toBe('write');
	});

	it('counts the end of a span as inside it, because a caret just past a name still means it', () => {
		expect(nodeAt(nested, 14)?.node.name).toBe('read');
		expect(nodeAt(nested, 37)?.node.name).toBe('tile_convert');
	});

	it('returns null between nodes', () => {
		expect(nodeAt(nested, 24)).toBeNull();
	});

	it('produces a path that finds the same node again', () => {
		for (const offset of [2, 12, 18, 30]) {
			const found = nodeAt(nested, offset);
			expect(found).not.toBeNull();
			expect(nodeAtPath(nested, found!.path)?.name).toBe(found!.node.name);
		}
	});

	it('rejects a path that no longer resolves', () => {
		expect(nodeAtPath(nested, [9])).toBeNull();
		expect(nodeAtPath(nested, [0, 0, 9])).toBeNull();
		expect(nodeAtPath(nested, [])).toBeNull();
	});
});

describe('walk', () => {
	/** Sources come before the node they feed, and one level deeper - the order tiles move in. */
	it('lists sources before the node they feed', () => {
		expect(walk(nested).map((entry) => [entry.node.name, entry.depth])).toEqual([
			['read', 1],
			['write', 1],
			['merge', 0],
			['tile_convert', 0]
		]);
	});

	it('gives every entry a path that resolves', () => {
		for (const entry of walk(nested)) {
			expect(nodeAtPath(nested, entry.path)?.name).toBe(entry.node.name);
		}
	});
});

describe('samePath', () => {
	it('compares by value and treats null as never equal', () => {
		expect(samePath([0, 1], [0, 1])).toBe(true);
		expect(samePath([0, 1], [0, 2])).toBe(false);
		expect(samePath([0], [0, 1])).toBe(false);
		expect(samePath(null, null)).toBe(false);
	});
});

describe('isChainHead', () => {
	it('is the first node at the top level, and only that one', () => {
		expect(isChainHead([0])).toBe(true);
		expect(isChainHead([1])).toBe(false);
	});

	/**
	 * The bug this predicate replaced: `name.startsWith('from_')` marked every read node as the
	 * head, so both sources of a `from_stacked [ a, b ]` lost their `×` and neither could be
	 * removed outside the VPL tab.
	 */
	it('is not the read nodes nested inside a composite', () => {
		const stack = pipeline([
			node('from_stacked', 0, 40, [pipeline([node('from_container', 14, 20), node('from_container', 22, 28)])]),
			node('filter', 43, 49)
		]);

		const heads = walk(stack).filter((row) => isChainHead(row.path));
		expect(heads.map((row) => row.node.name)).toEqual(['from_stacked']);
	});
});

describe('selectionSurvives', () => {
	const doc = (graph: number, pipe: VplPipeline) => ({ graph, pipeline: pipe });

	it('holds when the same graph still has that node', () => {
		expect(selectionSurvives([1], 7, doc(7, nested))).toBe(true);
	});

	/** The undo-across-graphs case: one stack, so a step can land in a graph nobody was looking at. */
	it('is lost when the document belongs to another graph', () => {
		expect(selectionSurvives([1], 7, doc(9, nested))).toBe(false);
	});

	/** Undoing the insertion that created the selected node. */
	it('is lost when the path no longer resolves', () => {
		const shorter = pipeline([node('merge', 0, 23)]);
		expect(selectionSurvives([1], 7, doc(7, shorter))).toBe(false);
	});

	it('is trivially lost when nothing was selected', () => {
		expect(selectionSurvives(null, 7, doc(7, nested))).toBe(false);
	});
});

describe('isOn', () => {
	/// **Every node answers for itself** ([Q49]). This replaced `feedsPreview`, which asked whether
	/// a node reached the pin - so one node switched off darkened everything after it, and one
	/// branch of a composite darkened its sibling. A bypass skips a node; it does not cut a chain.
	it('is on for everything when nothing is switched off', () => {
		expect(isOn([0], [])).toBe(true);
		expect(isOn([4, 1, 2], [])).toBe(true);
	});

	it('is off only for the node that was switched off', () => {
		const off = [[2]];
		expect(isOn([1], off)).toBe(true);
		expect(isOn([2], off)).toBe(false);
		expect(isOn([3], off), 'what comes after a bypassed node still runs').toBe(true);
	});

	it('leaves the other branch of a composite alone', () => {
		const off = [[0, 0, 1]];
		expect(isOn([0, 0, 1], off)).toBe(false);
		expect(isOn([0, 1, 0], off)).toBe(true);
		expect(isOn([0], off), 'the composite still runs, with one source fewer').toBe(true);
	});
});
