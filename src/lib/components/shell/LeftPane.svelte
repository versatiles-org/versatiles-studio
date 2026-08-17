<script lang="ts">
	import PaneSection from './PaneSection.svelte';
	import VplEditor from './VplEditor.svelte';
	import PipelineGraph from './PipelineGraph.svelte';
	import { nodeAt, nodeAtPath, samePath } from '../../vpl/node-at';
	import {
		vplParse,
		vplReview,
		type VplToken,
		type Diagnostic,
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
		onLayoutChange,
		onAddSource,
		pipeline,
		pipelineRevision,
		onPipelineChange,
		selected,
		onSelect,
		onUndo,
		onRedo,
		onSave
	}: {
		layout: Layout;
		onLayoutChange: (layout: Layout) => void;
		onAddSource: () => void;
		/** This window's pipeline, owned by the core (Q25). */
		pipeline: DocumentView | null;
		/** Bumped only when the document changes from *outside* the editor. Keying the editor on the
		 *  text itself would remount it on its own edits and throw the caret away. */
		pipelineRevision: number;
		onPipelineChange: (text: string) => void;
		/** Path of the selected node. Lifted out so the right pane can show its parameters (Q22). */
		selected: number[] | null;
		onSelect: (path: number[] | null) => void;
		/** One stack for every view (G6); the buttons are the discoverable half of ⌘Z. */
		onUndo: () => void;
		onRedo: () => void;
		/** `true` to choose a new file rather than writing to the one already open. */
		onSave: (chooseFile: boolean) => void;
	} = $props();

	// Q15: one pane, two tabs over one document — not two panes.
	let tab = $state<'graph' | 'vpl'>('graph');

	/** Where the caret should go when the VPL tab opens. Cleared once the editor has used it. */
	let reveal = $state<Span | null>(null);

	/** Selecting a node in either view selects it in the other (Q15). */
	function selectNode(path: number[], span: Span) {
		onSelect(path);
		reveal = span;
	}

	/** The caret moved in the text; follow it in the graph, but do not fight the editor's own
	 *  selection by pushing one back at it. */
	function caretMoved(offset: number) {
		const found = pipeline ? nodeAt(pipeline.pipeline, offset) : null;
		if (!samePath(found?.path ?? null, selected)) onSelect(found?.path ?? null);
	}

	// Typing produces text that is often mid-edit and invalid; the *document* never is (Q25). The
	// editor keeps the text, so what is tracked here is only what has to be painted over it.
	let draftError = $state<{ message: string; span: Span } | null>(null);
	let draftTokens = $state<VplToken[] | null>(null);
	let draftDiagnostics = $state<Diagnostic[] | null>(null);

	const tokens = $derived(draftTokens ?? pipeline?.tokens ?? []);
	/** A parse failure is one problem at one place; a parsed document can have several (C4). */
	const problems = $derived<Diagnostic[]>(
		draftError ? [draftError] : (draftDiagnostics ?? pipeline?.diagnostics ?? [])
	);

	// Ordering guard: keystrokes race, and an older reply must not repaint over a newer one.
	let typed = 0;

	async function type(next: string) {
		const mine = ++typed;
		try {
			const review = await vplReview(next);
			if (mine !== typed) return;
			draftTokens = review.tokens;
			draftDiagnostics = review.diagnostics;
			draftError = null;
			// A document that parses is worth keeping even when it does not yet make sense — the
			// diagnostics say what is wrong, and the graph and preview can still show the shape.
			onPipelineChange(next);
		} catch (error) {
			if (mine !== typed) return;
			// Text that does not parse is normal while typing: mark it, keep the last good
			// highlighting so the editor does not go blank, and leave the document as it was.
			draftError = toVplError(error);
		}
	}

	function toVplError(error: unknown): { message: string; span: Span } {
		if (typeof error === 'object' && error !== null && 'span' in error && 'message' in error) {
			return error as { message: string; span: Span };
		}
		return { message: String(error), span: { start: 0, end: 0 } };
	}

	/** Command rejections carry `{ message, span }` (C4); anything else is stringified. */
	function message(error: unknown): string {
		return typeof error === 'object' && error !== null && 'message' in error
			? String((error as { message: unknown }).message)
			: String(error);
	}
