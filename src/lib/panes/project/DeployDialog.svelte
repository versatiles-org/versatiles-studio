<script lang="ts">
	import Modal from '../../common/Modal.svelte';
	import type { Deployment } from '../../ipc/commands';

	// The commands that reproduce this project elsewhere (C7, S5.5).
	//
	// **A modal, like the export.** It is a thing you read and take away, not a thing you edit, and
	// it competes with nothing on screen while it is open. A native `<dialog>` for the reasons
	// `ExportDialog` gives: modality, focus containment and Escape are the browser's, and the top
	// layer puts it above every z-index in the application.
	//
	// **Shown rather than written.** Studio does not know whether this project is a git repository,
	// where its workflows live, or whether there is already a Dockerfile — so it offers the text and
	// lets someone put it where it belongs.

	let { deployment, onClose }: { deployment: Deployment; onClose: () => void } = $props();

	let dialog = $state<HTMLDialogElement>();
	$effect(() => dialog?.showModal());

	/// Which one is showing. Tabs rather than four boxes: they are alternatives, and stacking them
	/// would make the page long enough to hide that.
	let shown = $state<'command' | 'serve' | 'docker' | 'action'>('command');

	/// The name of the last thing copied, so the button can say it worked. Cleared on a timer,
	/// because a label stuck on "Copied" is a label that stops meaning anything.
	let copied = $state<string | null>(null);

	const TABS = [
		{ id: 'command', label: 'Command' },
		{ id: 'serve', label: 'Serve config' },
		{ id: 'docker', label: 'Dockerfile' },
		{ id: 'action', label: 'GitHub Action' }
	] as const;

	const text = $derived.by(() => {
		switch (shown) {
			case 'command':
				return deployment.commands.join('\n');
			case 'serve':
				return deployment.serveConfig;
			case 'docker':
				return deployment.dockerfile;
			default:
				return deployment.githubAction;
		}
	});

	const filename = $derived(
		shown === 'serve' ? 'serve.yaml' : shown === 'docker' ? 'Dockerfile' : shown === 'action' ? 'tiles.yml' : null
	);

	async function copy() {
		await navigator.clipboard.writeText(text);
		copied = shown;
		setTimeout(() => (copied = null), 1500);
	}
</script>

<Modal title="Run this elsewhere" width="46rem" {onClose}>
	<p class="lead">
		Everything Studio does, the command line does too. These are generated from the project as it stands.
	</p>

	<div class="tabs" role="tablist">
		{#each TABS as tab (tab.id)}
			<button
				type="button"
				role="tab"
				class="tab"
				class:on={shown === tab.id}
				aria-selected={shown === tab.id}
				onclick={() => (shown = tab.id)}
			>
				{tab.label}
			</button>
		{/each}
	</div>

	{#if filename}
		<p class="note">Save as <code>{filename}</code> in the project directory.</p>
	{/if}

	<pre class="text">{text}</pre>

	{#snippet actions()}
		<button type="button" class="button" onclick={() => void copy()}>
			{copied === shown ? 'Copied' : 'Copy'}
		</button>
		<button type="button" class="button primary" onclick={onClose}>Done</button>
	{/snippet}
</Modal>

<style>
	.lead,
	.note {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--text-sm);
	}

	.tabs {
		display: flex;
		gap: var(--space-1);
		border-bottom: 1px solid var(--rule);
	}

	.tab {
		padding: var(--space-1) var(--space-3);
		border-bottom: 2px solid transparent;
		color: var(--ink-2);
		font-size: var(--text-sm);

		&.on {
			border-bottom-color: var(--accent);
			color: var(--ink);
		}
	}

	/* Scrolls rather than growing: a workflow is twenty lines and a command is one, and a dialog
	   that changed height as the tabs were clicked would move the buttons under the pointer. */
	.text {
		max-height: 22rem;
		min-height: 12rem;
		overflow: auto;
		margin: 0;
		padding: var(--space-3);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--chrome);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.5;
		white-space: pre;
	}

	.primary {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-ink);
	}
</style>
