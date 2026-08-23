<script lang="ts">
	import Modal from '../../common/Modal.svelte';
	import type { Bounds, Estimate } from '../../ipc/commands';
	import { bytes, count, duration } from '../../common/format';

	// Writing one graph to a container (S3.6, F2, [Q32]).
	//
	// **What is left after the crop moved into the pane** (S5.2). This dialog used to carry the zoom
	// range and four bbox fields as well — and it is a modal, so it covered the map those numbers are
	// about. Cropping is looking-and-adjusting work and belongs beside the graph; committing a run
	// that takes minutes is a decision, and belongs behind a modal.
	//
	// So this states what will be written and asks for the file. It sets nothing: everything on it
	// is a consequence of the crop in the pane, shown once more because "choose a file" is the last
	// moment to notice that the crop is not the one you meant.
	//
	// A native `<dialog>`: modality, focus containment and Escape are the browser's, and the top
	// layer puts it above every z-index in the application, including the status bar.
	let {
		name,
		formats,
		crop,
		estimate,
		estimating,
		refusal,
		onCancel,
		onExport
	}: {
		/** The graph being written. Named, because a project has several ([Q32]). */
		name: string;
		/** What Studio can write, from the core — the extensions the file dialog will offer. */
		formats: string[];
		/** What the graph is narrowed to. Set in the pane; read here.  */
		crop: Bounds;
		/** What that will cost (S3.7, C6) — the same estimate the pane is showing. */
		estimate: Estimate | null;
		estimating: boolean;
		/** The core's refusal, when the crop is one it will not run. */
		refusal: string | null;
		onCancel: () => void;
		/** Runs when the file may be chosen; picking it is the caller's next step. */
		onExport: () => void;
	} = $props();

	/// The crop in a sentence — "zoom 4–12, 13.0 −52.3 → 13.8 52.7" — or what it means to have none.
	const narrowing = $derived.by(() => {
		const parts: string[] = [];
		if (crop.minZoom !== null || crop.maxZoom !== null) {
			parts.push(`zoom ${crop.minZoom ?? 'min'}–${crop.maxZoom ?? 'max'}`);
		}
		if (crop.bbox) {
			const [west, south, east, north] = crop.bbox;
			parts.push(`${west}, ${south} → ${east}, ${north}`);
		}
		return parts;
	});

	const cost = $derived(estimate === null ? null : `${bytes(estimate.bytes)} · about ${duration(estimate.seconds)}`);
</script>

<Modal title="Export {name}" width="28rem" onClose={onCancel}>
	<dl>
		<dt>Writes</dt>
		<dd>
			{#if narrowing.length === 0}
				Everything the graph produces.
			{:else}
				{narrowing.join(' · ')}
			{/if}
		</dd>
		<dt>Format</dt>
		<dd>{formats.join(', ')} — the file you choose decides which.</dd>
	</dl>

	<!-- Directly above the button that commits the run, which is the only place it can change a
		     decision. `aria-live` because it can still arrive while this is open. -->
	<p class="cost" aria-live="polite" class:waiting={estimating}>
		{#if refusal}
			<span class="problem">{refusal}</span>
		{:else if estimate === null}
			{estimating ? 'Estimating…' : 'Estimating the size and time…'}
		{:else if estimate.tiles === 0}
			Nothing to write — this crop selects no tiles.
		{:else}
			<strong>{cost}</strong>
			<span class="basis">{count(estimate.tiles)} tiles, from {estimate.sampled} sampled</span>
		{/if}
	</p>

	<p class="note">Change what is written with the crop in the Pipeline pane.</p>

	{#snippet actions()}
		<button type="button" class="button" onclick={onCancel}>Cancel</button>
		<button type="button" class="button primary" disabled={refusal !== null} onclick={onExport}> Choose file… </button>
	{/snippet}
</Modal>

<style>
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-1) var(--space-3);
		margin: 0;
		font-size: var(--text-sm);
	}

	dt {
		color: var(--ink-2);
	}

	dd {
		margin: 0;
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
