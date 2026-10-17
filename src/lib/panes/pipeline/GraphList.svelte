<script lang="ts">
	import Icon from '../../common/Icon.svelte';
	import type { Snippet } from 'svelte';
	import type { GraphInfo } from '../../ipc/commands';
	import Note from '../../common/Note.svelte';

	// The project's graphs, one row each (S2.13, [Q32], [Q49]).
	//
	// A list rather than a pane per graph: four graphs cost four rows here and four folded boxes
	// there, and the list is where per-graph state - the eye, the unsaved dot, the name - has an
	// obvious home. Renaming happens here for the same reason.
	//
	// **A set, not a stack** ([the layer stack](../../../../docs/layers.md)). One row per source, an
	// eye that says whether it is drawn, and a highlight that says which one you are editing - two
	// different questions, which is why they are two different marks. The eye used to be a read-only
	// indicator of where the pin was; a pin is about looking at one node, and looking is not the same
	// as being in the picture ([Q49]).
	//
	// **It no longer carries the draw order.** A source stopped owning a contiguous block of the map,
	// so where its layers go is a question about the whole map and is answered in the Layers pane -
	// where a source can be moved in parts. A ↑ here could only ever move all of it.
	let {
		graphs,
		current,
		onSelect,
		onToggle,
		onRename,
		onRemove,
		newGraph
	}: {
		graphs: GraphInfo[];
		/** The graph being edited. Its chain is what the pane shows below. */
		current: number | null;
		onSelect: (id: number) => void;
		/** Switches a graph on or off - built and drawn, or neither ([Q49]). */
		onToggle: (id: number, enabled: boolean) => void;
		/** Rejected by the core when another graph already has the name; the message comes back. */
		onRename: (id: number, name: string) => void;
		/** Removes the graph for good - see the confirmation below for why it is not one click. */
		onRemove: (id: number) => void;
		/** The control that adds a source, rendered at the foot of the list. */
		newGraph?: Snippet;
	} = $props();

	/// Which row is being renamed, and the text so far. Local: a half-typed name is not worth
	/// remembering across a reload, and committing it is what makes it real.
	let renaming = $state<number | null>(null);
	let draft = $state('');

	/// Which row is asking to be confirmed before it is removed.
	///
	/// **Deleting a graph is the one thing here that ⌘Z cannot take back.** The history stack
	/// restores text *into* a graph ([Q32]), so one that no longer exists has nothing to restore
	/// into - the core says as much and makes the step a no-op. That makes a bare `×` next to a
	/// rename button the wrong shape: same size, same place, one undoable and one not.
	///
	/// Confirmed in the row rather than in a modal, for the same reason renaming happens here: the
	/// list is where graphs live, and a dialog for a two-word question would be the only modal in
	/// the pane besides export.
	let removing = $state<number | null>(null);

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

<!-- **An empty list still says what it is.** The pane used to be hidden entirely while a project
     had no sources ([Q54]), so this case had never been drawn; an empty `<ul>` above a `+` reads as
     a list that failed to load rather than as one nobody has filled in yet. -->
{#if graphs.length === 0}
	<Note tone="empty">No sources yet.</Note>
{/if}

<!-- Each row is the kit's `.list-row`; what is this list's own is the frame, the highlight and the
     dimming of a switched-off source (S12.3). -->
<ul class="graphs">
	{#each graphs as graph (graph.id)}
		<li class="list-row" class:current={graph.id === current} class:off={!graph.enabled}>
			<!-- The switch says whether this source is built and drawn; the row highlight says what you
			     are editing. Different questions, so different marks - and a graph that is switched off
			     is still one you can edit, which is what makes them independent.

			     **A switch, not an eye** (S10.6). Off means the graph is not built: no job, no mount, no
			     layers anywhere. The eye in the Layers pane is the other control - it hides what a
			     built source paints - and giving the two one glyph is how they were confused. -->
			<button
				type="button"
				class="switch"
				class:on={graph.enabled}
				title={graph.enabled
					? `Switch off ${graph.name}. It is not built or drawn until switched on again.`
					: `Switch on ${graph.name}. It is built and drawn.`}
				aria-pressed={graph.enabled}
				aria-label={graph.enabled ? `Switch off ${graph.name}` : `Switch on ${graph.name}`}
				onclick={() => onToggle(graph.id, !graph.enabled)}
			>
				<Icon name="power" size="100%" />
			</button>

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
			{:else if removing === graph.id}
				<span class="name truncate confirming" title={graph.name}>{graph.name}</span>
				<button
					type="button"
					class="quiet danger"
					onclick={() => {
						removing = null;
						onRemove(graph.id);
					}}>Delete</button
				>
				<button type="button" class="icon" aria-label="Keep {graph.name}" title="Keep" onclick={() => (removing = null)}
					><Icon name="remove" size="1em" /></button
				>
			{:else}
				<button type="button" class="name truncate" title={graph.name} onclick={() => onSelect(graph.id)}>
					{graph.name}
				</button>
				<!-- **A half-run graph must not look like a whole one from the list.** The chain is
				     only on screen for the graph being edited, so without this the eyes inside one
				     graph would be invisible from every other row. -->
				{#if graph.enabled && graph.running < graph.nodes}
					<span class="part" title="{graph.running} of {graph.nodes} operations are switched on">
						{graph.running}/{graph.nodes}
					</span>
				{/if}
				{#if graph.dirty}<span class="dirty" title="unsaved changes" aria-label="unsaved changes">•</span>{/if}
				<button type="button" class="icon" title="Rename {graph.name}" aria-label="Rename" onclick={() => start(graph)}
					><Icon name="rename" size="1em" /></button
				>
				<button
					type="button"
					class="icon danger"
					title="Delete {graph.name}"
					aria-label="Delete {graph.name}"
					onclick={() => (removing = graph.id)}><Icon name="remove" size="1em" /></button
				>
			{/if}
		</li>
	{/each}
	<!-- The way in keeps its place at the foot of the list, but what it opens is the caller's: the
	     list knows about rows, not about the two ways a graph arrives ([Q58]). -->
	<li class="new">{@render newGraph?.()}</li>
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
		padding: var(--space-1) var(--space-2);

		& + li {
			border-top: 1px solid var(--rule);
		}

		&.current {
			background: color-mix(in srgb, var(--accent) 12%, var(--surface));
			box-shadow: inset 2px 0 0 var(--accent);
		}

		/* Not drawn, and saying so the way the chain says it of a node. Still selectable, still
		   editable: a hidden layer is one you can work on ([Q49]). */
		&.off .name,
		&.off .part {
			opacity: 0.55;
		}
	}

	.switch {
		flex: none;
		width: 13px;
		height: 13px;
		color: var(--ink-2);

		&.on {
			color: var(--accent);
		}

		&:hover {
			color: var(--ink);
		}
	}

	/* Quiet: it is a footnote on the name, not a second name. */
	.part {
		flex: none;
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--ink-2);
	}

	.name {
		flex: 1;
		min-width: 0;
		text-align: left;
		padding: var(--space-1) 0;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
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

	/* The name stops being a target while the row is asking: the only two answers are the buttons. */
	.confirming {
		flex: 1;
		min-width: 0;
		color: var(--ink-2);
	}

	.new {
		padding: var(--space-1) 0;
	}
</style>
