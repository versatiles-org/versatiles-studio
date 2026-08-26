<script lang="ts">
	import GraphList from '../pipeline/GraphList.svelte';
	import Picker from '../../common/Picker.svelte';
	import type { GraphInfo, OperationInfo } from '../../ipc/commands';

	// The project's sources: which graphs there are, which are drawn, and in what order ([Q50]).
	//
	// **The top half of the Pipeline pane, made its own.** They are two objects at different levels -
	// a list of graphs is the project, a chain is one document - and holding both meant one pane
	// carried four groups, scrolled, and was named after one of them. Split, each folds on its own,
	// and the title says what the pane holds.
	//
	// **And it is the layers panel** ([Q49]). One row per source, an eye for drawn, a highlight for
	// the one being edited, and the row order *is* the draw order. The style pane used to keep a
	// second list for that order, over the sources that had built - so a graph that would not build
	// vanished from the only control that could move it.
	let {
		graphs = [],
		current = null,
		operations = [],
		actions
	}: {
		/** Every graph in the project, already in draw order - top of the list draws on top. */
		graphs?: GraphInfo[];
		/** The graph being edited, whose chain the Pipeline pane shows. */
		current?: number | null;
		/** Every known operation, for the `from_*` a new graph starts on. */
		operations?: OperationInfo[];
		actions: {
			select: (id: number) => void;
			rename: (id: number, name: string) => void;
			remove: (id: number) => void;
			/** Switches a graph on or off - the eye on its row ([Q49]). */
			setEnabled: (id: number, enabled: boolean) => void;
			/** Moves it up or down the stack, `+1` being towards the top of the map. */
			reorder: (id: number, by: number) => void;
			/** Starts a graph on a `from_*` node, with nothing filled in yet. */
			addNode: (operation: string) => void;
			/** Opens a `.vpl` as a graph of its own. */
			openFile: () => void;
		};
	} = $props();

	/// Whether "＋ new graph…" has been opened into its doors. Local: which way in someone is part
	/// way through choosing is not worth remembering across a reload.
	let adding = $state(false);

	/// What "from VPL node…" offers: every operation a chain can begin with.
	///
	/// From the registry rather than from the import catalogue, which answers a different question.
	/// The catalogue asks "what file have you got"; this asks "what should this graph read", and it
	/// offers all of them - `from_debug`, `from_color` and `from_tilejson` open no file at all.
	const reads = $derived(
		operations
			.filter((operation) => operation.kind === 'read')
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((operation) => ({ value: operation.name, description: operation.summary }))
	);
</script>

<div class="pane">
	<GraphList
		{graphs}
		{current}
		onSelect={actions.select}
		onToggle={actions.setEnabled}
		onReorder={actions.reorder}
		onRename={actions.rename}
		onRemove={actions.remove}
		onNew={() => (adding = !adding)}
	/>

	<!-- **Two doors, because a graph arrives in exactly two ways**: it is written here, or it was
	     written already. Everything else is a parameter of the node the first door creates - a form
	     the pane draws, with a file picker on every path field, rather than a dialog sequence in
	     front of it. Folded away until asked for: a pane is not a launcher. -->
	{#if adding}
		<div class="doors">
			<!-- Only once there is something behind it. `operations` is empty until the one-off fetch
			     lands, and a door onto an empty list is worse than a door that is not there yet. -->
			{#if reads.length > 0}
				<Picker
					label="from VPL node…"
					placeholder="Filter operations…"
					items={reads}
					onPick={(operation) => {
						adding = false;
						actions.addNode(operation);
					}}
				/>
			{/if}
			<button
				type="button"
				class="door"
				onclick={() => {
					adding = false;
					actions.openFile();
				}}
			>
				from VPL file…
			</button>
		</div>
	{/if}

	{#if graphs.length > 1}
		<p class="hint">The top of this list draws on top of the map.</p>
	{/if}
</div>

<style>
	/* One group: the doors answer the row above them, and the hint describes the list. The section
	   gap belongs between panes, not inside this one ([Q50]). */
	.pane {
		display: flex;
		flex-direction: column;
		gap: var(--gap-group);
		min-width: 0;
	}

	.doors {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
		padding: 0 var(--space-2);
	}

	/* The same weight as the picker beside it, because they are the same offer made twice. */
	.door {
		color: var(--ink-2);
		font-size: var(--text-sm);

		&:hover {
			color: var(--ink);
		}
	}

	/* Said once, under the list, rather than on every row. Only when there is a stack to arrange -
	   with one source there is no top to be on. */
	.hint {
		margin: 0;
		padding: 0 var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
</style>
