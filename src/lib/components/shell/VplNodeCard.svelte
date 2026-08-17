<script lang="ts">
	import type { VplNode, VplProperty, Span } from '../../ipc/commands';

	// One VPL node as a form: the operation name, then one field per parameter.
	//
	// Not one long line of VPL. Paths are routinely longer than the pane is wide, and a single
	// string forces a choice between wrapping (which breaks the syntax across lines) and scrolling
	// (which hides the parameter names). A field per parameter keeps the key visible and lets the
	// value scroll inside its own box. The generated forms at S2.6 replace these plain inputs with
	// typed controls from `field_meta`; the shape is already right.
	let {
		node,
		onCommit,
		onRemove
	}: {
		node: VplNode;
		/** Fired on blur or Enter — never per keystroke, which would reparse the document on every
		 *  character and fight the caret. */
		onCommit: (span: Span, value: string) => void;
		onRemove: (span: Span) => void;
	} = $props();

	/** Arrays are shown read-only until S2.6 gives them a proper editor. */
	function displayValue(property: VplProperty): string {
		return property.value.kind === 'single'
			? property.value.value
			: property.value.items.map((item) => item.value).join(', ');
	}

	function commit(property: VplProperty, event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const next = input.value;
		if (next === displayValue(property)) return;
		// VPL has no empty string (Q23), so an emptied field means remove the parameter — the only
		// other option would be writing something that does not parse.
		if (next.trim() === '') onRemove(property.span);
		else onCommit(property.value.span, next);
	}
</script>

<div class="node">
	<div class="name truncate" title={node.name}>{node.name}</div>
	{#if node.properties.length === 0}
		<p class="none">no parameters</p>
	{:else}
		<dl>
			{#each node.properties as property (property.keySpan.start)}
				<div class="row">
					<dt class="truncate" title={property.key}>{property.key}</dt>
					<dd>
						{#if property.value.kind === 'array'}
							<input type="text" value={displayValue(property)} title={displayValue(property)} readonly />
						{:else}
							<input
								type="text"
								value={property.value.value}
								title={property.value.value}
								spellcheck="false"
								autocomplete="off"
								onblur={(event) => commit(property, event)}
								onkeydown={(event) => {
									if (event.key === 'Enter') event.currentTarget.blur();
									if (event.key === 'Escape') {
										event.currentTarget.value = displayValue(property);
										event.currentTarget.blur();
									}
								}}
							/>
						{/if}
					</dd>
				</div>
			{/each}
		</dl>
	{/if}
</div>

<style>
	/* `min-width: 0` on every level: a grid or flex child defaults to `min-width: auto`, which is
	   its *content* width, so one long path would push the pane wider than its column and the map
	   would be squeezed off the side. This is the fix, and it has to be repeated down the chain. */
	.node {
		min-width: 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--chrome);
		padding: var(--space-3);
	}
	.name {
		font-family: var(--font-mono);
		font-weight: 600;
	}
	.none {
		margin: var(--space-2) 0 0;
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
	dl {
		margin: var(--space-3) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 5.5rem) minmax(0, 1fr);
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}
	dt {
		font-size: var(--text-xs);
		color: var(--ink-2);
	}
	dd {
		margin: 0;
		min-width: 0;
	}
	input {
		width: 100%;
		min-width: 0;
		padding: var(--space-1) var(--space-3);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink);
		/* The value scrolls inside the field rather than stretching it — the long-path case. */
		text-overflow: ellipsis;
	}
	/* A focused field shows the whole value rather than an ellipsis — the long-path case again. */
	input:focus {
		text-overflow: clip;
	}
	input:focus-visible {
		outline-offset: -1px;
	}
	input[readonly] {
		background: var(--chrome);
		color: var(--ink-2);
	}
</style>
