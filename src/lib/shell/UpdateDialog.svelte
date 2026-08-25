<script lang="ts">
	import { updates } from '../state/updates.svelte';
	import Modal from '../common/Modal.svelte';

	// Auto-update, as a person sees it (G4, S5.8, [Q47]).
	//
	// **It was a button and a live sentence on the application bar**, which was the right shape while
	// the bar existed and no shape at all once the verbs moved to the native menu (S0.1): a menu item
	// cannot say "Installing…", and it certainly cannot offer to restart.
	//
	// **A dialog is not a contradiction of "never interrupt".** What that rule is about is
	// *unsolicited* announcements — an application that stops your work to mention a patch release is
	// what people turn updaters off to escape. This opens because somebody just asked, and answering a
	// direct question is the one time a modal is the polite form.
	//
	// **Closing it never cancels anything.** An install carries on; reopening shows where it got to.
	// The state lives in `state/updates.svelte.ts`, so this component holds none of it.

	let { onClose }: { onClose: () => void } = $props();

	const state = $derived(updates.state);

	// Asked as it opens, because opening it *is* the question. Not when something is already known:
	// reopening after an install should show what happened, not throw it away and look again.
	$effect(() => {
		if (updates.state.kind === 'idle') void updates.check();
	});

	/// Whether another check would tell you anything you have not just been told.
	const canRecheck = $derived(state.kind === 'current' || state.kind === 'failed');
</script>

<Modal title="Software update" width="26rem" {onClose}>
	<!-- `aria-live` because every one of these arrives on its own, seconds after the dialog opened. -->
	<div class="said" aria-live="polite">
		{#if state.kind === 'checking'}
			<p>Looking for a newer version…</p>
		{:else if state.kind === 'current'}
			<p>Studio is up to date.</p>
		{:else if state.kind === 'available'}
			<p><strong>{state.version}</strong> is available.</p>
			<!-- The release notes, when there are any: what an update contains is the whole of what
			     someone is deciding about, and "an update is available" asks them to decide blind. -->
			{#if state.notes}<pre class="notes">{state.notes}</pre>{/if}
		{:else if state.kind === 'installing'}
			<p>Installing…</p>
		{:else if state.kind === 'ready'}
			<p><strong>{state.version}</strong> is installed, and starts with the next launch.</p>
		{:else if state.kind === 'failed'}
			<p class="problem">{state.message}</p>
		{/if}
	</div>

	{#snippet actions()}
		{#if canRecheck}
			<button type="button" class="button" onclick={() => void updates.check()}>Check again</button>
		{/if}
		{#if state.kind === 'available'}
			<button type="button" class="button primary" onclick={() => void updates.install()}>Install</button>
		{/if}
		<!-- Restarting is its own press: only the window knows whether there is unsaved work in it,
		     and deciding for someone is the same overreach as updating without asking. -->
		{#if state.kind === 'ready'}
			<button type="button" class="button primary" onclick={() => void updates.restart()}>Restart now</button>
		{/if}
		<button type="button" class="button" onclick={onClose}>
			{state.kind === 'ready' ? 'Later' : 'Close'}
		</button>
	{/snippet}
</Modal>

<style>
	.said {
		min-height: 3rem;

		p {
			margin: 0 0 var(--space-3);
		}

		strong {
			font-variant-numeric: tabular-nums;
		}
	}

	.problem {
		color: var(--error);
	}

	/* Scrolls on its own axis and wraps: release notes are somebody else's Markdown, and a long line
	   in them must not decide how wide this dialog is. */
	.notes {
		max-height: 9rem;
		overflow-y: auto;
		margin: 0;
		padding: var(--space-3);
		border-radius: var(--radius);
		background: var(--chrome);
		color: var(--ink-2);
		font-family: var(--font-mono);
		font-size: var(--text-mono-adjust);
		white-space: pre-wrap;
	}
</style>
