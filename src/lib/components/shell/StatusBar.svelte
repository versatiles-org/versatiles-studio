<script lang="ts">
	// What the application is doing, along the bottom of the window (Q24).
	//
	// This is the job bar E7 needs, arriving early because the bottom row was free. Conversions run
	// for minutes to hours, so progress and cancellation have to live somewhere permanent rather
	// than in a dialog that steals focus — S3.1 adds the queue and the expandable per-job log behind
	// this same strip.
	//
	// Errors land here rather than floating over the map: an error is a state the application is in,
	// which is exactly what a status bar is for, and covering the map to say so was never a good
	// trade.
	export type Status =
		{ kind: 'idle' } | { kind: 'busy'; message: string; fraction?: number } | { kind: 'error'; message: string };

	let { status, onDismiss }: { status: Status; onDismiss?: () => void } = $props();
</script>

<!-- Always present, even when idle. A bar that appears and disappears moves everything else with
     it; a quiet one costs a row and keeps the layout still. -->
<div class="strip" class:error={status.kind === 'error'}>
	{#if status.kind === 'busy'}
		<!-- Indeterminate until something reports a fraction — pretending to know how far along a
		     job is, when it does not, is worse than admitting it. -->
		<div
			class="progress"
			class:indeterminate={status.fraction === undefined}
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={1}
			aria-valuenow={status.fraction}
			aria-label={status.message}
		>
			<div class="bar" style:width={status.fraction === undefined ? undefined : `${status.fraction * 100}%`}></div>
		</div>
		<span class="message truncate" title={status.message}>{status.message}</span>
	{:else if status.kind === 'error'}
		<!-- `alert` so a screen reader hears the failure without the focus moving. -->
		<span class="message truncate" role="alert" title={status.message}>{status.message}</span>
		{#if onDismiss}<button type="button" class="dismiss" onclick={onDismiss}>Dismiss</button>{/if}
	{/if}
</div>

<style>
	.strip {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-width: 0;
		/* Holds its height when empty, so nothing shifts when a message arrives. */
		min-height: 1.9rem;
		padding: 0 var(--space-5);
	}
	.strip.error {
		background: var(--error-bg);
	}
	.message {
		flex: 1;
		min-width: 0;
		font-size: var(--text-sm);
		color: var(--ink-2);
	}
	.strip.error .message {
		color: var(--error);
	}
	.progress {
		flex: none;
		width: 7rem;
		height: 0.3rem;
		border-radius: var(--radius);
		background: var(--chrome);
		overflow: hidden;
	}
	.bar {
		height: 100%;
		background: var(--accent);
		transition: width 120ms linear;
	}
	.progress.indeterminate .bar {
		width: 40%;
		animation: sweep 1.1s ease-in-out infinite;
	}
	.dismiss {
		flex: none;
		padding: 0 var(--space-3);
		font-size: var(--text-sm);
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
