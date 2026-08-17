import { describe, expect, it } from 'vitest';
import { nodeAt, nodeAtPath, samePath, walk } from './node-at';
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
	/** Sources come before the node they feed, and one level deeper — the order tiles move in. */
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
