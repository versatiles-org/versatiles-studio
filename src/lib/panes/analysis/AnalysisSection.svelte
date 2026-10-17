<script lang="ts">
	import Analysis from './Analysis.svelte';
	import { analysis } from '../../state/analysis.svelte';
	import { composition } from '../../map/composition.svelte';
	import { workbench } from '../../state/workbench.svelte';
	import { heat } from '../../state/heat.svelte';
	import { tileDialog } from '../../state/tile-dialog.svelte';

	// The Analysis pane, connected (S14.2): the selected graph's figures, and the build they are about.

	const selected = $derived(workbench.selected);
	const build = $derived(composition.editedBuild?.tileUrl ?? null);
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
	heatOn={heat.on}
	onToggleHeat={() => {
		const info = composition.editedBuild?.info;
		if (heat.on) void heat.hide();
		else if (selected && info) void heat.show(selected.id, build, info.maxZoom);
	}}
/>
