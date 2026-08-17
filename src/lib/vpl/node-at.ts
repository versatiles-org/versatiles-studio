/**
 * Finding the node a caret is in, and the path that names it.
 *
 * This walks the *already parsed* tree the core hands over, so it duplicates no grammar — the
 * parsing, the spans and the validation all stay in Rust ([Q23](../../../docs/decisions.md)). It
 * lives here because a caret moves on every keystroke, and a round trip per keypress to walk ten
 * nodes would be a poor trade.
 *
 * The path is the index at each level of nesting: `[1]` is the second node of the pipeline,
 * `[0, 1, 0]` is the first node of the second source of the first node.
 */

import type { Span, VplNode, VplPipeline } from '../ipc/commands';

export interface Located {
	path: number[];
	node: VplNode;
}

const contains = (span: Span, offset: number) => span.start <= offset && offset <= span.end;

/** The innermost node containing `offset`, or null when the caret is between nodes. */
export function nodeAt(pipeline: VplPipeline, offset: number): Located | null {
	for (const [index, node] of pipeline.nodes.entries()) {
		const found = nodeAtIn(node, offset);
		if (found) return { path: [index, ...found.path], node: found.node };
	}
	return null;
}

function nodeAtIn(node: VplNode, offset: number): Located | null {
	if (!contains(node.span, offset)) return null;
	// A nested pipeline wins over its parent: a caret inside a source block belongs to the node it
	// is written inside, not to the one that block feeds.
	for (const [index, source] of node.sources.entries()) {
		const found = nodeAt(source, offset);
		if (found) return { path: [index, ...found.path], node: found.node };
	}
	return { path: [], node };
}

/** Follows a path produced by {@link nodeAt}. */
export function nodeAtPath(pipeline: VplPipeline, path: number[]): VplNode | null {
	const [first, ...rest] = path;
	let node = pipeline.nodes[first];
	if (!node) return null;
	for (let i = 0; i < rest.length; i += 2) {
		const source = node.sources[rest[i]];
		const next = source?.nodes[rest[i + 1]];
		if (!next) return null;
		node = next;
	}
	return node;
}

export const samePath = (a: number[] | null, b: number[] | null): boolean =>
	a !== null && b !== null && a.length === b.length && a.every((value, i) => value === b[i]);

/** Every node in the pipeline, flattened, each with its path and how deeply it nests. */
export function walk(pipeline: VplPipeline, path: number[] = [], depth = 0): (Located & { depth: number })[] {
	return pipeline.nodes.flatMap((node, index) => {
		const here = [...path, index];
		// Sources are drawn above the node they feed, because that is the direction the tiles move.
		const nested = node.sources.flatMap((source, i) => walk(source, [...here, i], depth + 1));
		return [...nested, { path: here, node, depth }];
	});
}
