/**
 * What is asked about a pipeline's nodes: which there are, whether each runs, what is wrong with it.
 *
 * These read the *already parsed* tree the core hands over, so they duplicate no grammar - the
 * parsing, the spans and the validation all stay in Rust ([Q23](../../../docs/decisions.md)). They
 * live here because the chain is redrawn on every keystroke, and a round trip per keypress to ask
 * about ten nodes would be a poor trade.
 *
 * The path is the index at each level of nesting: `[1]` is the second node of the pipeline,
 * `[0, 1, 0]` is the first node of the second source of the first node.
 */

import type { Diagnostic, Span, VplNode, VplPipeline } from '../ipc/commands';

export interface Located {
	path: number[];
	node: VplNode;
}

/**
 * Every node in the pipeline, nested ones included, each with its path and how deeply it nests -
 * for asking about all of them, such as which containers a pipeline reads. Sources come before the
 * node they feed. The chain draws itself from the tree instead, a box per node with sources.
 */
export function walk(pipeline: VplPipeline, path: number[] = [], depth = 0): (Located & { depth: number })[] {
	return pipeline.nodes.flatMap((node, index) => {
		const here = [...path, index];
		const nested = node.sources.flatMap((source, i) => walk(source, [...here, i], depth + 1));
		return [...nested, { path: here, node, depth }];
	});
}

export const samePath = (a: number[] | null, b: number[] | null): boolean =>
	a !== null && b !== null && a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * Whether `path` is the node the whole chain starts with.
 *
 * The one node that cannot be removed, because a chain must begin with a `from_*` node and the
 * rule is expressed by the missing control rather than by an error afterwards ([Q32]).
 *
 * **Not "is a read node".** The chain draws a composite's sources too, so
 * `from_stacked [ a, b ]` puts two `from_*` nodes on screen that are not the head - and testing
 * the name instead of the position made both undeletable, which left no way to drop one source of
 * a stack outside the VPL tab. Removing one of those is fine: the core refuses only the *last*
 * node of any parent, which is a different and narrower rule.
 */
export const isChainHead = (path: number[]): boolean => path.length === 1 && path[0] === 0;

const within = (at: number, span: Span): boolean => at >= span.start && at < span.end;

/**
 * The problems that are about this node, rather than one it reads from.
 *
 * Upstream reports a problem by node path, and the core turns that into the span of the node's name
 * or of the parameter's key - so the span starts inside exactly one node's own text. A node's span
 * runs through its `[…]` block, which holds the nodes it reads from; a problem in there is theirs.
 *
 * An empty span is the core saying "the whole document" - an empty pipeline, or a path it cannot
 * follow - which no single node should be marked for.
 */
export function problemsAt(node: VplNode, problems: Diagnostic[]): Diagnostic[] {
	return problems.filter(
		({ span }) =>
			span.end > span.start &&
			within(span.start, node.span) &&
			!(node.sourcesSpan && within(span.start, node.sourcesSpan))
	);
}

/** Whether a node's eye is on - not in the graph's switched-off set ([Q49]). */
export function isOn(path: number[], off: number[][]): boolean {
	return !off.some((other) => samePath(other, path));
}
