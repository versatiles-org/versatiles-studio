<script lang="ts">
	import VplEditor from './VplEditor.svelte';
	import NodeChain from './NodeChain.svelte';
	import GraphList from './GraphList.svelte';
	import { nodeAt, samePath } from '../../vpl/node-at';
	import {
		vplReview,
		type VplToken,
		type Diagnostic,
		type Span,
		type DocumentView,
		type ImportKind,
		type Fit,
		type OperationInfo,
		type GraphInfo
	} from '../../ipc/commands';
	import ImportCards from '../../common/ImportCards.svelte';

	// The Pipeline pane's contents (Q22, [Q31]).
	//
	// The pane *wrapper* — title, fold, which sidebar — is `Sidebar`'s business; this is only what
	// goes inside one. That separation is the whole of Q31: where a pane sits became data, so this
	// file has no opinion about it.
	//
	// There is deliberately no Sources pane — the `from_container` read nodes at the head of the
	// pipeline *are* the sources, and a separate list would show the same nodes twice (Q14).
	//
	// Style arrives at S4 and Export at S5. Their sections are not stubbed out here: an empty
	// section that does nothing teaches the wrong thing about what the pane contains.
	let {
		kinds,
		operations = [],
		properties = [],
		fits = [],
		suggestions = {},
		graphs = [],
		pinned = null,
		pipeline,
		pipelineRevision,
		graphActions,
		nodeActions,
		documentActions
	}: {
		/** Every way in this build has, offered by "+ Add source" (S3.2). */
		kinds: ImportKind[];
		/** Every known operation, for the transform picker. Empty until the one-off fetch lands. */
		operations?: OperationInfo[];
		/** Property names the pipeline produces, for list fields (S3.3). */
		properties?: string[];
		/** What can be appended to what the map is showing (S2.14). */
		fits?: Fit[];
		/** Per-field values read from what a node points at (S3.4). */
		suggestions?: Record<string, string[]>;
		/** Every graph in the project ([Q32]). */
		graphs?: GraphInfo[];
		/** The pinned node, when the pin is in *this* graph. */
		pinned?: number[] | null;
		/** This window's pipeline, owned by the core (Q25). */
		pipeline: DocumentView | null;
		/** Bumped only when the document changes from *outside* the editor. Keying the editor on the
		 *  text itself would remount it on its own edits and throw the caret away. */
		pipelineRevision: number;

		// Grouped by what they act on rather than passed one by one. Most of these this file never
		// calls — it receives them and hands them to `GraphList` or `Chain` — and fourteen loose
		// callbacks made a signature where the six it *does* use were impossible to pick out.

		/** Acting on the set of graphs. Adding a source creates one ([Q32]). */
		graphActions: {
			select: (id: number) => void;
			rename: (id: number, name: string) => void;
			/** Removes it for good — the history cannot restore a graph that is gone ([Q32]). */
			remove: (id: number) => void;
			addSource: (kind: ImportKind) => void;
		};
		/** Acting on a node or one of its arguments. */
		nodeActions: {
			/** Moves the map to this node, or clears the pin when it is already there. */
			pin: (path: number[]) => void;
			/** Inserts a transform after the node whose name occupies `span`. */
			addOperation: (afterNameSpan: Span, operation: string) => void;
			remove: (span: Span) => void;
			commitValue: (span: Span, value: string) => void;
			removeProperty: (span: Span) => void;
			setProperty: (nameSpan: Span, key: string, values: string[]) => void;
		};
		/** Acting on the document as a whole. One undo stack for every view (G6). */
		documentActions: {
			change: (text: string) => void;
			undo: () => void;
			redo: () => void;
			/** `true` to choose a new file rather than writing to the one already open. */
			save: (chooseFile: boolean) => void;
			/** Opens the export modal for this graph — a run, not an edit ([Q32]). */
			export: () => void;
		};
	} = $props();

	// Q15: one pane, two tabs over one document — not two panes.
	let tab = $state<'graph' | 'vpl'>('graph');
	/// Whether "+ Add source" has been opened into its cards. Local: which way in someone is part
	/// way through choosing is not worth remembering across a reload.
	let adding = $state(false);

	// **The graph no longer moves the caret.** [Q15](../../../docs/decisions.md) had selection
	// running both ways between the tabs; a node is not clickable any more, so only the text side is
	// left — the caret still follows into the graph, and `caretMoved` is what does it.

	/** The caret moved in the text; follow it in the graph, but do not fight the editor's own
	 *  selection by pushing one back at it. */
	function caretMoved(offset: number) {
		const found = pipeline ? nodeAt(pipeline.pipeline, offset) : null;
		if (!samePath(found?.path ?? null, selected)) nodeActions.select(found?.path ?? null);
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
			documentActions.change(next);
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
</script>

<div class="pane">
	<!-- The project's graphs, above the one being edited ([Q32]). -->
	<GraphList
		{graphs}
		current={pipeline?.graph ?? null}
		pinnedGraph={pinned ? (pipeline?.graph ?? null) : null}
		onSelect={graphActions.select}
		onRename={graphActions.rename}
		onRemove={graphActions.remove}
		onNew={() => (adding = !adding)}
	/>

	<!-- The same cards the landing screen shows, from one catalogue (S3.2). A graph *is* a source
	     under [Q32], so "+ Add source" and "new graph" were two doors to the same room; this is the
	     one door, next to where graphs live. Folded away until asked for: a pane is not a launcher. -->
	{#if adding}
		<ImportCards
			{kinds}
			compact
			onChoose={(kind) => {
				adding = false;
				graphActions.addSource(kind);
			}}
		/>
	{/if}

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
				onclick={documentActions.undo}>↺</button
			>
			<button
				type="button"
				class="step"
				disabled={!pipeline?.canRedo}
				title="Redo (⇧⌘Z)"
				aria-label="Redo"
				onclick={documentActions.redo}>↻</button
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
		<NodeChain
			pipeline={pipeline.pipeline}
			{pinned}
			{operations}
			{properties}
			{fits}
			{suggestions}
			onPin={nodeActions.pin}
			onCommit={nodeActions.commitValue}
			onRemove={nodeActions.removeProperty}
			onSet={(span, key, values) => nodeActions.setProperty(span, key, values)}
			onRemoveNode={nodeActions.remove}
			onAddOperation={nodeActions.addOperation}
		/>
	{/if}
	<!-- Actions on the pipeline itself, available from either tab. Saving a *project* is a
		     different command with a different scope (G1, S5.1); this writes the pipeline as the
		     `.vpl` the CLI already reads. -->
	<div class="actions">
		<div class="files">
			<button
				type="button"
				class="button file"
				disabled={!pipeline || (!pipeline.dirty && pipeline.path !== null)}
				title={pipeline?.path ?? 'Choose where to save'}
				onclick={() => documentActions.save(false)}
			>
				Save{#if pipeline?.dirty && pipeline.path}<span class="dot" aria-label="unsaved changes">•</span>{/if}
			</button>
			<button type="button" class="button file" disabled={!pipeline} onclick={() => documentActions.save(true)}
				>Save as…</button
			>
			<!-- Exporting is per graph ([Q32]): this writes what *this* chain produces, and the
			     modal is where the run is committed. -->
			<button type="button" class="button file" disabled={!pipeline} onclick={documentActions.export}>Export…</button>
		</div>
	</div>
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
		border-bottom: 2px solid transparent;
		border-radius: 0;
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-xs);
		color: var(--ink-2);

		&.selected {
			color: var(--ink);
			border-bottom-color: var(--accent);
		}

		&:focus-visible {
			outline-offset: -2px;
		}
	}

	.history {
		margin-left: auto;
		display: flex;
		gap: var(--space-1);
	}

	.step {
		border-radius: var(--radius);
		padding: 0 var(--space-2);
		color: var(--ink-2);

		&:hover:not(:disabled) {
			background: var(--chrome);
			color: var(--ink);
		}

		&:disabled {
			opacity: 0.35;
		}
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

		&:disabled {
			opacity: 0.45;
		}
	}

	.dot {
		color: var(--accent);
		margin-left: 1px;
	}
</style>
