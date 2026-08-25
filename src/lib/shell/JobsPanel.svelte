<script lang="ts">
	import type { Job } from '../ipc/commands';
	import { cancelJob, jobLog } from '../state/jobs.svelte';

	// The expandable half of the status bar (S3.1): every job this session has run, and the log of
	// whichever one is opened.
	//
	// Expanded *upward from the bar*, not into a window. A conversion is something you glance at
	// while working on the next thing; a modal that has to be dismissed makes checking on it cost
	// more than it is worth, and a separate window makes it something to go and find.
	let { list }: { list: Job[] } = $props();

	/// Which job's log is open, and the lines of it. One at a time - a stack of open logs is a
	/// scroll problem rather than a feature.
	let openId = $state<number | null>(null);
	let lines = $state<string[]>([]);

	async function toggle(job: Job) {
		if (openId === job.id) {
			openId = null;
			return;
		}
		openId = job.id;
		// Fetched on open rather than streamed: a job logging per tile would otherwise cost the
		// webview a thousand messages nobody has asked to see.
		lines = await jobLog(job.id);
	}

	/// Newest first here, the opposite of how the core keeps them - the interesting one is the last.
	const newestFirst = $derived([...list].reverse());

	function describe(job: Job): string {
		switch (job.state.kind) {
			case 'queued':
				return 'Waiting';
			case 'running':
				return job.message || 'Running';
			case 'finished':
				return 'Done';
			case 'cancelled':
				return 'Cancelled';
			case 'failed':
				return job.state.error;
		}
	}
</script>

<div class="panel">
	{#if newestFirst.length === 0}
		<p class="empty">Nothing has run yet.</p>
	{:else}
		<ul>
			{#each newestFirst as job (job.id)}
				{@const active = job.state.kind === 'queued' || job.state.kind === 'running'}
				<li class:failed={job.state.kind === 'failed'}>
					<div class="row">
						<span class="dot" data-state={job.state.kind}></span>
						<span class="label truncate">{job.label}</span>
						<span class="detail truncate" title={describe(job)}>{describe(job)}</span>
						{#if job.logLines > 0}
							<button type="button" class="quiet" aria-expanded={openId === job.id} onclick={() => toggle(job)}>
								{openId === job.id ? 'Hide' : 'Log'} ({job.logLines})
							</button>
						{/if}
						{#if active}
							<button type="button" class="quiet" onclick={() => cancelJob(job.id)}>Cancel</button>
						{/if}
					</div>
					{#if openId === job.id}
						<!-- The log is preformatted and scrolls on its own axis: a conversion's output is
						     full of paths that would otherwise widen the whole bar. -->
						<pre class="log">{lines.join('\n')}</pre>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.panel {
		max-height: 15rem;
		overflow-y: auto;
		border-bottom: 1px solid var(--rule);
	}

	.empty {
		margin: 0;
		padding: var(--space-3) var(--space-5);
		font-size: var(--text-sm);
		color: var(--ink-2);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li + li {
		border-top: 1px solid var(--rule);
	}

	li.failed {
		background: var(--error-bg);

		.detail {
			color: var(--error);
		}
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
		padding: var(--space-2) var(--space-5);
		font-size: var(--text-sm);
	}

	.dot {
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--ink-2);

		&[data-state='running'] {
			background: var(--accent);
		}

		&[data-state='failed'] {
			background: var(--error);
		}

		&[data-state='queued'] {
			background: none;
			box-shadow: inset 0 0 0 1px var(--ink-2);
		}
	}

	/* State is carried by shape as much as colour, so it survives a monochrome or colour-blind
	   reading: running is filled, queued is hollow, an ending is one of three. */

	.label {
		flex: none;
		max-width: 40%;
		font-weight: 500;
	}

	.detail {
		flex: 1;
		min-width: 0;
		color: var(--ink-2);
	}

	.quiet {
		flex: none;
		padding: 0 var(--space-2);
		font-size: var(--text-sm);
		color: var(--ink-2);

		&:hover {
			color: var(--ink);
			text-decoration: underline;
		}
	}

	.log {
		margin: 0;
		padding: var(--space-3) var(--space-5);
		max-height: 12rem;
		overflow: auto;
		font-family: var(--font-mono);
		font-size: var(--text-mono-adjust);
		white-space: pre;
		color: var(--ink-2);
		background: var(--chrome);
	}
</style>
