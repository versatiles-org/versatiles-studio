<script lang="ts">
	import VplEditor from './VplEditor.svelte';
	import NodeChain from './NodeChain.svelte';
	import {
		vplReview,
		type VplToken,
		type Diagnostic,
		type Span,
		type DocumentView,
		type Fit,
		type OperationInfo,
		type GraphInfo,
		type Bounds
	} from '../../ipc/commands';
	import CropSection from './CropSection.svelte';

	// The Pipeline pane's contents (Q22, [Q31]).
	//
	// The pane *wrapper* - title, fold, which sidebar - is `Sidebar`'s business; this is only what
	// goes inside one. That separation is the whole of Q31: where a pane sits became data, so this
	// file has no opinion about it.
	//
	// There is deliberately no Sources pane - the `from_container` read nodes at the head of the
	// pipeline *are* the sources, and a separate list would show the same nodes twice (Q14).
	//
	// Style arrives at S4 and Export at S5. Their sections are not stubbed out here: an empty
	// section that does nothing teaches the wrong thing about what the pane contains.
	let {
		operations = [],
		properties = [],
		fits = [],
		suggestions = {},
		graph = null,
		pipeline,
		pipelineRevision,
		crop,
		cropActions,
		nodeActions,
		documentActions
	}: {
		/** Every way in this build has, for the file dialog behind a path parameter (S3.2). */
		/** Every known operation, for the transform picker. Empty until the one-off fetch lands. */
		operations?: OperationInfo[];
		/** Property names the pipeline produces, for list fields (S3.3). */
		properties?: string[];
		/** What can be appended to what the map is showing (S2.14). */
		fits?: Fit[];
		/** Per-field values read from what a node points at, by node path then by field (S3.4). */
		suggestions?: Record<string, Record<string, string[]>>;
		/** The graph being edited, as the sources list holds it - its eyes and its counts ([Q49]). */
		graph?: GraphInfo | null;
		/** This window's pipeline, owned by the core (Q25). */
		pipeline: DocumentView | null;
		/** What an export of this graph is narrowed to, and what that costs (F2, C6, S5.2). */
		crop: {
			bounds: Bounds;
			drawing: boolean;
		} | null;
		/** Bumped only when the document changes from *outside* the editor. Keying the editor on the
		 *  text itself would remount it on its own edits and throw the caret away. */
		pipelineRevision: number;

		// Grouped by what they act on rather than passed one by one. Most of these this file never
		// calls - it receives them and hands them to `GraphList` or `Chain` - and fourteen loose
		// callbacks made a signature where the six it *does* use were impossible to pick out.

		/** Acting on the crop. It lives on the graph in the core, so all three go out. */
		cropActions: {
			set: (bounds: Bounds) => void;
			/** Turns rectangle-drawing on the map on or off. */
			draw: () => void;
			/** Crops to what the map is showing. */
			useView: () => void;
		};
		/** Acting on a node or one of its arguments. */
		nodeActions: {
			/** Switches a node on or off - the eye on its row in the chain ([Q49]). */
			setEnabled: (path: number[], enabled: boolean) => void;
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
			/** Lays the VPL out again, keeping its comments (S1.11). */
			format: () => void;
			/** `true` to choose a new file rather than writing to the one already open. */
			save: (chooseFile: boolean) => void;
			/** Opens the export modal for this graph - a run, not an edit ([Q32]). */
			export: () => void;
		};
	} = $props();

	/// The row for the graph being shown, which is where its eyes live ([Q49]). The list itself
	/// belongs to the Sources pane now ([Q50]); this pane needs one entry from it.
	const current = $derived(graph);

	// Q15: one pane, two tabs over one document - not two panes.
	let tab = $state<'graph' | 'vpl'>('graph');

	// **Neither tab moves a selection any more.** [Q15](../../../docs/decisions.md) had one running
	// both ways between them, so that switching landed you on the node you were looking at. It was
	// worth that when the graph showed one node's form; now every node shows its own, and there is
	// nothing for a selection to reveal on either side.

	// Typing produces text that is often mid-edit and invalid; the *document* never is (Q25). The
	// editor keeps the text, so what is tracked here is only what has to be painted over it.
	//
	// **All three belong to one document**, which is what `pipelineRevision` moving means they no
	// longer do - see the effect below.
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

	// **The draft is about the document it was typed into, and nothing else.**
	//
	// `pipelineRevision` is already the signal for "changed from outside the editor" - selecting
	// another graph, an undo, a reformat, a reload - and it is what remounts `VplEditor` with the new
	// text. These were left behind by that, so the new text was painted with the *previous*
	// document's token spans, and a parse error typed into the old one still hid the graph: the tab
	// said "The graph returns when the text parses" over a document that parses perfectly well.
	//
	// The counter moves with them, or a review already in flight for the old text lands afterwards
	// and puts it all back.
	$effect(() => {
		void pipelineRevision;
		typed += 1;
		draftError = null;
		draftTokens = null;
		draftDiagnostics = null;
	});

	async function type(next: string) {
		const mine = ++typed;
		try {
			const review = await vplReview(next);
			if (mine !== typed) return;
			draftTokens = review.tokens;
			draftDiagnostics = review.diagnostics;
			draftError = null;
			// A document that parses is worth keeping even when it does not yet make sense - the
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
	<!-- The tabs and what they switch between are one thing: a tab that floated a section's distance
	     from its own body would name something it does not appear to own. -->
	<div class="editor">
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
				<!-- In the VPL tab only: the graph tab has no layout of its own to tidy, and a button
			     that did nothing visible from there would read as broken. -->
				{#if tab === 'vpl'}
					<button
						type="button"
						class="step"
						disabled={!pipeline}
						title="Tidy the layout, keeping comments"
						aria-label="Format"
						onclick={documentActions.format}>¶</button
					>
				{/if}
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
				<VplEditor initialText={pipeline?.text ?? ''} {tokens} {problems} onInput={(next) => void type(next)} />
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
				disabled={current?.disabled ?? []}
				enabled={current?.enabled ?? true}
				{operations}
				{properties}
				{fits}
				{suggestions}
				onToggle={nodeActions.setEnabled}
				onCommit={nodeActions.commitValue}
				onRemove={nodeActions.removeProperty}
				onSet={(span, key, values) => nodeActions.setProperty(span, key, values)}
				onRemoveNode={nodeActions.remove}
				onAddOperation={nodeActions.addOperation}
			/>
		{/if}
	</div>

	<!-- Below the chain and above the actions, which is where it belongs in the reading: this is
	     what the graph will be narrowed to, between what it is and what to do with it. -->
	{#if crop && pipeline}
		<CropSection
			crop={crop.bounds}
			drawing={crop.drawing}
			onChange={cropActions.set}
			onDraw={cropActions.draw}
			onUseView={cropActions.useView}
		/>
	{/if}

	<!-- Actions on the pipeline itself, available from either tab. Saving a *project* is a
		     different command with a different scope (G1, S5.1); this writes the pipeline as the
		     `.vpl` the CLI already reads. -->
	<div class="actions">
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
		<!-- Exporting is per graph ([Q32]): this writes what *this* chain produces, and the modal is
		     where the run is committed. The primary one: it is what the other two lead to. -->
		<button type="button" class="button file primary" disabled={!pipeline} onclick={documentActions.export}
			>Export…</button
		>
	</div>
</div>

<style>
	/* The pane lives in a fixed grid column. Without `min-width: 0` here and on every descendant
	   that lays out children, a long path would set the column's content width and push the map off
	   the edge - flex and grid children default to `min-width: auto`, not zero. */
	/* **The pane states the hierarchy; its children no longer each bring their own margin.** Every
	   boundary here measured 26px - a row inside a node, a node against its rail, the chain against
	   the crop - so nothing said which of those was a break and which was a join. Four groups, one
	   section gap between them, and the groups hold their own parts closer. */
	.pane {
		display: flex;
		flex-direction: column;
		gap: var(--gap-section);
		height: 100%;
		min-width: 0;
		overflow-y: auto;
		overflow-x: hidden;
		overscroll-behavior: contain;
		background: var(--surface);
	}

	.editor {
		display: flex;
		flex-direction: column;
		gap: var(--gap-group);
		min-width: 0;
	}

	.tabs {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		margin: 0;
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
		margin: 0;
		color: var(--ink-2);
	}

	.error {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--error);
		/* An error can name a long path, and it must break rather than widen the pane. */
		overflow-wrap: anywhere;
	}

	/* Centred, and set apart from the chain above by a rule of its own: these are what the pane is
	   for, and they had been sitting in the far corner at the smallest size in the application -
	   read as a footnote rather than as the three things you came here to do. */
	.actions {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: var(--space-2);
		margin-top: 0;
		padding-top: var(--gap-section);
		border-top: 1px solid var(--rule);
		min-width: 0;
	}

	/* No size override: `.button`'s own padding, which is the pane scale. What was here shrank them
	   to `--text-xs` and a hairline of padding. */
	.file {
		&:disabled {
			opacity: 0.45;
		}
	}

	.dot {
		color: var(--accent);
		margin-left: 1px;
	}
</style>
