/**
 * What each source's vector tiles hold, layer by layer, as far as anybody has read (S14.7, [Q72]).
 *
 * Kept per graph and marked stale by the build, for the reasons the measurement is - see
 * `analysis.svelte.ts`. A scan is minutes where a measurement is seconds, which makes keeping it
 * across a selection change matter more, not less.
 *
 * [Q72]: ../../../docs/decisions.md
 */

import { scanContents, type Contents, type LayerContents } from '../ipc/commands';

export interface Scan {
	/** The last answer, or `null` before the first. Kept across a failure or a rescan. */
	contents: Contents | null;
	error: string | null;
	running: boolean;
	/** The build `contents` describes. */
	build: string | null;
}

let byGraph = $state<Record<number, Scan>>({});

const blank = (): Scan => ({ contents: null, error: null, running: false, build: null });

/**
 * The layers at one level, or summed over every level with `null` - the heaviest first.
 *
 * Summed by name: a layer is one thing across the pyramid, however many levels carry it.
 */
export function combine(contents: Contents, level: number | null): LayerContents[] {
	const levels = level === null ? contents.levels : contents.levels.filter((at) => at.level === level);
	// No prototype: a layer may be called anything, `constructor` included.
	const byName: Record<string, LayerContents> = Object.create(null) as Record<string, LayerContents>;
	for (const at of levels)
		for (const layer of at.layers) {
			const sum = byName[layer.name];
			if (!sum) byName[layer.name] = { ...layer };
			else
				for (const key of [
					'tiles',
					'features',
					'bytes',
					'geometryBytes',
					'propertyBytes',
					'tagBytes',
					'idBytes',
					'otherBytes'
				] as const)
					sum[key] += layer[key];
		}
	return Object.values(byName).sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
}

export const scans = {
	of(graph: number): Scan {
		return byGraph[graph] ?? blank();
	},

	/** Whether a graph's layers were read from something other than what the map now draws. */
	stale(graph: number, build: string | null): boolean {
		const known = byGraph[graph];
		return known?.contents != null && known.build !== build;
	},

	/** Reads a graph's layers - a sample, unless `full`. */
	async scan(graph: number, build: string | null, full: boolean): Promise<void> {
		byGraph[graph] = { ...this.of(graph), running: true, error: null };
		try {
			const contents = await scanContents(graph, full);
			byGraph[graph] = { contents, error: null, running: false, build };
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
