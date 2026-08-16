<script lang="ts">
	import { appVersion } from './lib/ipc/commands';

	// Smoke test for the control plane: the shell is real only once IPC answers.
	let version = $state<string | null>(null);
	let error = $state<string | null>(null);

	$effect(() => {
		appVersion()
			.then((v) => (version = v))
			.catch((e) => (error = String(e)));
	});
</script>

<main>
	<h1>VersaTiles Studio</h1>
	{#if error}
		<p class="err">IPC failed: {error}</p>
	{:else if version}
		<p>Core reachable — version {version}</p>
	{:else}
		<p>Connecting…</p>
	{/if}
</main>

<style>
	main {
		font-family: system-ui, sans-serif;
		display: grid;
		place-content: center;
		height: 100vh;
		gap: 0.5rem;
	}
	h1 {
		font-weight: 600;
		font-size: 1.5rem;
		margin: 0;
	}
	.err {
		color: #b00;
	}
</style>
