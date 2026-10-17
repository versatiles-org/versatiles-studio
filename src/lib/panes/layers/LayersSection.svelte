<script lang="ts">
	import LayersPane from './LayersPane.svelte';
	import { move, segmentsFrom, type Range } from './move';
	import { composition } from '../../map/composition.svelte';
	import { style } from '../../state/style.svelte';
	import { workbench } from '../../state/workbench.svelte';

	// The Layers pane, connected (S8.10).
	//
	// **The wiring that used to be one arm of `App.svelte`**, and the one rule that belongs to this
	// pane alone: how a move becomes an order.

	/// Moves a run of the stack, which is the whole of reordering
	/// ([the layer stack](../../../../docs/layers.md)).
	///
	/// **The segments are derived from the result, not edited towards it.** `move` produces the rows
	/// in their new order and `segmentsFrom` reads the runs back off them, so the boundaries are
	/// ascending by construction and there is no second place the invariant could be broken.
	async function reorder(range: Range, at: number): Promise<void> {
		await style.setSegments(segmentsFrom(move(composition.rows, range, at)));
	}
</script>

<LayersPane
	rows={composition.rows}
	sources={composition.sources}
	actions={{
		setHidden: (graph, path, hidden) => void style.setHidden(graph, path, hidden).then(() => workbench.refresh()),
		setOverride: (graph, layer, patch) => void style.setLayerFor(graph, layer, patch),
		select: (graph) => void workbench.select(graph),
		reorder: (range, at) => void reorder(range, at)
	}}
/>
