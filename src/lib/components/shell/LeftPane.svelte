<script lang="ts">
	import PaneSection from './PaneSection.svelte';
	import type { ContainerInfo, Layout } from '../../ipc/commands';

	// The chain from data to pixels, as collapsible sections (Q22): Pipeline · Style · Export.
	//
	// There is deliberately no Sources section — the `from_container` read nodes at the head of the
	// pipeline *are* the sources, and a separate list would show the same nodes twice (Q14).
	//
	// Style arrives at S4 and Export at S5. Their sections are not stubbed out here: an empty
	// section that does nothing teaches the wrong thing about what the pane contains.
	let {
		layout,
		containers,
		onLayoutChange,
		onAddSource
	}: {
		layout: Layout;
		containers: { info: ContainerInfo; vpl: string }[];
		onLayoutChange: (layout: Layout) => void;
		onAddSource: () => void;
	} = $props();
</script>

<div class="pane">
	<PaneSection
		title="Pipeline"
		open={layout.pipelineOpen}
		count={containers.length}
		onToggle={(open) => onLayoutChange({ ...layout, pipelineOpen: open })}
	>
		{#if containers.length === 0}
			<p class="empty">Nothing open yet.</p>
		{:else}
			<ol class="nodes">
				{#each containers as container (container.info.source)}
					<li>
						<code>{container.vpl}</code>
						<span class="meta">{container.info.container} · {container.info.tileFormat}</span>
					</li>
				{/each}
			</ol>
		{/if}
		<button type="button" class="add" onclick={onAddSource}>+ Add source</button>
	</PaneSection>
</div>

<style>
	.pane {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow-y: auto;
		background: var(--surface);
	}
	.empty {
		margin: 0.3rem 0;
		color: var(--ink-2);
		font-size: 0.75rem;
	}
	.nodes {
		list-style: none;
		margin: 0.2rem 0 0.5rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.nodes li {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.35rem 0.4rem;
		border: 1px solid var(--rule);
		border-radius: 3px;
		background: var(--chrome);
	}
	/* The node is VPL, so it is shown as VPL — and allowed to scroll rather than wrap, because a
	   broken path is harder to read than a scrollbar. */
	.nodes code {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.7rem;
		color: var(--ink);
		overflow-x: auto;
		white-space: pre;
	}
	.meta {
		font-size: 0.68rem;
		color: var(--ink-2);
	}
	.add {
		align-self: flex-start;
		margin-top: 0.1rem;
		padding: 0.2rem 0.45rem;
		border: 1px dashed var(--rule);
		border-radius: 3px;
		background: none;
		font: inherit;
		font-size: 0.72rem;
		color: var(--ink-2);
		cursor: pointer;
	}
	.add:hover {
		border-style: solid;
		color: var(--ink);
	}
	.add:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
</style>
