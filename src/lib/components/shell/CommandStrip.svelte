<script lang="ts">
	// G2 is an architectural constraint, not a feature: every action names its CLI equivalent. A menu
	// item nobody clicks teaches nobody, so this sits under the map and is always visible.
	let { command }: { command: string | null } = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		if (!command) return;
		await navigator.clipboard.writeText(command);
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 1200);
	}
</script>

<div class="strip">
	<code class:empty={!command}>{command ?? 'No command yet — open a container.'}</code>
	<button onclick={copy} disabled={!command}>{copied ? 'Copied' : 'Copy'}</button>
</div>

<style>
	.strip {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-5);
	}
	code {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		white-space: nowrap;
		font-size: var(--text-sm);
		font-family: var(--font-mono);
		color: var(--accent);
	}
	code.empty {
		color: var(--ink-2);
	}
	button {
		font-size: var(--text-sm);
		padding: var(--space-1) var(--space-4);
	}
</style>
