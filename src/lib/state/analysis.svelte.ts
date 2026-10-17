/**
 * What each source's tiles weigh, as far as anybody has measured (S14.2, [Q72]).
 *
 * **Per graph, and kept.** A walk over a large container costs seconds, so switching the selection
 * away and back must not throw an answer away - and nor must an edit: a result that is out of date
 * is still the best figure there is until somebody measures again. It is **marked stale** instead,
 * by comparing the build it was measured against with the build there is now.
 *
 * The build is told apart by its tile URL. Every mount carries a revision, so a rebuild that changed
 * anything is a different URL, while an edit that left the effective pipeline alone keeps the old one
 * ([Q61]) - which is exactly the line between "these numbers are about what you see" and "they are
 * not".
 *
 * [Q72]: ../../../docs/decisions.md
 * [Q61]: ../../../docs/decisions.md
 */

import { measureSizes, type Sizes } from '../ipc/commands';

export interface Measurement {
	/** The last answer, or `null` before the first one. Kept across a failure or a re-measure. */
	sizes: Sizes | null;
	/** Why the last attempt failed, or `null`. */
	error: string | null;
	running: boolean;
	/** The build `sizes` describes. */
	build: string | null;
}

let byGraph = $state<Record<number, Measurement>>({});

const blank = (): Measurement => ({ sizes: null, error: null, running: false, build: null });

export const analysis = {
	/** What is known about a graph, or a blank record for one never measured. */
	of(graph: number): Measurement {
		return byGraph[graph] ?? blank();
	},

	/**
	 * Whether a graph's figures describe something other than what the map now draws.
	 *
	 * `false` with nothing measured: there is nothing to be out of date.
	 */
	stale(graph: number, build: string | null): boolean {
		const known = byGraph[graph];
		return known?.sizes != null && known.build !== build;
	},

	/**
	 * Measures a graph's tiles. `build` is the build it is measuring, to tell later whether the
	 * answer still applies.
	 */
	async measure(graph: number, build: string | null): Promise<void> {
		byGraph[graph] = { ...this.of(graph), running: true, error: null };
		try {
			const sizes = await measureSizes(graph);
			byGraph[graph] = { sizes, error: null, running: false, build };
		} catch (error) {
			byGraph[graph] = {
				...this.of(graph),
				running: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	},

	/** Forgets everything - a different project's graphs reuse the same ids. */
	clear(): void {
		byGraph = {};
	}
};
