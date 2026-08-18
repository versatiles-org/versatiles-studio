<script lang="ts">
	import type { GraphInfo } from '../../ipc/commands';

	// The project's graphs, one row each (S2.13, [Q32]).
	//
	// A list rather than a pane per graph: four graphs cost four rows here and four folded boxes
	// there, and the list is where per-graph state — the pin, the unsaved dot, the name — has an
	// obvious home. Renaming happens here for the same reason.
	let {
		graphs,
		current,
		pinnedGraph,
		onSelect,
		onRename,
		onNew
	}: {
		graphs: GraphInfo[];
		/** The graph being edited. Its chain is what the pane shows below. */
		current: number | null;
		/** The graph holding the pinned node, if any — not necessarily the one being edited. */
		pinnedGraph: number | null;
		onSelect: (id: number) => void;
		/** Rejected by the core when another graph already has the name; the message comes back. */
		onRename: (id: number, name: string) => void;
		onNew: () => void;
	} = $props();

	/// Which row is being renamed, and the text so far. Local: a half-typed name is not worth
	/// remembering across a reload, and committing it is what makes it real.
	let renaming = $state<number | null>(null);
	let draft = $state('');

	function start(graph: GraphInfo) {
		renaming = graph.id;
		draft = graph.name;
	}

	function commit() {
		const id = renaming;
		renaming = null;
		if (id === null) return;
		const wanted = draft.trim();
		const was = graphs.find((graph) => graph.id === id)?.name;
		if (wanted && wanted !== was) onRename(id, wanted);
	}
</script>

<ul class="graphs">
	{#each graphs as graph (graph.id)}
		<li class:current={graph.id === current}>
			<!-- The eye says where the *map* is looking; the row highlight says what you are editing.
			     They are different questions, and after [Q32] they can be different graphs. -->
			<span class="eye" class:on={graph.id === pinnedGraph} aria-hidden="true">
				<svg viewBox="0 0 16 16">
					<path
						d="M1 8s2.6-4.2 7-4.2S15 8 15 8s-2.6 4.2-7 4.2S1 8 1 8Z"
						fill="none"
						stroke="currentColor"
						stroke-width="1.3"
					/>
					{#if graph.id === pinnedGraph}
						<circle cx="8" cy="8" r="2.4" fill="currentColor" />
					{:else}
						<circle cx="8" cy="8" r="1.9" fill="none" stroke="currentColor" stroke-width="1.3" />
					{/if}
				</svg>
			</span>

			{#if renaming === graph.id}
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="rename"
					value={draft}
					autofocus
					spellcheck="false"
					autocomplete="off"
					aria-label="Rename {graph.name}"
					oninput={(event) => (draft = event.currentTarget.value)}
					onblur={commit}
					onkeydown={(event) => {
						if (event.key === 'Enter') event.currentTarget.blur();
						if (event.key === 'Escape') {
							renaming = null;
						}
					}}
				/>
			{:else}
				<button type="button" class="name truncate" title={graph.name} onclick={() => onSelect(graph.id)}>
					{graph.name}
				</button>
				{#if graph.dirty}<span class="dirty" title="unsaved changes" aria-label="unsaved changes">•</span>{/if}
				<button type="button" class="edit" title="Rename {graph.name}" aria-label="Rename" onclick={() => start(graph)}>
					✎
				</button>
			{/if}
		</li>
	{/each}
	<li class="new">
		<button type="button" onclick={onNew}>＋ new graph…</button>
	</li>
</ul>

<style>
	.graphs {
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		overflow: hidden;
	}
	li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		padding: var(--space-1) var(--space-2);
	}
	li + li {
		border-top: 1px solid var(--rule);
	}
	li.current {
		background: color-mix(in srgb, var(--accent) 12%, var(--surface));
		box-shadow: inset 2px 0 0 var(--accent);
	}
	.eye {
		flex: none;
		width: 13px;
		height: 13px;
		color: var(--ink-2);
	}
	.eye.on {
		color: var(--accent);
	}
	.eye svg {
		width: 100%;
		height: 100%;
		display: block;
	}
	.name {
		flex: 1;
		min-width: 0;
		text-align: left;
		border: 0;
		background: none;
		padding: var(--space-1) 0;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: inherit;
	}
	.rename {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}
	.dirty {
		flex: none;
		color: var(--accent);
		line-height: 1;
	}
	.edit {
		flex: none;
		border: 0;
		background: none;
		color: var(--ink-2);
		padding: 0 var(--space-1);
		font-size: var(--text-xs);
	}
	.edit:hover {
		color: var(--ink);
	}
	.new button {
		border: 0;
		background: none;
		color: var(--ink-2);
		font-size: var(--text-sm);
		padding: var(--space-1) 0;
	}
	.new button:hover {
		color: var(--ink);
	}
</style>
