<script lang="ts">
	import type { Job } from '../ipc/commands';
	import { cancelJob, jobLog } from '../state/jobs.svelte';
	import BarPanel from './BarPanel.svelte';
	import BarRow from './BarRow.svelte';

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

<!-- The panel and its rows are the kit's (S13); what is this list's own is what a job's row says. -->
<BarPanel empty={newestFirst.length === 0 ? 'Nothing has run yet.' : null}>
	{#each newestFirst as job (job.id)}
		{@const active = job.state.kind === 'queued' || job.state.kind === 'running'}
		<!-- The log is fetched on open and shown under the row, preformatted. -->
		<BarRow state={job.state.kind} more={openId === job.id ? lines.join('\n') : null}>
			<span class="label truncate">{job.label}</span>
			<span class="detail truncate" class:bad={job.state.kind === 'failed'} title={describe(job)}>{describe(job)}</span>
			{#if job.logLines > 0}
				<button type="button" class="quiet" aria-expanded={openId === job.id} onclick={() => toggle(job)}>
					{openId === job.id ? 'Hide' : 'Log'} ({job.logLines})
				</button>
			{/if}
			{#if active}
				<button type="button" class="quiet" onclick={() => cancelJob(job.id)}>Cancel</button>
			{/if}
		</BarRow>
	{/each}
</BarPanel>

<style>
	.label {
		flex: none;
		max-width: 40%;
		font-weight: 500;
	}

	.detail {
		flex: 1;
		min-width: 0;
		color: var(--ink-2);

		/* The reason a job failed, in the colour the row's dot already carries. */
		&.bad {
			color: var(--error);
		}
	}
</style>
