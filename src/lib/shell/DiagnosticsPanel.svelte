<script lang="ts">
	import { save } from '@tauri-apps/plugin-dialog';
	import {
		problems,
		composeReport,
		copyReport,
		forgetAll,
		loadEarlier,
		refresh,
		reportProblem
	} from '../state/diagnostics.svelte';
	import { environment, saveReport, showLog, type Environment, type Problem } from '../ipc/commands';
	import { status } from '../state/status.svelte';

	// Everything that has gone wrong this session, expandable from the status bar (S6.8).
	//
	// **Beside the job list rather than in a window**, and for the same reason it is: an error is
	// something you glance at while working on the next thing, and a modal that has to be dismissed
	// makes checking on it cost more than it is worth. It is also where errors already live - the
	// bar is what shows the current one (Q24), so the history belongs on the same strip.
	//
	// The one button that matters is **Copy report**. A user who can paste a report has said more in
	// one gesture than a paragraph of "it crashed when I opened the file" ever does - that is the
	// whole purpose of the panel, and the list is what makes the report worth trusting.
	//
	// **Two sessions, because the interesting one is often not this one.** A window that crashed,
	// was killed for memory, or aborted on a panic left nothing in memory to show - only the file it
	// was writing as it went. That run is a tab here rather than a separate feature, because a
	// person looking for what went wrong should not have to know which kind of wrong it was.

	/// Which session is being shown. `this` is the ordinary case and the one the bar's count is
	/// about; `previous` is read from disk the first time it is asked for.
	let showing = $state<'this' | 'previous'>('this');

	/// Which problem's detail is open. One at a time: a stack is twenty lines, and a stack of stacks
	/// is a scroll problem rather than a feature.
	let openId = $state<number | null>(null);

	/// What the copy button last did, so it can say so. Copying gives no feedback of its own - the
	/// clipboard is invisible - and a button that looks unchanged reads as a button that failed.
	let copied = $state<'yes' | 'no' | null>(null);

	// Fetched rather than streamed, the same as a job's log: a container of unreadable tiles reports
	// a failure per tile, and pushing each of those at the window would spend a thousand messages
	// arriving at a number nobody is watching.
	//
	// **Refetched when the count moves**, which is the only signal that the list on screen is out of
	// date - and it costs no polling, because the core hands the count back with every report. Read
	// for the dependency, not the value, which is what the `void` says. Without this a problem that
	// arrived while the panel was open would show in the button and not in the list under it.
	$effect(() => {
		void problems.count;
		void refresh();
	});

	/// What is running this - the report's header, and the path in the footer.
	///
	/// Read once when the panel opens rather than held from startup: it cannot change while the
	/// application runs, and no window should pay an IPC call for a string most sessions never show.
	let where = $state<Environment | null>(null);

	$effect(() => {
		void environment()
			.then((found) => (where = found))
			.catch(() => (where = null));
	});

	// Read once, when its tab is first opened: most launches follow an ordinary one, and reading a
	// file nobody will look at is a cost paid on every start for a tab opened on almost none.
	$effect(() => {
		if (showing === 'previous' && problems.earlier === null) void loadEarlier();
	});

	/// What is on screen - and `null` for the previous session until its file has been read, which
	/// is not the same as a run that recorded nothing.
	const list = $derived(showing === 'this' ? problems.list : (problems.earlier ?? []));
	const loading = $derived(showing === 'previous' && problems.earlier === null);

	function when(problem: Problem): string {
		// Local time, not ISO: this is read next to a memory of doing something, and 14:03 is what
		// that memory is in. The report prints ISO, where the reader is somewhere else.
		return new Date(problem.at * 1000).toLocaleTimeString();
	}

	async function copy() {
		// The composing, the clipboard and the issue all live in `state/diagnostics.svelte.ts`, so
		// the Help menu and these buttons cannot come to different answers about what a report says.
		copied = (await copyReport(showing)) ? 'yes' : 'no';
		// Selecting the list is the fallback that needs no permission at all - ⌘C then does what the
		// button could not.
		if (copied === 'no') selectAll();
	}

	/// Writes the report to a file - for attaching it, or for keeping it past this window.
	async function saveAs() {
		try {
			const path = await save({
				defaultPath: 'versatiles-studio-problems.md',
				filters: [{ name: 'Markdown', extensions: ['md'] }]
			});
			if (typeof path !== 'string') return;
			await saveReport(path, await composeReport(showing));
		} catch (error) {
			// In the bar, like every other failure - and recorded, which puts a failure to save the
			// problem report into the problem report. That is the right place for it.
			status.fail(error);
		}
	}

	async function report() {
		try {
			if (!(await reportProblem(showing))) copied = 'no';
		} catch (error) {
			status.fail(error);
		}
	}

	function show(which: 'this' | 'previous') {
		showing = which;
		openId = null;
		copied = null;
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
		<!-- Tabs, not a filter: they are two runs, and one of them is over. `aria-pressed` rather than
		     a tablist, because there is one panel underneath and no roving focus to manage. -->
		<button type="button" class="tab" aria-pressed={showing === 'this'} onclick={() => show('this')}>
			This session{problems.count > 0 ? ` (${problems.count})` : ''}
		</button>
		<button type="button" class="tab" aria-pressed={showing === 'previous'} onclick={() => show('previous')}>
			Previous run
		</button>

		<span class="count">
			{#if loading}Reading…{:else if list.length > 0}{list.length} problem{list.length === 1 ? '' : 's'}{/if}
		</span>

		<button type="button" class="quiet" onclick={() => void copy()} disabled={list.length === 0}>
			{#if copied === 'yes'}Copied ✓{:else if copied === 'no'}Selected - press ⌘C{:else}Copy report{/if}
		</button>
		<button type="button" class="quiet" onclick={() => void saveAs()} disabled={list.length === 0}>Save…</button>
		<button type="button" class="quiet" onclick={() => void report()} disabled={list.length === 0}>
			Report on GitHub
		</button>
		<!-- Only this session's, and only the list: what is on disk is the account of a run, and a run
		     does not stop having happened because somebody cleared a panel. -->
		{#if showing === 'this'}
			<button type="button" class="quiet" onclick={() => void clear()} disabled={list.length === 0}>Clear</button>
		{/if}
	</div>

	{#if loading}
		<p class="empty">Reading what the last run wrote…</p>
	{:else if list.length === 0}
		<p class="empty">
			{#if showing === 'previous'}
				The last run of Studio recorded no problems - or there was no last run. A window that crashed still leaves what
				it had written up to that point.
			{:else}
				Nothing has gone wrong this session. Problems that do turn up are collected here, with a report you can copy
				into an issue.
			{/if}
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

	<!-- **The file, named and openable.** The list is the copy that is convenient; the file is the
	     one that survives a window being killed, and a person who has to send it needs to be able to
	     find it - a path you can read is worse than a path you can open, and this costs nothing to be
	     both. Shown in full rather than redacted: this is their own machine, and the redaction
	     belongs to the report, which is the thing that leaves it. -->
	{#if where}
		<button
			type="button"
			class="where truncate"
			title="Show {where.log} in the file manager"
			onclick={() => void showLog().catch((error: unknown) => status.fail(error))}
		>
			Written to {where.log}
		</button>
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
		font-variant-numeric: tabular-nums;
	}

	/* The selected tab is the only one in full ink, which is the same way the bar marks an expanded
	   panel - one rule for "you are looking at this", not two. */
	.tab {
		flex: none;
		padding: 0 var(--space-2);
		font-size: var(--text-sm);
		color: var(--ink-2);

		&[aria-pressed='true'] {
			color: var(--ink);
			font-weight: 500;
		}

		&:hover {
			color: var(--ink);
		}
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

	/* Level is carried by shape as much as colour - filled for an error, hollow for a warning - so
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
		letter-spacing: 0.08em;
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

	.where {
		display: block;
		width: 100%;
		padding: var(--space-2) var(--space-5);
		border-top: 1px solid var(--rule);
		font-size: var(--text-xs);
		color: var(--ink-2);
		text-align: left;

		&:hover {
			color: var(--ink);
			text-decoration: underline;
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
