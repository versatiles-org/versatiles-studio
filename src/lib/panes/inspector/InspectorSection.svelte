<script lang="ts">
	import Inspector from './Inspector.svelte';
	import { composition } from '../../map/composition.svelte';
	import { preview } from '../../state/preview.svelte';
	import { workbench } from '../../state/workbench.svelte';

	// The Inspector, connected (S8.10): what the selected graph reads, and what it produced.
</script>

<Inspector
	containers={preview.containers.map((c) => c.info)}
	result={composition.editedBuild?.info ?? null}
	graph={workbench.selected?.name ?? null}
/>
