<script lang="ts">
	import Modal from '../../common/Modal.svelte';
	import type { Bounds, Compression, Estimate, Preview } from '../../ipc/commands';
	import { bytes, count } from '../../common/format';
	import { untrack } from 'svelte';

	// Writing one graph to a container (S3.6, F2, [Q32]).
	//
	// **What is left after the crop moved into the pane** (S5.2). This dialog used to carry the zoom
	// range and four bbox fields as well - and it is a modal, so it covered the map those numbers are
	// about. Cropping is looking-and-adjusting work and belongs beside the graph; committing a run
	// that takes minutes is a decision, and belongs behind a modal.
	//
	// So this states what will be written and asks for the file. It sets nothing: everything on it
	// is a consequence of the crop in the pane, shown once more because "choose a file" is the last
	// moment to notice that the crop is not the one you meant.
	//
	// **What the graph produces is here too** ([Q41]), from the pane that used to hold it: format,
	// zoom, extent and the layers with their property keys. The same argument - this is the last
	// moment to notice that the layer you meant is not in the list, and the file about to be written
	// is the thing those numbers describe.
	//
	// A native `<dialog>`: modality, focus containment and Escape are the browser's, and the top
	// layer puts it above every z-index in the application, including the status bar.
	let {
		name,
		formats,
		crop,
		produces,
		onEstimate,
		onCancel,
		onExport
	}: {
		/** The graph being written. Named, because a project has several ([Q32]). */
		name: string;
		/** What Studio can write, from the core - the extensions the file dialog will offer. */
		formats: string[];
		/** What the graph is narrowed to. Set in the pane; read here.  */
		crop: Bounds;
		/** What the graph turns out to produce (S3.3), or null while it is being asked for - and on a
		 *  document that will not build, which is not a reason to refuse to show the rest.
		 *
		 *  **The graph's, not the map's.** With a node pinned, the preview describes that node
		 *  ([Q32]) and the export still writes the graph, so the caller asks for this one by name. */
		produces: Preview | null;
		/** Runs the estimate and resolves with it (S3.7, C6). Asked for, not arrived at: see the note
		 *  on `asked` below. Takes the encoding because the size depends on it. */
		onEstimate: (compression: Compression) => Promise<Estimate>;
		onCancel: () => void;
		/** Runs when the file may be chosen; picking it is the caller's next step. The container and
		 *  the encoding are settled here, so they go with it. */
		onExport: (choice: { format: string; compression: Compression }) => void;
	} = $props();

	/// The crop in a sentence - "zoom 4-12, 13.0 −52.3 → 13.8 52.7" - or what it means to have none.
	const narrowing = $derived.by(() => {
		const parts: string[] = [];
		if (crop.minZoom !== null || crop.maxZoom !== null) {
			parts.push(`zoom ${crop.minZoom ?? 'min'}-${crop.maxZoom ?? 'max'}`);
		}
		if (crop.bbox) {
			const [west, south, east, north] = crop.bbox;
			parts.push(`${west}, ${south} → ${east}, ${north}`);
		}
		return parts;
	});

	/// The container to write. Defaults to the first Studio offers, which is `versatiles`.
	///
	/// **This is the answer now, and the filename follows it** - see `exporting.start`. It used to be
	/// read off whatever was typed into the save dialog, which is one answer too, but not one you can
	/// see before committing to it.
	// `untrack` because this is the initial value and only that: the list is fetched once at
	// startup and this dialog is built after it, so there is nothing later to follow.
	let format = $state(untrack(() => formats[0]) ?? 'versatiles');

	/// How the tiles are encoded in the file. `source` keeps whatever the pipeline produces.
	let compression = $state<Compression>('source');

	/// **MBTiles stores one encoding per tile format** - gzip for `pbf`, uncompressed for the rest -
	/// and its writer re-encodes to that whatever it is handed, logging that it did. Offering a
	/// choice it will overrule would be a control that does nothing, so it says so instead.
	const fixedEncoding = $derived(format === 'mbtiles');

	/// The choice as it will actually be sent. A picker that is disabled must not keep sending what
	/// was selected before it was disabled.
	const wanted = $derived<Compression>(fixedEncoding ? 'source' : compression);

	/// Changing either of these changes the file, so an estimate taken before the change is about a
	/// file nobody is going to write. Cleared rather than re-run: the run costs seconds, and asking
	/// for it is the deliberate act this dialog is built around.
	$effect(() => {
		void format;
		void compression;
		asked = null;
	});

	/// The estimate this dialog asked for, or null until somebody asks.
	///
	/// **Not the pane's.** The pane estimates as the crop is dragged, because that is the loop it
	/// exists for (C6, S5.4). Here there is no loop: the crop is settled, and the numbers cost a run
	/// of the real pipeline. So the dialog opens saying what it will write, and spends those seconds
	/// only when asked to.
	let asked = $state<Estimate | null>(null);
	let running = $state(false);
	/// A refusal this run produced, as opposed to the standing one in `refusal`.
	let failed = $state<string | null>(null);

	async function estimate() {
		running = true;
		failed = null;
		try {
			asked = await onEstimate(wanted);
		} catch (error) {
			failed = error instanceof Error ? error.message : String(error);
		} finally {
			running = false;
		}
	}

	/// **Size only.** This said "· about 40 min" as well, from a duration the core no longer reports:
	/// it was measured by producing sample tiles one at a time and multiplying by the tile count,
	/// while a write produces them across the whole worker pool, so it over-stated the time by
	/// roughly the parallelism. A wrong number here is read as a promise; the status bar reports the
	/// real speed and ETA once the export is actually running.
	const cost = $derived(asked === null ? null : bytes(asked.bytes));

	/// Layer counts are a tile's worth, not the file's, so they are given as such rather than as a
	/// total nobody measured.
	const features = $derived(produces?.layers.reduce((sum, layer) => sum + layer.featureCount, 0) ?? 0);
