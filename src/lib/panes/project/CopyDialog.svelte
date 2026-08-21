<script lang="ts">
	import type { CopyPlan } from '../../ipc/commands';
	import { bytes as formatBytes, count } from '../../common/format';

	// A copy of the project that works somewhere else (G1, S5.1).
	//
	// **Why this is not just "Save project" into another folder.** A pipeline names its source with
	// the path the file was imported from — an absolute one, under this account, on this machine.
	// Copy that folder to a colleague and every graph in it points at a file that is not there. This
	// carries the data in and rewrites the pipelines to name the copies.
	//
	// **What it will cost is shown before it is asked where to put it.** Tile containers are
	// gigabytes, and the honest moment to say so is before a file dialog, not during a copy that
	// cannot be interrupted.

	let {
		plan,
		onCancel,
		onWrite
	}: {
		plan: CopyPlan;
		onCancel: () => void;
		/** `zip` decides which kind of destination the caller asks for. */
		onWrite: (zip: boolean) => void;
	} = $props();

	let dialog = $state<HTMLDialogElement>();
	$effect(() => dialog?.showModal());

	/// A zip by default: a copy exists to be sent to somebody, and one file is what you attach.
	let zip = $state(true);

	const total = $derived(plan.carry.reduce((sum, file) => sum + file.bytes, 0));
</script>

<dialog bind:this={dialog} oncancel={onCancel} onclose={onCancel} aria-label="Save a copy">
	<div class="body">
		<h2>Save a copy</h2>
		<p class="lead">
			Carries the data your pipelines read, and rewrites them to name the copies — so the result opens on another
			machine.
		</p>

		<fieldset>
			<legend class="section-label">As</legend>
			<label class="choice">
				<input type="radio" bind:group={zip} value={true} />
				<span>One <code>.zip</code> file</span>
			</label>
			<label class="choice">
				<input type="radio" bind:group={zip} value={false} />
				<span>A folder</span>
			</label>
		</fieldset>

		<section>
			<h3 class="section-label">Carries</h3>
			{#if plan.carry.length === 0}
				<p class="note">Nothing — every source is a URL, so the copy needs no data beside it.</p>
			{:else}
				<p class="total">
					<strong>{count(plan.carry.length)} files · {formatBytes(total)}</strong>
				</p>
				<ul class="files">
					{#each plan.carry as file (file.to)}
						<li>
							<span class="path">{file.to}</span>
							<span class="size">{formatBytes(file.bytes)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- Said rather than refused: a project with one moved source is still worth copying, and the
		     copy keeps the name it had so it works wherever that file does exist. -->
		{#if plan.missing.length > 0}
			<section class="missing">
				<h3 class="section-label">Not found, so not carried</h3>
				<ul class="files">
					{#each plan.missing as reference (reference.graph + reference.field + reference.value)}
						<li>
							<span class="path">{reference.value}</span>
							<span class="size">{reference.graph}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<div class="actions">
			<button type="button" class="button" onclick={onCancel}>Cancel</button>
			<button type="button" class="button primary" onclick={() => onWrite(zip)}>
				{zip ? 'Choose file…' : 'Choose folder…'}
			</button>
		</div>
	</div>
</dialog>

<style>
	dialog {
		width: min(32rem, calc(100vw - var(--space-6)));
		padding: 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		background: var(--surface);
		color: var(--ink);

		&::backdrop {
			background: var(--scrim);
		}
	}

	.body {
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
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		border: 0;
	}

	legend {
		padding: 0;
	}

	.choice {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.total {
		margin: 0;
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}

	/* Scrolls: a project can name a dozen sources, and the buttons have to stay reachable. */
	.files {
		max-height: 9rem;
		overflow: auto;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-xs);

		li {
			display: flex;
			justify-content: space-between;
			gap: var(--space-3);
			padding: var(--space-1) 0;
			border-bottom: 1px solid var(--rule);
		}
	}

	.path {
		overflow: hidden;
		font-family: var(--font-mono);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.size {
		flex: none;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.missing .path {
		color: var(--error);
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
