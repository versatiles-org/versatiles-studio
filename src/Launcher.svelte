<script lang="ts">
	import { listen } from '@tauri-apps/api/event';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import LandingScreen from './lib/common/LandingScreen.svelte';
	import { askForProject, askForSource } from './lib/common/import';
	import { REPOSITORY } from './lib/common/repository';
	import {
		appVersion,
		forgetRecent,
		importKinds,
		openEmptyWindow,
		openInNewWindow,
		recentSources,
		MENU_EVENT,
		type ImportKind,
		type RecentEntry
	} from './lib/ipc/commands';
	import {
		record,
		refresh as refreshProblems,
		reportProblem,
		watch as watchForProblems
	} from './lib/state/diagnostics.svelte';
	import { whenDropped } from './lib/shell/window-events.svelte';

	// The launcher: what opens when Studio starts with nothing to open, and what ⌘N opens
	// ([Q48], [S7.5]).
	//
	// **A window rather than a screen inside one.** As an overlay it made a project window two
	// different things depending on whether it happened to hold any graphs, and "new project" meant
	// "empty this window out". As a window it is one thing, the workbench is one thing, and neither
	// has a mode.
	//
	// **It holds nothing.** Every gesture here ends in `openInNewWindow`, which creates a project
	// window, hands it the path and closes this one - so there is no state here worth keeping and
	// nothing to lose by closing at the moment something opens.
	//
	// [Q48]: ../docs/decisions.md
	// [S7.5]: ../docs/history.md

	let kinds = $state<ImportKind[]>([]);
	let recents = $state<RecentEntry[]>([]);
	/// What the footer says. From the core, which reads it from the binary - the one copy (S0.5).
	let version = $state('');

	/// What went wrong, said here rather than in a status bar - this window has none, and a launcher
	/// that silently does nothing when a directory holds no project is a launcher that looks broken.
	let problem = $state<string | null>(null);

	// The same handlers the workbench installs: an uncaught rejection and anything written to the
	// console reach the problem log from this window too (S6.8), which is where a launcher that
	// cannot start is most likely to be explained.
	$effect(() => watchForProblems());

	$effect(() => {
		void importKinds().then((loaded) => (kinds = loaded));
		void appVersion().then((loaded) => (version = loaded));
		void refreshRecents();
		// So Help → Report a Problem from here carries the session's problems rather than a header
		// and nothing else. There is no panel in this window; the list is only ever reported.
		void refreshProblems();
	});

	/// The menu items this window can answer (S7.8).
	///
	/// **Not all of them.** Save has nothing to save here and is disabled by the shell when this
	/// window has focus; ⌘N and Show Problem Log are answered without a window at all. What is left
	/// is the two gestures this window is *for*, and the two that are about Studio rather than a
	/// project.
	$effect(() => {
		const unlisten = listen<string>(MENU_EVENT, ({ payload }) => {
			switch (payload) {
				case 'open':
					void choose();
					return;
				case 'open-project':
					void chooseProject();
					return;
				case 'report-problem':
					void reportProblem('this').catch(() => (problem = 'Could not open the issue page.'));
					return;
				case 'repository':
					void openUrl(REPOSITORY).catch(() => (problem = 'Could not open a browser.'));
					return;
			}
		});
		return () => void unlisten.then((stop) => stop());
	});

	/// A file dropped on the window, which the landing screen offers as a way of pressing the first
	/// door ("…or drop a file anywhere in this window").
	///
	/// **Unfiltered, unlike the workbench's.** That one opens what is dropped into itself, so a file
	/// it cannot read is one to ignore. This hands the path to a *new* window, and [S7.6] is explicit
	/// that the path is inspected at neither end - a file, a project directory and a URL are all the
	/// same to it. Filtering by extension here would refuse a dropped project folder, which has none
	/// and is one of the four doors beside it.
	///
	/// **The first path only.** `openInNewWindow` closes this window, so a second call would be made
	/// from a window that is going away; opening one thing is also what every other door here does.
	$effect(() =>
		whenDropped((paths) => {
			const [first] = paths;
			if (first !== undefined) void open(first);
		})
	);

	async function refreshRecents() {
		recents = await recentSources().catch(() => []);
	}

	/// Hands a path to a new project window, and closes this one.
	///
	/// The window it opens is what reports anything that goes wrong with the *contents* - this can
	/// only report failing to open a window at all, which is why the message here is short.
	async function open(source: string) {
		try {
			await openInNewWindow(source);
		} catch (error) {
			problem = 'Could not open a window for it.';
			record({
				level: 'error',
				origin: 'webview',
				message: `could not open a window for ${source}`,
				detail: String(error)
			});
		}
	}

	/// One dialog offering everything this build can read - the catalogue supplies the filters, so a
	/// build without GDAL neither offers a GeoTIFF nor claims to.
	async function choose() {
		problem = null;
		const picked = await askForSource(kinds);
		if (picked) await open(picked);
	}

	async function chooseProject() {
		problem = null;
		const picked = await askForProject();
		if (picked) await open(picked);
	}

	/// A window with nothing in it, which is the one door that asks the core for nothing first.
	async function startEmpty() {
		try {
			await openEmptyWindow();
		} catch (error) {
			problem = 'Could not open a window.';
			record({
				level: 'error',
				origin: 'webview',
				message: 'could not open an empty project window',
				detail: String(error)
			});
		}
	}
</script>

<main>
	<LandingScreen
		{kinds}
		{recents}
		{version}
		onOpenFile={() => void choose()}
		onOpenUrl={(source) => void open(source)}
		onOpenProject={() => void chooseProject()}
		onNewProject={() => void startEmpty()}
		onOpenRepository={() => void openUrl(REPOSITORY).catch(() => (problem = 'Could not open a browser.'))}
		onForget={async (source) => {
			await forgetRecent(source);
			await refreshRecents();
		}}
	/>

	<!-- `alert`, because it arrives seconds after a press and there is nothing else on screen that
	     changed. -->
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
</main>

<style>
	/* The window is the launcher, so the launcher fills the window. */
	main {
		position: relative;
		height: 100vh;
		overflow-y: auto;
		background: var(--chrome);
		color: var(--ink);
	}

	.problem {
		position: absolute;
		inset: auto 0 0;
		margin: 0;
		padding: var(--space-3) var(--space-5);
		background: var(--error-bg);
		color: var(--error);
		font-size: var(--text-sm);
	}
</style>