</script>

<div class="pane">
	<PaneSection
		title="Pipeline"
		open={layout.pipelineOpen}
		count={pipeline?.pipeline.nodes.length ?? 0}
		onToggle={(open) => onLayoutChange({ ...layout, pipelineOpen: open })}
	>
		<div class="tabs" role="tablist" aria-label="Pipeline view">
			{#each [['graph', 'Graph'], ['vpl', 'VPL']] as const as [id, label] (id)}
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
					{#if id === 'vpl' && problems.length > 0}
						<span class="badge" aria-label="{problems.length} problems">{problems.length}</span>
					{/if}
				</button>
			{/each}
			<div class="history">
				<button
					type="button"
					class="step"
					disabled={!pipeline?.canUndo}
					title="Undo (⌘Z)"
					aria-label="Undo"
					onclick={onUndo}>↺</button
				>
				<button
					type="button"
					class="step"
					disabled={!pipeline?.canRedo}
					title="Redo (⇧⌘Z)"
					aria-label="Redo"
					onclick={onRedo}>↻</button
				>
			</div>
		</div>

		{#if tab === 'vpl'}
			{#each problems as problem (problem.span.start + problem.message)}
				<p class="error" role="alert">{problem.message}</p>
			{/each}
			<!-- Remounted only when the document changes from outside the editor, which is what lets the
			     editor own its buffer without the parent fighting it (Q25). -->
			{#key pipelineRevision}
				<VplEditor
					initialText={pipeline?.text ?? ''}
					{tokens}
					{problems}
					selection={reveal}
					onInput={(next) => void type(next)}
					onCaret={caretMoved}
				/>
			{/key}
		{:else if draftError}
			<!-- Q15: the graph never shows a stale render. While the text does not parse there is no
			     tree to draw, and the last good one would be a picture of something that is no longer
			     on screen. -->
			<p class="error" role="alert">{draftError.message}</p>
			<p class="empty">The graph returns when the text parses.</p>
		{:else if !pipeline || pipeline.pipeline.nodes.length === 0}
			<p class="empty">Nothing open yet.</p>
		{:else}
			<PipelineGraph
				pipeline={pipeline.pipeline}
				diagnostics={problems}
				{selected}
				onSelect={(path, node) => selectNode(path, node.nameSpan)}
			/>
		{/if}
		<!-- Actions on the pipeline itself, available from either tab. Saving a *project* is a
		     different command with a different scope (G1, S5.1); this writes the pipeline as the
		     `.vpl` the CLI already reads. -->
		<div class="actions">
			{#if tab === 'graph'}
				<button type="button" class="add" onclick={onAddSource}>+ Add source</button>
			{/if}
			<div class="files">
				<button
					type="button"
					class="file"
					disabled={!pipeline || (!pipeline.dirty && pipeline.path !== null)}
					title={pipeline?.path ?? 'Choose where to save'}
					onclick={() => onSave(false)}
				>
					Save{#if pipeline?.dirty && pipeline.path}<span class="dot" aria-label="unsaved changes">•</span>{/if}
				</button>
				<button type="button" class="file" disabled={!pipeline} onclick={() => onSave(true)}>Save as…</button>
			</div>
		</div>
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
		align-items: center;
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
	.history {
		margin-left: auto;
		display: flex;
		gap: var(--space-1);
	}
	.step {
		border: 0;
		background: none;
		border-radius: var(--radius);
		padding: 0 var(--space-2);
		color: var(--ink-2);
	}
	.step:hover:not(:disabled) {
		background: var(--chrome);
		color: var(--ink);
	}
	.step:disabled {
		opacity: 0.35;
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
	.error {
		margin: var(--space-3) 0;
		font-size: var(--text-xs);
		color: var(--error);
		/* An error can name a long path, and it must break rather than widen the pane. */
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-3);
		min-width: 0;
	}
	.files {
		margin-left: auto;
		display: flex;
		gap: var(--space-2);
	}
	.file {
		padding: var(--space-1) var(--space-3);
		font-size: var(--text-xs);
	}
	.file:disabled {
		opacity: 0.45;
	}
	.dot {
		color: var(--accent);
		margin-left: 1px;
	}
	.add {
		align-self: flex-start;
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
