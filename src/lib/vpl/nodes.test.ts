import { describe, expect, it } from 'vitest';
import { isChainHead, isOn, samePath, walk } from './nodes';
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

	/**
	 * The paths themselves, written out.
	 *
	 * They are what `set_node_enabled` is called with, so the core reads them the same way: a node
	 * index, then a pair of source index and node index per level of nesting. Asserting the values
	 * rather than round-tripping them through a resolver here is what makes this a check on the
	 * spelling the two ends agree on rather than on this file being self-consistent.
	 */
	it('names each node by the path the core reads', () => {
		expect(walk(nested).map((entry) => [entry.node.name, entry.path])).toEqual([
			['read', [0, 0, 0]],
			['write', [0, 0, 1]],
			['merge', [0]],
			['tile_convert', [1]]
		]);
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
