<script lang="ts">
	import { appVersion, serverBaseUrl, demoJob, type JobEvent } from './lib/ipc/commands';

	// S0 smoke tests, one per plane. Replaced by the real shell at S1.
	let version = $state<string | null>(null);
	let baseUrl = $state<string | null>(null);
	let error = $state<string | null>(null);
	let events = $state<string[]>([]);

	$effect(() => {
		Promise.all([appVersion(), serverBaseUrl()])
			.then(([v, u]) => {
				version = v;
				baseUrl = u;
			})
			.catch((e) => (error = String(e)));
	});

	function describe(event: JobEvent): string {
		switch (event.kind) {
			case 'progress':
				return `${Math.round(event.fraction * 100)}% — ${event.message}`;
			case 'log':
				return event.line;
			case 'failed':
				return `failed: ${event.error}`;
			default:
				return event.kind;
		}
	}

	function runDemo() {
		events = [];
		demoJob((event) => (events = [...events, describe(event)]));
	}
</script>

<main>
	<h1>VersaTiles Studio</h1>

	{#if error}
		<p class="err">{error}</p>
	{:else}
		<dl>
			<dt>control plane</dt>
			<dd>{version ?? '…'}</dd>
			<dt>data plane</dt>
			<dd>{baseUrl ?? '…'}</dd>
		</dl>

		<button onclick={runDemo}>Test the event plane</button>
		{#if events.length}
			<ul>
				{#each events as line (line)}
					<li>{line}</li>
				{/each}
			</ul>
		{/if}
	{/if}
</main>

<style>
	main {
		font-family: system-ui, sans-serif;
		display: grid;
		place-content: center;
		height: 100vh;
		gap: 1rem;
		font-size: 0.9rem;
	}
	h1 {
		font-weight: 600;
		font-size: 1.4rem;
		margin: 0;
	}
	dl {
		display: grid;
		grid-template-columns: auto auto;
		gap: 0.2rem 1rem;
		margin: 0;
	}
	dt {
		color: #666;
	}
	dd {
		margin: 0;
		font-family: ui-monospace, monospace;
	}
	ul {
		margin: 0;
		padding-left: 1.1rem;
		color: #444;
	}
	.err {
		color: #b00;
	}
</style>
