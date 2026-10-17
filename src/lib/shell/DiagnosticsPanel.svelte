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
	import Tabs from '../common/Tabs.svelte';
	import BarPanel from './BarPanel.svelte';
	import BarRow from './BarRow.svelte';

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

	/// What the panel says with nothing to list - and `null` while there is a list to show.
	const empty = $derived.by(() => {
		if (loading) return 'Reading what the last run wrote…';
		if (list.length > 0) return null;
		return showing === 'previous'
			? 'The last run of Studio recorded no problems - or there was no last run. A window that crashed still leaves what it had written up to that point.'
			: 'Nothing has gone wrong this session. Problems that do turn up are collected here, with a report you can copy into an issue.';
	});

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

{#snippet tools()}
	<!-- Two runs, and one of them is over: tabs of the kit, over the one list under them. -->
	<Tabs
		items={[
			{ id: 'this', label: `This session${problems.count > 0 ? ` (${problems.count})` : ''}` },
			{ id: 'previous', label: 'Previous run' }
		]}
		selected={showing}
		onSelect={(id) => show(id as 'this' | 'previous')}
		label="Which run"
	/>

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
{/snippet}

{#snippet footer()}
	<!-- **The file, named and openable.** The list is the copy that is convenient; the file is the
	     one that survives a window being killed, and a person who has to send it needs to be able to
	     find it - a path you can read is worse than a path you can open, and this costs nothing to be
	     both. Shown in full rather than redacted: this is their own machine, and the redaction
	     belongs to the report, which is the thing that leaves it. -->
	{#if where}
		<button
			type="button"
			class="link where truncate"
			title="Show {where.log} in the file manager"
			onclick={() => void showLog().catch((error: unknown) => status.fail(error))}
		>
			Written to {where.log}
		</button>
	{/if}
{/snippet}

<!-- The panel and its rows are the kit's (S13); what is this list's own is what a problem's row says. -->
<BarPanel {tools} {footer} {empty} bind:list={region}>
	{#each list as problem (problem.id)}
		<BarRow
			state={problem.level === 'error' ? 'error' : 'warn'}
			more={openId === problem.id && problem.detail ? problem.detail : null}
		>
			<span class="at">{when(problem)}</span>
			<span class="origin">{problem.origin}</span>
			<span class="message truncate" class:bad={problem.level === 'error'} title={problem.message}>
				{problem.message}
			</span>
			<!-- The repeat count, where a bare list would show five hundred identical rows and push
			     the entry that explains them off the end. -->
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
		</BarRow>
	{/each}
</BarPanel>

<style>
	.count {
		flex: 1;
		min-width: 0;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
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

		/* An error's message, in the colour the row's dot already carries. */
		&.bad {
			color: var(--error);
		}
	}

	.repeats {
		flex: none;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	/* A line along the foot of the panel; the word itself is the kit's `.link`. */
	.where {
		display: block;
		width: 100%;
		padding: var(--space-2) var(--space-5);
		border-top: 1px solid var(--rule);
		font-size: var(--text-xs);
		color: var(--ink-2);
		text-align: left;
	}
</style>
