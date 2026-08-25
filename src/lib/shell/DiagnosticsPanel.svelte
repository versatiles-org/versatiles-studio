<script lang="ts">
	import { problems, forgetAll, refresh } from '../state/diagnostics.svelte';
	import { buildReport, gpuRenderer, type Local } from '../common/report';
	import { environment, type Problem } from '../ipc/commands';

	// Everything that has gone wrong this session, expandable from the status bar (S6.8).
	//
	// **Beside the job list rather than in a window**, and for the same reason it is: an error is
	// something you glance at while working on the next thing, and a modal that has to be dismissed
	// makes checking on it cost more than it is worth. It is also where errors already live — the
	// bar is what shows the current one (Q24), so the history belongs on the same strip.
	//
	// The one button that matters is **Copy report**. A user who can paste a report has said more in
	// one gesture than a paragraph of "it crashed when I opened the file" ever does — that is the
	// whole purpose of the panel, and the list is what makes the report worth trusting.

	/// Which problem's detail is open. One at a time: a stack is twenty lines, and a stack of stacks
	/// is a scroll problem rather than a feature.
	let openId = $state<number | null>(null);

	/// What the copy button last did, so it can say so. Copying gives no feedback of its own — the
	/// clipboard is invisible — and a button that looks unchanged reads as a button that failed.
	let copied = $state<'yes' | 'no' | null>(null);

	// Fetched rather than streamed, the same as a job's log: a container of unreadable tiles reports
	// a failure per tile, and pushing each of those at the window would spend a thousand messages
	// arriving at a number nobody is watching.
	//
	// **Refetched when the count moves**, which is the only signal that the list on screen is out of
	// date — and it costs no polling, because the core hands the count back with every report. Read
	// for the dependency, not the value, which is what the `void` says. Without this a problem that
	// arrived while the panel was open would show in the button and not in the list under it.
	$effect(() => {
		void problems.count;
		void refresh();
	});

	const list = $derived(problems.list);

	function when(problem: Problem): string {
		// Local time, not ISO: this is read next to a memory of doing something, and 14:03 is what
		// that memory is in. The report prints ISO, where the reader is somewhere else.
		return new Date(problem.at * 1000).toLocaleTimeString();
	}

	async function copy() {
		const local: Local = {
			userAgent: navigator.userAgent,
			renderer: gpuRenderer(window.document.createElement('canvas'))
		};
		// The environment is asked for when a report is made, not held: it cannot change while the
		// application runs, and fetching it up front would put an IPC call on every window's startup
		// for a string most sessions never need.
		const where = await environment().catch(() => null);
		const text = buildReport({ problems: list, environment: where, local, at: new Date() });
		try {
			await navigator.clipboard.writeText(text);
			copied = 'yes';
		} catch {
			// A webview can refuse the clipboard outright. Selecting the panel is the fallback that
			// needs no permission at all — ⌘C then does what the button could not.
			copied = 'no';
			selectAll();
		}
	}

	/// Selects the list, so the keyboard can copy what the clipboard API would not.
	function selectAll() {
		const selection = window.getSelection();
		if (!selection || !region) return;
		selection.removeAllRanges();
		const range = document.createRange();
		range.selectNodeContents(region);
		selection.addRange(range);
	}

	let region = $state<HTMLElement>();

	async function clear() {
		await forgetAll();
		openId = null;
		copied = null;
	}
</script>

<div class="panel">
	<div class="tools">
		<span class="count"
			>{list.length === 0 ? 'Nothing has gone wrong' : `${list.length} problem${list.length === 1 ? '' : 's'}`}</span
		>
		<button type="button" class="quiet" onclick={() => void copy()} disabled={list.length === 0}>
			{#if copied === 'yes'}Copied ✓{:else if copied === 'no'}Selected — press ⌘C{:else}Copy report{/if}
		</button>
		<button type="button" class="quiet" onclick={() => void clear()} disabled={list.length === 0}>Clear</button>
	</div>

	{#if list.length === 0}
		<p class="empty">
			Nothing has gone wrong this session. Problems that do turn up are collected here, with a report you can copy into
			an issue.
		</p>
	{:else}
		<ul bind:this={region}>
			{#each list as problem (problem.id)}
				<li class:failed={problem.level === 'error'}>
					<div class="row">
						<span class="dot" data-level={problem.level}></span>
						<span class="at">{when(problem)}</span>
						<span class="origin">{problem.origin}</span>
						<span class="message truncate" title={problem.message}>{problem.message}</span>
						<!-- The repeat count, where a bare list would show five hundred identical rows and
						     push the entry that explains them off the end. -->
						{#if problem.count > 1}<span class="repeats">×{problem.count}</span>{/if}
						{#if problem.detail}
							<button
								type="button"
								class="quiet"
								aria-expanded={openId === problem.id}
								onclick={() => (openId = openId === problem.id ? null : problem.id)}
							>
								{openId === problem.id ? 'Hide' : 'Detail'}
							</button>
						{/if}
					</div>
					{#if openId === problem.id && problem.detail}
						<!-- Preformatted and scrolling on its own axis: a stack is full of paths that would
						     otherwise widen the whole bar. -->
						<pre class="detail-text">{problem.detail}</pre>
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

	.tools {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-5);
		border-bottom: 1px solid var(--rule);
		font-size: var(--text-sm);
	}

	.count {
		flex: 1;
		min-width: 0;
		color: var(--ink-2);
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

	li.failed .message {
		color: var(--error);
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
		padding: var(--space-2) var(--space-5);
		font-size: var(--text-sm);
	}

	/* Level is carried by shape as much as colour — filled for an error, hollow for a warning — so
	   it survives a monochrome or colour-blind reading. The same rule the job dots follow. */
	.dot {
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--error);

		&[data-level='warn'] {
			background: none;
			box-shadow: inset 0 0 0 1px var(--ink-2);
		}
	}

	/* Tabular figures: a column of times is read down, and proportional digits make it ragged. */
	.at {
		flex: none;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.origin {
		flex: none;
		color: var(--ink-2);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.message {
		flex: 1;
		min-width: 0;
	}

	.repeats {
		flex: none;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.quiet {
		flex: none;
		padding: 0 var(--space-2);
		font-size: var(--text-sm);
		color: var(--ink-2);

		&:hover:not(:disabled) {
			color: var(--ink);
			text-decoration: underline;
		}

		&:disabled {
			opacity: 0.5;
		}
	}

	.detail-text {
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
