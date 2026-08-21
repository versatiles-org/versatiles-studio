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

/**
 * Whether `path` is the node the whole chain starts with.
 *
 * The one node that cannot be removed, because a chain must begin with a `from_*` node and the
 * rule is expressed by the missing control rather than by an error afterwards ([Q32]).
 *
 * **Not "is a read node".** `walk` flattens a composite's sources into rows too, so
 * `from_stacked [ a, b ]` puts two `from_*` nodes on screen that are not the head — and testing
 * the name instead of the position made both undeletable, which left no way to drop one source of
 * a stack outside the VPL tab. Removing one of those is fine: the core refuses only the *last*
 * node of any parent, which is a different and narrower rule.
 */
export const isChainHead = (path: number[]): boolean => path.length === 1 && path[0] === 0;

/**
 * Whether a selection made in `fromGraph` still names the same node in the document `next`.
 *
 * Two ways it stops doing so, and both are ordinary rather than exotic:
 *
 * * **The document belongs to another graph.** Undo and redo run on one stack across every graph
 *   ([Q32]), so a step can hand back a graph other than the one on screen. A path means nothing
 *   outside the graph it was taken from — `[2]` is just "the third node" — and since the selected
 *   node *is* the form, carrying it over opens a form for a node nobody picked.
 * * **The path no longer resolves.** Undoing the insertion that created the selected node is the
 *   common case. A selection pointing at nothing is worth dropping rather than leaving to match
 *   whatever later grows into that position.
 */
export const selectionSurvives = (
	selected: number[] | null,
	fromGraph: number | null,
	next: { graph: number; pipeline: VplPipeline }
): boolean => selected !== null && next.graph === fromGraph && nodeAtPath(next.pipeline, selected) !== null;

/**
 * Whether a node's output reaches what the map is showing (C3).
 *
 * **The same rule `preview::up_to` walks**, in the webview, so the chain can draw it. Pinning a node
 * previews the pipeline *up to and including* it — and pinning one inside a `[ … ]` block previews
 * that block's chain, not the pipeline consuming it. So a node feeds the preview when it sits in the
 * pinned node's own chain at or before it, or anywhere inside such a node.
 *
 * With nothing pinned the map draws the whole graph, so everything feeds it.
 */
export function feedsPreview(path: number[], pinned: number[] | null): boolean {
	if (!pinned) return true;
	// A path alternates node index and source index, so the last element is always a node's position
	// in its chain and everything before it names the chain.
	const chain = pinned.slice(0, -1);
	if (path.length < pinned.length) return false;
	if (!chain.every((step, index) => path[index] === step)) return false;
	// At or before the pin in that chain — and anything deeper than such a node is inside it, which
	// is how it got its own output.
	return path[chain.length] <= pinned[pinned.length - 1];
}
