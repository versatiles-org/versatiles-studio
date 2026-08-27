<script lang="ts">
	import GraphList from '../pipeline/GraphList.svelte';
	import Menu, { type MenuItem } from '../../common/Menu.svelte';
	import type { GraphInfo, OperationInfo } from '../../ipc/commands';

	// The project's sources: which graphs there are, which are drawn, and in what order ([Q50]).
	//
	// **The top half of the Pipeline pane, made its own.** They are two objects at different levels -
	// a list of graphs is the project, a chain is one document - and holding both meant one pane
	// carried four groups, scrolled, and was named after one of them. Split, each folds on its own,
	// and the title says what the pane holds.
	//
	// **What data exists, not where it is drawn** ([the layer stack](../../../../docs/layers.md)).
	// One row per source, an eye for drawn, a highlight for the one being edited - and no order. A
	// source became a thing the map draws *from* rather than a thing on the map, so the stack is the
	// Layers pane's, which is the only place a source can be arranged in parts.
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
			/** Starts a graph on a `from_*` node, with nothing filled in yet. */
			addNode: (operation: string) => void;
			/**
			 * Opens any file Studio can read as a graph of its own, letting the catalogue decide which
			 * `from_*` node it becomes - the same reading a dropped file gets.
			 */
			openSource: () => void;
			/** Opens a `.vpl` as a graph of its own. */
			openPipeline: () => void;
		};
	} = $props();

	/// Which list the menu is showing: the two ways in, or the operations behind the first of them.
	///
	/// Local, and reset when the menu closes: which way in someone is part way through choosing is not
	/// worth remembering across a reload, and reopening on a list they had walked into would be
	/// answering a question they had not asked again.
	let page = $state<'doors' | 'operations'>('doors');

	/// What "from VPL node…" offers: every operation a chain can begin with.
	///
	/// From the registry rather than from the import catalogue, which answers a different question.
	/// The catalogue asks "what file have you got"; this asks "what should this graph read", and it
	/// offers all of them - `from_debug`, `from_color` and `from_tilejson` open no file at all.
	const reads = $derived(
		operations
			.filter((operation) => operation.kind === 'read')
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((operation) => ({ id: operation.name, label: operation.name, description: operation.summary }))
	);

	/// **Three doors: bring data, write a graph, or open one already written.**
	///
	/// The data door is first because it is the common one and it asks the least - point at a file and
	/// Studio reads it, the same way a dropped file is read. The other two are for saying what a graph
	/// should be when there is no file that answers it, and for a pipeline written earlier.
	///
	/// **The data door does not name a format.** Which `from_*` node a file becomes is the catalogue's
	/// answer, from the file itself - three formats wear `.json`, so a door per format would be a
	/// question the person cannot always answer and Studio always can (S3.2).
	///
	/// The node door is disabled until the one-off fetch of the registry lands, since a door onto an
	/// empty list is worse than one that says it is not ready.
	const doors: MenuItem[] = $derived([
		{
			id: 'source',
			label: 'From a file…',
			description: 'Tiles, a table, vector or raster - Studio picks the reader'
		},
		{
			id: 'node',
			label: 'From VPL node…',
			description: 'Start a graph on a read operation',
			disabled: reads.length === 0
		},
		{ id: 'file', label: 'From VPL file…', description: 'Open a pipeline that already exists' }
	]);

	const items = $derived(page === 'doors' ? doors : reads);

	/// Returns `'keep'` where the choice leads to another list rather than doing something, which is
	/// what leaves the menu open in place instead of closing and reopening under the same button.
	function pick(id: string): void | 'keep' {
		if (page === 'operations') {
			actions.addNode(id);
			page = 'doors';
			return;
		}
		if (id === 'source') {
			actions.openSource();
			return;
		}
		if (id === 'file') {
			actions.openPipeline();
			return;
		}
		page = 'operations';
		return 'keep';
	}
</script>

<div class="pane">
	<GraphList
		{graphs}
		{current}
		onSelect={actions.select}
		onToggle={actions.setEnabled}
		onRename={actions.rename}
		onRemove={actions.remove}
	>
		{#snippet newGraph()}
			<!-- **A menu, not a fold.** Revealing the two ways in inside the layout pushed the pane
			     below them down, so the choices moved while you read them and sat in the flow of the
			     list they had appeared under. A popup covers rather than displaces ([Q58]). -->
			<Menu
				label="＋ new graph…"
				title="Add a source to this project"
				{items}
				onPick={pick}
				onClose={() => (page = 'doors')}
			/>
		{/snippet}
	</GraphList>

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

	/* Said once, under the list, rather than on every row. Only when there is a stack to arrange -
	   with one source there is no top to be on. */
	.hint {
		margin: 0;
		padding: 0 var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
</style>
