<script lang="ts">
	import { updates } from '../state/updates.svelte';

	// Auto-update, as a person sees it (G4, S5.8).
	//
	// **On the mode bar, not in a dialog.** An update is never urgent and never the reason the window
	// is open; a modal that interrupts what someone is doing to announce a patch release is the
	// behaviour people turn updaters off to escape. So it is a quiet line that says "Check for
	// updates" until it has something better to say.
	//
	// It occupies no space when idle beyond the button itself — the notice below only appears once
	// there is a state worth reading.

	const state = $derived(updates.state);
</script>

<div class="update">
	<button
		type="button"
		class="ghost"
		disabled={state.kind === 'checking' || state.kind === 'installing'}
		onclick={() => void updates.check()}
	>
		{#if state.kind === 'checking'}
			Checking…
		{:else if state.kind === 'installing'}
			Installing…
		{:else}
			Check for updates
		{/if}
	</button>

	<!-- `aria-live` because every one of these arrives on its own, seconds after the press. -->
	<span class="said" aria-live="polite">
		{#if state.kind === 'current'}
			Up to date.
		{:else if state.kind === 'available'}
			<strong>{state.version}</strong> is available.
			<button type="button" class="link" onclick={() => void updates.install()}>Install</button>
		{:else if state.kind === 'ready'}
			<strong>{state.version}</strong> is installed.
			<!-- Restarting is its own press: only the window knows whether there is unsaved work in
			     it, and deciding for someone is the same overreach as updating without asking. -->
			<button type="button" class="link" onclick={() => void updates.restart()}>Restart</button>
		{:else if state.kind === 'failed'}
			<span class="problem">{state.message}</span>
		{/if}
	</span>
</div>

<style>
	.update {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}

	.said {
		color: var(--ink-2);
		font-size: var(--text-xs);

		strong {
			color: var(--ink);
			font-variant-numeric: tabular-nums;
		}
	}

	.ghost {
		padding: var(--space-1) var(--space-2);
		color: var(--ink-2);
		font-size: var(--text-sm);

		&:hover:not(:disabled) {
			color: var(--ink);
		}

		&:disabled {
			opacity: 0.5;
		}
	}

	.link {
		color: var(--accent);
		font-size: var(--text-xs);
		text-decoration: underline;
	}

	.problem {
		color: var(--error);
	}
</style>
