<script lang="ts">
	import PaneSection from './PaneSection.svelte';
	import VplNodeCard from './VplNodeCard.svelte';
	import {
		vplParse,
		vplRemoveProperty,
		vplSetValue,
		type ContainerInfo,
		type Layout,
		type Span,
		type VplNode
	} from '../../ipc/commands';

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
		onAddSource,
		onVplChange
	}: {
		layout: Layout;
		containers: { info: ContainerInfo; vpl: string }[];
		onLayoutChange: (layout: Layout) => void;
		onAddSource: () => void;
		/** The node's VPL after an edit. The caller decides what a changed node means. */
		onVplChange: (source: string, vpl: string) => void;
	} = $props();

	/** Parsed nodes, keyed by the container they came from. Parsing is the core's job (Q23). */
	let parsed = $state<Record<string, VplNode>>({});
	let parseError = $state<string | null>(null);

	$effect(() => {
		// Read what needs parsing before any await, so the effect tracks it and does not re-enter.
		const pending = containers.map((container) => ({
			source: container.info.source,
			vpl: container.vpl
		}));
		let cancelled = false;
		void (async () => {
			const next: Record<string, VplNode> = {};
			try {
				for (const { source, vpl } of pending) {
					const pipeline = await vplParse(vpl);
					if (pipeline.nodes[0]) next[source] = pipeline.nodes[0];
				}
				if (!cancelled) {
					parsed = next;
					parseError = null;
				}
			} catch (error) {
				if (!cancelled) parseError = message(error);
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	/** Command rejections carry `{ message, span }` (C4); anything else is stringified. */
	function message(error: unknown): string {
		return typeof error === 'object' && error !== null && 'message' in error
			? String((error as { message: unknown }).message)
			: String(error);
	}

	async function edit(source: string, run: () => Promise<string>) {
		try {
			onVplChange(source, await run());
			parseError = null;
		} catch (error) {
			// The core refuses an edit that would not parse and leaves the document untouched, so
			// there is nothing to roll back here — only something to say.
			parseError = message(error);
		}
	}
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
					{@const node = parsed[container.info.source]}
					<li>
						{#if node}
							<VplNodeCard
								{node}
								onCommit={(span: Span, value: string) =>
									void edit(container.info.source, () => vplSetValue(container.vpl, span, value))}
								onRemove={(span: Span) =>
									void edit(container.info.source, () => vplRemoveProperty(container.vpl, span))}
							/>
						{/if}
						<span class="meta truncate">{container.info.container} · {container.info.tileFormat}</span>
					</li>
				{/each}
			</ol>
		{/if}
		{#if parseError}<p class="error">{parseError}</p>{/if}
		<button type="button" class="add" onclick={onAddSource}>+ Add source</button>
	</PaneSection>
</div>

<style>
	/* The pane lives in a fixed grid column. Without `min-width: 0` here and on every descendant
	   that lays out children, a long path would set the column's content width and push the map off
	   the edge — flex and grid children default to `min-width: auto`, not zero. */
	.pane {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-width: 0;
		overflow-y: auto;
		overflow-x: hidden;
		overscroll-behavior: contain;
		background: var(--surface);
	}
	.empty {
		margin: var(--space-3) 0;
		color: var(--ink-2);
		font-size: var(--text-sm);
	}
	.nodes {
		list-style: none;
		margin: var(--space-2) 0 var(--space-4);
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.nodes li {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.meta {
		font-size: var(--text-xs);
		color: var(--ink-2);
		padding-left: var(--space-3);
	}
	.error {
		margin: var(--space-3) 0;
		font-size: var(--text-xs);
		color: var(--error);
		/* An error can name a long path, and it must break rather than widen the pane. */
		overflow-wrap: anywhere;
	}
	.add {
		align-self: flex-start;
		margin-top: var(--space-1);
		padding: var(--space-2) var(--space-3);
		border: 1px dashed var(--rule);
		border-radius: var(--radius);
		background: none;
		font: inherit;
		font-size: var(--text-sm);
		color: var(--ink-2);
	}
	.add:hover {
		border-style: solid;
		color: var(--ink);
	}
</style>
