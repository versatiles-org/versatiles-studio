/**
 * What an expression can name, for the selected source - what the expression helper offers.
 *
 * **The layer scan's, when it describes the build on screen**: every layer's property keys and
 * their commonest values, read from the tiles (S14.7). Before a scan, or after the source changed
 * under one, the keys the build already probed stand in - one tile's, with no values - so the
 * helper always has names to offer and says when values need reading.
 *
 * **The source's output, not the node's input.** A scan reads what the map draws; an expression in
 * the middle of a chain sees what the operations before it made. For the filters an expression
 * sits in, those are the same layers and keys, less whatever a filter upstream removed.
 */

import type { LayerProperties } from '../ipc/commands';
import { composition } from '../map/composition.svelte';
import { scans } from './contents.svelte';
import { workbench } from './workbench.svelte';

export interface Vocabulary {
	layers: LayerProperties[];
	/** Where the values come from: every tile, a sample of them, or no reading yet. */
	read: 'full' | 'sampled' | 'none';
	/** Whether a scan is running now. */
	scanning: boolean;
}

export const vocabulary = {
	get current(): Vocabulary {
		const selected = workbench.selected;
		const build = composition.editedBuild;
		const scan = selected ? scans.of(selected.id) : null;
		const scanning = scan?.running ?? false;
		const contents = scan?.contents;
		if (selected && contents && !scans.stale(selected.id, build?.tileUrl ?? null) && contents.properties.length > 0) {
			return { layers: contents.properties, read: contents.sampled ? 'sampled' : 'full', scanning };
		}
		const probed = (build?.layers ?? []).map((layer) => ({
			layer: layer.name,
			keys: layer.propertyKeys.map((key) => ({ key, features: 0, values: [], more: false }))
		}));
		return { layers: probed, read: 'none', scanning };
	},

	/** Reads the selected source's layers - a sample, as the Analysis pane's first reading is. */
	scan(): void {
		const selected = workbench.selected;
		if (selected) void scans.scan(selected.id, composition.editedBuild?.tileUrl ?? null, false);
	}
};
