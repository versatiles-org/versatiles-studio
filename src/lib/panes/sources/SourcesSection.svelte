<script lang="ts">
	import SourcesPane from './SourcesPane.svelte';
	import { composition } from '../../map/composition.svelte';
	import { workbench } from '../../state/workbench.svelte';

	// The Sources pane, connected (S10.10).
	//
	// **The wiring that used to be one arm of `App.svelte`.** `SourcesPane` takes data and actions and
	// knows no state module, which is what makes it renderable in a test; this is the half that knows
	// where the data comes from and where the actions go. One file per pane, beside the pane, so "what
	// feeds the Sources pane" is answered by its folder rather than by a search through the page root.
</script>

<SourcesPane
	graphs={composition.stacked}
	current={workbench.selected?.id ?? null}
	operations={workbench.operations}
	actions={{
		select: (id) => void workbench.select(id),
		rename: (id, name) => void workbench.rename(id, name),
		remove: (id) => void workbench.remove(id),
		setEnabled: (id, enabled) => void workbench.toggleGraph(id, enabled),
		addNode: (operation) => void workbench.newGraph(operation),
		// Both doors add a graph rather than writing into the selected one - the list they hang off
		// is what adds sources ([Q50]).
		openSource: () => void workbench.pick(undefined, 'new'),
		openPipeline: () => void workbench.pick(workbench.pipelineKind, 'new')
	}}
/>
