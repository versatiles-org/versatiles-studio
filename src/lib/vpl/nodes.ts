/**
 * Every node in a pipeline, and the path that names it.
 *
 * This walks the *already parsed* tree the core hands over, so it duplicates no grammar - the
 * parsing, the spans and the validation all stay in Rust ([Q23](../../../docs/decisions.md)). It
 * lives here because the chain is redrawn on every keystroke, and a round trip per keypress to walk
 * ten nodes would be a poor trade.
 *
 * The path is the index at each level of nesting: `[1]` is the second node of the pipeline,
 * `[0, 1, 0]` is the first node of the second source of the first node.
 */

import type { Diagnostic, Span, VplNode, VplPipeline } from '../ipc/commands';

export interface Located {
	path: number[];
	node: VplNode;
}

export const samePath = (a: number[] | null, b: number[] | null): boolean =>
	a !== null && b !== null && a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * Every node in the pipeline, flattened, each with its path and how deeply it nests.
 *
 * **In the order the tiles move.** A composite's sources are read first and feed it, so they come
 * above the node: `from_stacked [ a, b ]` is `a`, `b`, then `from_stacked`. A branch is the other
 * way round - the tiles arrive at `vector_branch`, go through `then` or `else`, and leave it - so an
 * operation in `branching` comes first and its branches below it. Drawn above, they read as inputs
 * that ran before it.
 */
export function walk(
	pipeline: VplPipeline,
	branching: ReadonlySet<string> = new Set(),
	path: number[] = [],
	depth = 0
): (Located & { depth: number })[] {
	return pipeline.nodes.flatMap((node, index) => {
		const here = [...path, index];
		const nested = node.sources.flatMap((source, i) => walk(source, branching, [...here, i], depth + 1));
		const self = { path: here, node, depth };
		return branching.has(node.name) ? [self, ...nested] : [...nested, self];
	});
}

/**
 * Whether `path` is the node the whole chain starts with.
 *
 * The one node that cannot be removed, because a chain must begin with a `from_*` node and the
 * rule is expressed by the missing control rather than by an error afterwards ([Q32]).
 *
 * **Not "is a read node".** `walk` flattens a composite's sources into rows too, so
 * `from_stacked [ a, b ]` puts two `from_*` nodes on screen that are not the head - and testing
 * the name instead of the position made both undeletable, which left no way to drop one source of
 * a stack outside the VPL tab. Removing one of those is fine: the core refuses only the *last*
 * node of any parent, which is a different and narrower rule.
 */
export const isChainHead = (path: number[]): boolean => path.length === 1 && path[0] === 0;

/** The node at `path`, or `undefined` when the path names none. */
export function nodeAt(pipeline: VplPipeline, path: number[]): VplNode | undefined {
	let chain: VplPipeline | undefined = pipeline;
	let found: VplNode | undefined;
	for (let level = 0; level < path.length; level += 2) {
		found = chain?.nodes[path[level]];
		if (level + 1 < path.length) chain = found?.sources[path[level + 1]];
	}
	return found;
}

/**
 * Whether `path` is the first node of a branch - a source of an operation whose sources are
 * branches (`FieldInfo.branches`), such as `vector_branch`'s `then` and `else`.
 *
 * **Not a chain head.** A branch runs on the tiles arriving at its operation, so its first node is
 * a transform, and another transform may go ahead of it - which is why the chain draws a way in
 * above it that no other first node gets.
 */
export function isBranchHead(path: number[], pipeline: VplPipeline, branching: ReadonlySet<string>): boolean {
	if (path.length < 3 || path.at(-1) !== 0) return false;
	const parent = nodeAt(pipeline, path.slice(0, -2));
	return parent !== undefined && branching.has(parent.name);
}

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
