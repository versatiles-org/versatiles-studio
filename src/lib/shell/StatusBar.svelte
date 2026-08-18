<script lang="ts" module>
	// What the application is doing, along the bottom of the window (Q24).
	//
	// Two things share this strip, because they are the same question asked at two scales: what is
	// happening *now* (a message, a progress bar, a failure), and what has happened this session
	// (the job list, expanded upward). S3.1 filled in the second.
	//
	// Errors land here rather than floating over the map: an error is a state the application is
	// in, which is exactly what a status bar is for, and covering the map to say so was never a
	// good trade.
	export type Status =
		{ kind: 'idle' } | { kind: 'busy'; message: string; fraction?: number } | { kind: 'error'; message: string };
</script>

<script lang="ts">
	import { jobs, cancelJob } from '../state/jobs.svelte';
	import JobsPanel from './JobsPanel.svelte';

	let { status, onDismiss }: { status: Status; onDismiss?: () => void } = $props();

	/// Rounded to what the reader can act on: nobody waits on the difference between 6,142/s and
	/// 6,000/s, and the extra digits change every update, which reads as noise rather than detail.
	function rate(perSecond: number): string {
		if (perSecond >= 1_000_000) return `${(perSecond / 1_000_000).toFixed(1)}M/s`;
		if (perSecond >= 1_000) return `${Math.round(perSecond / 1_000)}k/s`;
		return `${Math.round(perSecond)}/s`;
	}

	/// Coarser the further away it is, because that is how much of it is real: "about 2 hours" from
	/// an average taken over the first minute is a guess, and "1:58:03" is the same guess pretending
	/// otherwise.
	function left(seconds: number): string {
		if (seconds < 10) return 'a few seconds left';
		if (seconds < 90) return `${Math.round(seconds / 5) * 5}s left`;
		if (seconds < 3600) return `${Math.round(seconds / 60)} min left`;
		return `${(seconds / 3600).toFixed(1)} h left`;
	}

	/// How fast, and how much longer — shown only once the job has said enough to mean it.
	function pace(current: NonNullable<typeof job>): string | undefined {
		const parts: string[] = [];
		if (current.rate !== null) parts.push(rate(current.rate));
		if (current.etaSeconds !== null) parts.push(left(current.etaSeconds));
		return parts.length > 0 ? parts.join(' · ') : undefined;
	}

	let open = $state(false);

	/// The running job the bar reports on, if any. See `jobs.current` for why it is the newest.
	const job = $derived(jobs.current);

	/// What the strip says, and how much of it is done.
	///
	/// A job outranks a `status` message but not an error: the error is the thing that needs
	/// answering, and burying it under a progress bar for a job that is still fine would be exactly
	/// backwards. `fraction` is `undefined` — not zero — when nothing can say how far along it is;
	/// pretending to know is worse than admitting it.
	const line = $derived.by(
		(): { message: string; fraction?: number; pace?: string; error?: boolean; cancel?: number } => {
			if (status.kind === 'error') return { message: status.message, error: true };
			if (job) {
				return {
					message: job.message || job.label,
					fraction: job.fraction ?? undefined,
					pace: pace(job),
					cancel: job.id
				};
			}
			if (status.kind === 'busy') return { message: status.message, fraction: status.fraction };
			return { message: '' };
		}
	);

	const waiting = $derived(jobs.active.length);
</script>

{#if open}
	<JobsPanel list={jobs.all} />
{/if}

<!-- Always present, even when idle. A bar that appears and disappears moves everything else with
     it; a quiet one costs a row and keeps the layout still. -->
<div class="strip" class:error={line.error}>
	{#if line.fraction !== undefined || line.cancel !== undefined}
		<div
			class="progress"
			class:indeterminate={line.fraction === undefined}
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={1}
			aria-valuenow={line.fraction}
			aria-label={line.message}
		>
			<div class="bar" style:width={line.fraction === undefined ? undefined : `${line.fraction * 100}%`}></div>
		</div>
	{/if}

	<!-- `alert` only for an error, so a screen reader hears a failure without hearing every step of
	     a conversion it is not being asked about. -->
	<span class="message truncate" role={line.error ? 'alert' : undefined} title={line.message}>{line.message}</span>

	<!-- Beside the message rather than inside it: the message changes with every stage and this
	     changes with every update, and one string rebuilt from both would flicker in two rhythms. -->
	{#if line.pace}<span class="pace">{line.pace}</span>{/if}

	{#if line.cancel !== undefined}
		<button type="button" class="button action" onclick={() => cancelJob(line.cancel!)}>Cancel</button>
	{/if}
	{#if line.error && onDismiss}
		<button type="button" class="button action" onclick={onDismiss}>Dismiss</button>
	{/if}

	<!-- The way into the history, and the only thing here that is always visible. Its count is
	     what is still running, which is the number worth knowing at a glance. -->
	<button type="button" class="action jobs" aria-expanded={open} onclick={() => (open = !open)}>
		Jobs{waiting > 0 ? ` (${waiting})` : ''}
	</button>
</div>

<style>
	/* Tabular figures, because these numbers are replaced two or three times a second: proportional
	   digits change the width of the line as they change value, and the eye reads the movement
	   before it reads the number. */
	.pace {
		flex: none;
		color: var(--ink-2);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}

	.strip {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-width: 0;
		/* Holds its height when empty, so nothing shifts when a message arrives. */
		min-height: 1.9rem;
		padding: 0 var(--space-5);

		&.error {
			background: var(--error-bg);

			.message {
				color: var(--error);
			}
		}
	}

	.message {
		flex: 1;
		min-width: 0;
		font-size: var(--text-sm);
		color: var(--ink-2);
	}

	.progress {
		flex: none;
		width: 7rem;
		height: 0.3rem;
		border-radius: var(--radius);
		background: var(--chrome);
		overflow: hidden;

		&.indeterminate .bar {
			width: 40%;
			animation: sweep 1.1s ease-in-out infinite;
		}
	}

	.bar {
		height: 100%;
		background: var(--accent);
		transition: width 120ms linear;
	}

	.action {
		flex: none;
		padding: 0 var(--space-3);
		font-size: var(--text-sm);
	}

	.jobs {
		color: var(--ink-2);

		&:hover,
		&[aria-expanded='true'] {
			color: var(--ink);
		}
	}

	@keyframes sweep {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(250%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.progress.indeterminate .bar {
			width: 100%;
			animation: none;
			opacity: 0.5;
		}
		.bar {
			transition: none;
		}
	}
</style>