</script>

<Modal title="Export {name}" width="32rem" onClose={onCancel}>
	<dl>
		{#if produces}
			<dt>Produces</dt>
			<dd>{produces.info.tileFormat} · zoom {produces.info.minZoom}-{produces.info.maxZoom}</dd>
			{#if produces.info.bbox}
				<dt>Extent</dt>
				<dd class="mono truncate" title={produces.info.bbox.join(', ')}>
					{produces.info.bbox.map((n) => n.toFixed(2)).join(', ')}
				</dd>
			{/if}
		{/if}
		<dt>Writes</dt>
		<dd>
			{#if narrowing.length === 0}
				Everything the graph produces.
			{:else}
				{narrowing.join(' · ')}
			{/if}
		</dd>
		<!-- `Container`, not `Format`: the row above already used that word for the tiles, and these
		     are the boxes they go in. -->
		<dt><label for="export-format">Container</label></dt>
		<dd>
			<select id="export-format" bind:value={format}>
				{#each formats as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</dd>
		<!-- How the tile bodies are encoded inside that container - a different question from the
		     format above, and the one that decides how big the file is. -->
		<dt><label for="export-compression">Compression</label></dt>
		<dd>
			<select id="export-compression" bind:value={compression} disabled={fixedEncoding}>
				<option value="source">Keep as produced</option>
				<option value="uncompressed">None</option>
				<option value="gzip">Gzip</option>
				<option value="brotli">Brotli</option>
				<option value="zstd">Zstd</option>
			</select>
			{#if fixedEncoding}
				<span class="aside">MBTiles sets its own.</span>
			{/if}
		</dd>
	</dl>

	{#if produces && produces.layers.length > 0}
		<!-- Probed from one tile, so the counts are that tile's. Said here rather than left to be
		     inferred from a number that looks like a total and is not. -->
		<section class="layers">
			<h3 class="section-label">
				{produces.layers.length === 1 ? '1 layer' : `${produces.layers.length} layers`}, {features} features in the sampled
				tile
			</h3>
			<ul>
				{#each produces.layers as layer (layer.name)}
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
		</section>
	{/if}

	<!-- Directly above the button that commits the run, which is the only place it can change a
		     decision. `aria-live` because the answer arrives while this is open, replacing the button
		     that asked for it. -->
	<p class="cost" aria-live="polite" class:waiting={running}>
		{#if failed}
			<span class="problem">{failed}</span>
		{:else if asked === null}
			<button type="button" class="button" disabled={running} onclick={() => void estimate()}>
				{running ? 'Estimating…' : 'Estimate size'}
			</button>
		{:else if asked.tiles === 0}
			Nothing to write - this crop selects no tiles.
		{:else}
			<strong>{cost}</strong>
			<span class="basis">{count(asked.tiles)} tiles, from {asked.sampled} sampled</span>
		{/if}
	</p>

	<p class="note">Change what is written with the crop in the Pipeline pane.</p>

	{#snippet actions()}
		<button type="button" class="button" onclick={onCancel}>Cancel</button>
		<button type="button" class="button primary" onclick={() => onExport({ format, compression: wanted })}>
			Choose file…
		</button>
	{/snippet}
</Modal>

<style>
	dl {
		display: grid;
		/* The value column may shrink, which is what keeps a long extent from widening the dialog. */
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

	.layers {
		min-width: 0;

		h3 {
			margin: 0 0 var(--space-2);
		}

		ul {
			margin: 0;
			padding: 0;
			list-style: none;
			/* A graph with twenty layers must not push the button that commits off the screen. */
			max-height: 14rem;
			overflow-y: auto;
			overscroll-behavior: contain;
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
	}

	.aside {
		margin-left: var(--space-2);
		color: var(--ink-2);
		font-size: var(--text-xs);
	}

	.note {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--text-xs);
	}

	.problem {
		margin: 0;
		color: var(--error);
		font-size: var(--text-sm);
	}

	/* Set apart from the description above it: this is the consequence of it, not more of it. */
	.cost {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0;
		padding-top: var(--space-3);
		border-top: 1px solid var(--rule);
		color: var(--ink-2);
		font-size: var(--text-sm);
		min-height: 2.5em;

		/* The column stretches its children; the button is a control and takes its own width. */
		button {
			align-self: flex-start;
		}

		strong {
			color: var(--ink);
			font-variant-numeric: tabular-nums;
		}
	}

	.waiting {
		opacity: 0.7;
	}

	.basis {
		font-size: var(--text-xs);
	}
</style>
