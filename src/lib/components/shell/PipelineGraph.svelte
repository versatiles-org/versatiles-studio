<script lang="ts">
	import { walk, samePath } from '../../vpl/node-at';
	import type { Diagnostic, VplNode, VplPipeline } from '../../ipc/commands';

	// The pipeline as a graph (C1, S2.5).
	//
	// Drawn as a vertical tree rather than a canvas of free-floating boxes, because that is the
	// shape VPL actually has: every node takes one input and produces one output, and the only
	// branching is a composite's `[ … ]` block. A node-editor canvas would suggest connections the
	// language cannot express, and would need far more width than the pane has.
	//
	// Sources are drawn above the node they feed — the direction the tiles move.
	let {
		pipeline,
		diagnostics = [],
		selected = null,
		onSelect
	}: {
		pipeline: VplPipeline;
		diagnostics?: Diagnostic[];
		/** Path of the selected node, shared with the text view (Q15). */
		selected?: number[] | null;
		onSelect: (path: number[], node: VplNode) => void;
	} = $props();

	const rows = $derived(walk(pipeline));

	/** A node is faulted when a diagnostic points anywhere inside it. */
	function faults(node: VplNode): Diagnostic[] {
		return diagnostics.filter((d) => d.span.start >= node.span.start && d.span.end <= node.span.end);
	}

	/** The parameters, short enough to read at a glance. The form is the right pane's job. */
	function summary(node: VplNode): string {
		return node.properties
			.map((property) => {
				const value = property.value.kind === 'single' ? property.value.value : `[${property.value.items.length}]`;
				return `${property.key}=${value}`;
			})
			.join(' ');
	}
</script>

<ol class="graph">
	{#each rows as row (row.path.join('.'))}
		{@const problems = faults(row.node)}
		<li style:--depth={row.depth}>
			<button
				type="button"
				class="node"
				class:selected={samePath(selected, row.path)}
				class:faulted={problems.length > 0}
				aria-current={samePath(selected, row.path)}
				title={problems.map((p) => p.message).join('\n') || undefined}
				onclick={() => onSelect(row.path, row.node)}
			>
				<span class="name truncate">{row.node.name}</span>
				{#if row.node.properties.length > 0}
					<span class="params truncate">{summary(row.node)}</span>
				{/if}
			</button>
			<!-- The connector belongs to the row below the one it leaves, so the last node has none. -->
			<span class="flow" aria-hidden="true"></span>
		</li>
	{/each}
</ol>

<style>
	.graph {
		display: flex;
		flex-direction: column;
		min-width: 0;
		margin: var(--space-2) 0 var(--space-3);
	}
	li {
		display: flex;
		flex-direction: column;
		min-width: 0;
		/* Nesting is indentation: a composite's inputs sit inside it. */
		margin-left: calc(var(--depth) * var(--space-5));
	}
	/* A short vertical line between one node and the next. Hidden after the last, which has no
	   successor to point at. */
	.flow {
		width: 1px;
		height: var(--space-3);
		margin-left: var(--space-4);
		background: var(--rule);
	}
	li:last-child .flow {
		display: none;
	}

	.node {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 1px;
		min-width: 0;
		width: 100%;
		text-align: left;
		padding: var(--space-2) var(--space-3);
		background: var(--chrome);
	}
	.node:hover {
		border-color: var(--ink-2);
	}
	.node.selected {
		border-color: var(--accent);
		background: var(--surface);
		box-shadow: inset 2px 0 0 var(--accent);
	}
	.node.faulted {
		border-color: var(--error);
	}

	.name {
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--ink);
	}
	.node.faulted .name {
		color: var(--error);
	}
	.params {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
</style>
