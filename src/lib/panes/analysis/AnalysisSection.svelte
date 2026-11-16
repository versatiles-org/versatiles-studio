<script lang="ts">
	import Analysis from './Analysis.svelte';
	import { analysis } from '../../state/analysis.svelte';
	import { composition } from '../../map/composition.svelte';
	import { workbench } from '../../state/workbench.svelte';
	import { heat } from '../../state/heat.svelte';
	import { tileDialog } from '../../state/tile-dialog.svelte';
	import { scans } from '../../state/contents.svelte';
	import { document } from '../../state/document.svelte';
	import { renderableAs } from '../../map/tile-format';

	// The Analysis pane, connected (S14.2): the selected graph's figures, and the build they are about.

	const selected = $derived(workbench.selected);
	const build = $derived(composition.editedBuild?.tileUrl ?? null);
	/// Taken as vector until the build has said what its tiles are, so the Layers group does not
	/// appear only once a vector source has finished building.
	const info = $derived(composition.editedBuild?.info);
	const vector = $derived(info ? renderableAs(info.tileFormat) === 'vector' : true);
</script>

<Analysis
	graph={selected?.name ?? null}
	measurement={selected ? analysis.of(selected.id) : analysis.of(-1)}
	stale={selected ? analysis.stale(selected.id, build) : false}
	onMeasure={() => {
		if (selected) void analysis.measure(selected.id, build);
	}}
	onShowTile={(z, x, y) => workbench.showTile(z, x, y)}
	onInspectTile={(z, x, y) => {
		if (selected) void tileDialog.open(selected.id, z, x, y);
	}}
	scan={selected ? scans.of(selected.id) : scans.of(-1)}
	scanStale={selected ? scans.stale(selected.id, build) : false}
	onScan={(full) => {
		if (selected) void scans.scan(selected.id, build, full);
	}}
	endsInRepair={document.current?.pipeline.nodes.at(-1)?.name === 'vector_repair'}
	onRepair={(drop) => {
		// The edit lands in the open document, which is the selected source's - checked, not assumed.
		if (selected && document.current?.graph === selected.id) void workbench.appendRepair(drop);
	}}
	{vector}
	heatOn={heat.on}
	onToggleHeat={() => {
		if (heat.on) void heat.hide();
		else if (selected && info) void heat.show(selected.id, build, info.maxZoom);
	}}
/>
