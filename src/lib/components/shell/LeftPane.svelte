<script lang="ts">
	import PaneSection from './PaneSection.svelte';
	import VplNodeCard from './VplNodeCard.svelte';
	import VplEditor from './VplEditor.svelte';
	import {
		vplParse,
		vplRemoveProperty,
		vplSetValue,
		vplTokens,
		type VplToken,
		type ContainerInfo,
		type Layout,
		type Span,
		type VplNode,
		type DocumentView
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
		onVplChange,
		pipeline,
		pipelineRevision,
		onPipelineChange
	}: {
		layout: Layout;
		containers: { info: ContainerInfo; vpl: string }[];
		onLayoutChange: (layout: Layout) => void;
		onAddSource: () => void;
		/** The node's VPL after an edit. The caller decides what a changed node means. */
		onVplChange: (source: string, vpl: string) => void;
		/** This window's pipeline, owned by the core (Q25). */
		pipeline: DocumentView | null;
		/** Bumped only when the document changes from *outside* the editor. Keying the editor on the
		 *  text itself would remount it on its own edits and throw the caret away. */
		pipelineRevision: number;
		onPipelineChange: (text: string) => void;
	} = $props();

	// Q15 wants one pane with two tabs rather than two panes. The graph itself arrives at S2.5, so
	// the first tab is honestly called what it currently is.
	let tab = $state<'nodes' | 'vpl'>('nodes');

	// Typing produces text that is often mid-edit and invalid; the *document* never is (Q25). The
	// editor keeps the text, so what is tracked here is only what has to be painted over it.
	let draftError = $state<{ message: string; span: Span } | null>(null);
	let draftTokens = $state<VplToken[] | null>(null);

	const tokens = $derived(draftTokens ?? pipeline?.tokens ?? []);

	// Ordering guard: keystrokes race, and an older reply must not repaint over a newer one.
	let typed = 0;

	async function type(next: string) {
		const mine = ++typed;
		try {
			const painted = await vplTokens(next);
			if (mine !== typed) return;
			draftTokens = painted;
			draftError = null;
			onPipelineChange(next);
		} catch (error) {
			if (mine !== typed) return;
			// Invalid text while typing is normal: mark it, keep the last good highlighting so the
			// editor does not go blank, and leave the document as it was.
			draftError = toVplError(error);
		}
	}

	function toVplError(error: unknown): { message: string; span: Span } {
		if (typeof error === 'object' && error !== null && 'span' in error && 'message' in error) {
			return error as { message: string; span: Span };
		}
		return { message: String(error), span: { start: 0, end: 0 } };
	}

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
		<div class="tabs" role="tablist" aria-label="Pipeline view">
			{#each [['nodes', 'Nodes'], ['vpl', 'VPL']] as const as [id, label] (id)}
				<button
					type="button"
					role="tab"
					class="tab"
					class:selected={tab === id}
					aria-selected={tab === id}
					onclick={() => (tab = id)}
				>
					{label}
					<!-- Q15: the VPL tab carries the badge when the text does not parse (C4). -->
					{#if id === 'vpl' && draftError}<span class="badge" aria-label="has an error">!</span>{/if}
				</button>
			{/each}
		</div>

		{#if tab === 'vpl'}
			{#if draftError}<p class="error" role="alert">{draftError.message}</p>{/if}
			<!-- Remounted only when the document changes from outside the editor, which is what lets the
			     editor own its buffer without the parent fighting it (Q25). -->
			{#key pipelineRevision}
				<VplEditor initialText={pipeline?.text ?? ''} {tokens} error={draftError} onInput={(next) => void type(next)} />
			{/key}
		{:else if containers.length === 0}
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
		{#if parseError && tab === 'nodes'}<p class="error">{parseError}</p>{/if}
		{#if tab === 'nodes'}
			<button type="button" class="add" onclick={onAddSource}>+ Add source</button>
		{/if}
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
	.tabs {
		display: flex;
		gap: var(--space-1);
		margin: 0 0 var(--space-3);
		border-bottom: 1px solid var(--rule);
	}
	.tab {
		background: none;
		border: 0;
		border-bottom: 2px solid transparent;
		border-radius: 0;
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
	.tab.selected {
		color: var(--ink);
		border-bottom-color: var(--accent);
	}
	.tab:focus-visible {
		outline-offset: -2px;
	}
	.badge {
		display: inline-block;
		margin-left: var(--space-1);
		padding: 0 var(--space-1);
		border-radius: var(--radius);
		background: var(--error);
		color: var(--accent-ink);
		font-size: var(--text-xs);
	}
	.empty {
		margin: var(--space-3) 0;
		color: var(--ink-2);
	}
	.nodes {
		margin: var(--space-2) 0 var(--space-4);
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
		color: var(--ink-2);
	}
	.add:hover {
		border-style: solid;
		color: var(--ink);
	}
</style>
