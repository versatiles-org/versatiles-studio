<script lang="ts">
	import type { Bounds } from '../../ipc/commands';

	// Writing one graph to a container (S3.6, F2, [Q32]).
	//
	// **A modal, and the only one in the pane.** Everything else here edits the document, so it
	// belongs beside it; this commits a run that takes minutes, and a form that competes with the
	// chain for height would push the thing being exported off screen. Nothing in it needs the map,
	// which is what makes numeric bounds the honest input rather than a rectangle dragged on the
	// map — that is F2's crop, a different feature arriving at S5.4.
	//
	// A native `<dialog>`: modality, focus containment and Escape are the browser's, and the top
	// layer puts it above every z-index in the application, including the status bar.
	let {
		name,
		formats,
		onCancel,
		onExport
	}: {
		/** The graph being written. Named, because a project has several ([Q32]). */
		name: string;
		/** What Studio can write, from the core — the extensions the file dialog will offer. */
		formats: string[];
		onCancel: () => void;
		/** Runs when the numbers are usable; choosing the file is the caller's next step. */
		onExport: (bounds: Bounds) => void;
	} = $props();

	let dialog = $state<HTMLDialogElement>();

	// `showModal()` rather than the `open` attribute: only the method puts the element in the top
	// layer and makes Escape and focus containment work.
	$effect(() => dialog?.showModal());

	/// Held as text, not numbers, because "empty" is a value here and `0` is a different one — a
	/// `bind:value` on a number input turns a cleared field into `undefined` on some inputs and
	/// `NaN` on others, and both would arrive as "no bound" when the user meant zero.
	let minZoom = $state('');
	let maxZoom = $state('');
	let west = $state('');
	let south = $state('');
	let east = $state('');
	let north = $state('');

	const box = $derived([west, south, east, north]);
	const filled = $derived(box.filter((value) => value.trim() !== '').length);

	/// What is wrong, or `null`. Only what the form can see: the core refuses an inside-out box and
	/// an empty zoom range, and says so in its own words before a job is started.
	const problem = $derived.by(() => {
		if (filled > 0 && filled < 4) return 'A bounding box needs all four edges, or none.';
		if (box.some((value) => value.trim() !== '' && !Number.isFinite(Number(value)))) {
			return 'The bounding box takes numbers in degrees.';
		}
		return null;
	});

	const number = (raw: string) => (raw.trim() === '' ? null : Number(raw));

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (problem) return;
		onExport({
			bbox: filled === 4 ? [Number(west), Number(south), Number(east), Number(north)] : null,
			minZoom: number(minZoom),
			maxZoom: number(maxZoom)
		});
	}
</script>

<dialog bind:this={dialog} oncancel={onCancel} onclose={onCancel} aria-label="Export {name}">
	<form onsubmit={submit}>
		<h2>Export {name}</h2>
		<p class="lead">
			Writes everything the graph produces. Leave a field empty to keep what the pipeline already covers.
		</p>

		<fieldset>
			<legend class="section-label">Zoom</legend>
			<div class="pair">
				<label>from <input bind:value={minZoom} type="number" min="0" max="30" inputmode="numeric" /></label>
				<label>to <input bind:value={maxZoom} type="number" min="0" max="30" inputmode="numeric" /></label>
			</div>
		</fieldset>

		<fieldset>
			<legend class="section-label">Bounding box</legend>
			<div class="box">
				<label>west <input bind:value={west} type="number" step="any" inputmode="decimal" /></label>
				<label>south <input bind:value={south} type="number" step="any" inputmode="decimal" /></label>
				<label>east <input bind:value={east} type="number" step="any" inputmode="decimal" /></label>
				<label>north <input bind:value={north} type="number" step="any" inputmode="decimal" /></label>
			</div>
		</fieldset>

		<p class="note">Degrees. Studio writes {formats.join(', ')} — the file you choose decides which.</p>

		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

		<div class="actions">
			<button type="button" class="button" onclick={onCancel}>Cancel</button>
			<button type="submit" class="button primary" disabled={problem !== null}>Choose file…</button>
		</div>
	</form>
</dialog>

<style>
	dialog {
		width: min(28rem, calc(100vw - var(--space-6)));
		padding: 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		background: var(--surface);
		color: var(--ink);

		&::backdrop {
			background: var(--scrim);
		}
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-5);
	}

	h2 {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.lead,
	.note {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--text-sm);
	}

	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	legend {
		padding: 0;
	}

	/* Two columns for a range, four for a box — the shape says which is which before the labels do. */
	.pair,
	.box {
		display: grid;
		gap: var(--space-2);
	}

	.pair {
		grid-template-columns: repeat(2, 1fr);
	}

	.box {
		grid-template-columns: repeat(2, 1fr);
	}

	label {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		color: var(--ink-2);
		font-size: var(--text-xs);

		input {
			min-width: 0;
			flex: 1;
			/* A coordinate is machine text, and these line up in a grid. */
			font-family: var(--font-mono);
			text-align: right;
		}
	}

	.problem {
		margin: 0;
		color: var(--error);
		font-size: var(--text-sm);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	.primary {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-ink);
	}
</style>
