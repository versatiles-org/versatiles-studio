<script lang="ts">
	import type { Preview } from '../../ipc/commands';

	// What the pipeline is producing — the "resulting metadata" half of the right pane (Q22).
	//
	// The parameters above it say what was *asked for*; this says what came out, which for an import
	// is the only way to tell a working one from a silent failure. A GeoJSON that produced no
	// features, or a layer named after the wrong file, looks exactly like a success on the map at
	// low zoom: empty.
	//
	// It is not the Inspector. That one reports on an opened *container* (A6), and an imported
	// GeoJSON is not a container — the pipeline's output is the only thing there is to describe.
	let { preview }: { preview: Preview | null } = $props();

	/// Layer sizes are a tile's worth, not the file's, so they are given as such rather than as a
	/// total nobody measured.
	const total = $derived(preview?.layers.reduce((sum, layer) => sum + layer.featureCount, 0) ?? 0);
</script>

{#if preview}
	<section class="output">
		<h2 class="section-label">Produces</h2>

		<dl class="facts">
			<dt>format</dt>
			<dd>{preview.info.tileFormat}</dd>
			<dt>zoom</dt>
			<dd>{preview.info.minZoom}–{preview.info.maxZoom}</dd>
			{#if preview.info.bbox}
				<dt>extent</dt>
				<dd class="mono truncate" title={preview.info.bbox.join(', ')}>
					{preview.info.bbox.map((n) => n.toFixed(2)).join(', ')}
				</dd>
			{/if}
		</dl>

		{#if preview.layers.length > 0}
			<!-- Probed from one tile, so the counts are that tile's. Said here rather than left to be
			     inferred from a number that looks like a total and is not. -->
			<h3 class="section-label">
				{preview.layers.length === 1 ? '1 layer' : `${preview.layers.length} layers`}, {total} features in the sampled tile
			</h3>
			<ul>
				{#each preview.layers as layer (layer.name)}
					<li>
						<span class="name truncate" title={layer.name}>{layer.name}</span>
						<span class="count">{layer.featureCount}</span>
						{#if layer.propertyKeys.length > 0}
							<span class="keys truncate" title={layer.propertyKeys.join(', ')}>
								{layer.propertyKeys.join(', ')}
							</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style>
	.output {
		min-width: 0;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--rule);
		background: var(--surface);
	}

	h3 {
		margin: var(--space-4) 0 var(--space-2);
	}

	.facts {
		display: grid;
		/* The label column sizes to its widest label and stops there; the value column takes the
		   rest and is allowed to shrink, which is what keeps a long extent from widening the pane. */
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--space-1) var(--space-3);
		margin: 0;
		font-size: var(--text-sm);
	}

	dt {
		color: var(--ink-2);
	}

	dd {
		margin: 0;
		min-width: 0;
	}

	.mono {
		font-family: var(--font-mono);
		font-size: var(--text-mono-adjust);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-sm);
	}

	li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0 var(--space-3);
		padding: var(--space-1) 0;
	}

	.name {
		font-weight: 500;
	}

	.count {
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.keys {
		grid-column: 1 / -1;
		min-width: 0;
		color: var(--ink-2);
		font-size: var(--text-xs);
	}
</style>
