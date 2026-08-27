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

import type { VplNode, VplPipeline } from '../ipc/commands';

export interface Located {
	path: number[];
	node: VplNode;
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
 * `from_stacked [ a, b ]` puts two `from_*` nodes on screen that are not the head - and testing
 * the name instead of the position made both undeletable, which left no way to drop one source of
 * a stack outside the VPL tab. Removing one of those is fine: the core refuses only the *last*
 * node of any parent, which is a different and narrower rule.
 */
export const isChainHead = (path: number[]): boolean => path.length === 1 && path[0] === 0;

/** Whether a node's eye is on - not in the graph's switched-off set ([Q49]). */
export function isOn(path: number[], off: number[][]): boolean {
	return !off.some((other) => samePath(other, path));
}
