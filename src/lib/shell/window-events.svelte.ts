/**
 * What reaches this window from outside it - the native menu, the OS, and the keyboard (S0.1).
 *
 * Five listeners with nothing in common except that none of them is a component: a menu choice, a
 * file the OS asks Studio to open, something dropped on the window, ⌘Z, and telling the menu to look
 * again. They sat in `App.svelte` as five `$effect`s spread two hundred lines apart, each carrying
 * its own teardown, and the only thing holding them together was that they all had to be torn down.
 *
 * **Nothing here decides anything.** Every listener turns an event into a call on the `Actions` the
 * caller passes in - which is what keeps the decisions where the state they touch is, and what makes
 * the wiring readable in one place rather than inferred from five.
 *
 * **The teardown is the point.** A reload that left the previous handlers attached would open every
 * dropped file twice and report every problem twice; each effect below returns its own, and
 * [`listen`] is one function so that a new one cannot forget to.
 */

import { listen as tauriListen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import { MENU_EVENT, OPENED_EVENT, refreshMenu, takeOpened } from '../ipc/commands';
import { REPOSITORY } from '../common/repository';
import { graphs } from '../state/graphs.svelte';
import { status } from '../state/status.svelte';

/** What a window can be asked to do from outside itself. */
export interface Actions {
	/** File → Open: anything Studio can read. */
	open: () => void;
	/** File → Open Project: a directory holding a `project.yaml`. */
	openProject: () => void;
	saveProject: () => void;
	saveProjectAs: () => void;
	saveCopy: () => void;
	/** Opens the fonts and sprites dialog. */
	showAssets: () => void;
	/** Opens the update dialog, which is what asks. */
	showUpdates: () => void;
	/** Shows the problems panel in the status bar. */
	showProblems: () => void;
	/** Starts a problem report for this session. */
	reportProblem: () => void;
	/**
	 * Opens whatever the OS handed over - a file, or a project directory.
	 *
	 * One entry point for both doors, because they arrive on the same queue: the launcher hands a
	 * project folder over the same way a double-clicked container arrives, and what a path *is* is
	 * the receiving window's question rather than the sender's (S7.5).
	 */
	openPath: (path: string) => Promise<void>;
	/** Whether a dropped file is one this build can read at all. */
	accepts: (path: string) => boolean;
	/** Steps the one undo stack across every view (G6). `true` is back. */
	stepHistory: (back: boolean) => void;
	/** What the window is called, or `null` for the application's own name. */
	title: () => string | null;
}

/**
 * A Tauri listener as an effect teardown.
 *
 * `listen` resolves to its own unsubscriber, so every one of these would otherwise end in the same
 * three-line dance - and a listener that skipped it would survive the reload that replaced it.
 */
function listen(subscribe: Promise<() => void>): () => void {
	return () => void subscribe.then((stop) => stop());
}

/**
 * The paths dropped on this window, as an effect teardown.
 *
 * **Both pages need this and they answer it differently**, which is why it is a function rather than
 * part of [`Actions`]: the workbench opens every path it can read into itself, and the launcher hands
 * one to a new window and closes. What they must not do is disagree about *when* a drop happened -
 * the launcher and the workbench keeping separate copies of "what can be opened" is the shape of bug
 * S7.5 already fixed once, and a second listener written from memory is how it comes back.
 *
 * `over` and `leave` are not drops; only `drop` carries paths.
 */
export function whenDropped(onDrop: (paths: string[]) => void): () => void {
	return listen(
		getCurrentWebview().onDragDropEvent((event) => {
			if (event.payload.type === 'drop') onDrop(event.payload.paths);
		})
	);
}

export const windowEvents = {
	/**
	 * Attaches everything, and returns nothing: each listener is its own effect, so one that has
	 * nothing to re-run on does not re-run when its neighbour's dependencies change.
	 *
	 * Called once from the component that owns the window.
	 */
	listen(actions: Actions): void {
		// **What a native menu choice does.** The menu says which and this says what: every one of
		// these already existed as a button or a shortcut, so the switch is the whole of the wiring.
		// `new-window` is absent because the shell answers that one itself - no window is involved in
		// opening a window.
		$effect(() =>
			listen(
				tauriListen<string>(MENU_EVENT, ({ payload }) => {
					switch (payload) {
						case 'open':
							return actions.open();
						case 'open-project':
							return actions.openProject();
						case 'save-project':
							return actions.saveProject();
						case 'save-project-as':
							return actions.saveProjectAs();
						case 'save-copy':
							return actions.saveCopy();
						case 'fonts':
							return actions.showAssets();
						case 'check-updates':
							return actions.showUpdates();
						case 'problems':
							return actions.showProblems();
						case 'report-problem':
							return actions.reportProblem();
						case 'repository':
							return void openUrl(REPOSITORY).catch((error: unknown) => status.fail(error));
					}
				})
			)
		);

		// **Keeps the menu's Save items in step with whether there is anything to save.**
		//
		// A native menu cannot read a `$derived`, so the moment the answer changes has to be *said* -
		// but not the answer itself, which the core already holds (S7.8). Failing is left to the
		// problem log rather than the status bar: a menu item that stays enabled is a message someone
		// gets when they use it, not something to interrupt them with now.
		$effect(() => {
			void graphs.empty;
			void refreshMenu();
		});

		// **A file double-clicked in Finder or passed on the command line.** It can arrive before this
		// window exists, so the queue is drained on start as well as on the event - the event alone
		// would miss the launch case entirely.
		$effect(() => {
			void drain(actions);
			return listen(tauriListen(OPENED_EVENT, () => void drain(actions)));
		});

		// Drag and drop is a shell affordance, so it goes through the same path as the file dialog.
		// Filtered here and not in the launcher: this window opens what is dropped *into itself*, so a
		// file it cannot read is a file to ignore rather than one to hand on.
		$effect(() =>
			whenDropped((paths) => {
				for (const path of paths) if (actions.accepts(path)) void actions.openPath(path);
			})
		);

		// **⌘Z / ⇧⌘Z reach the document from anywhere**, because there is one stack for every view (G6).
		//
		// A focused `<input>` or `<select>` keeps its own undo: the user is mid-edit in a parameter
		// field and has not committed anything yet, so the document has nothing to step back to. The
		// VPL textarea is deliberately *not* excluded - its text is the document, and letting the
		// browser undo it locally would leave the two disagreeing until the next keystroke.
		//
		// **⌘S is the menu's**, and it saves the project. Undo stays here on purpose: a menu
		// accelerator is handled before the webview sees the key, so a ⌘Z item would take the
		// keystroke away from this rule and hand it to whichever text box had focus.
		$effect(() => {
			const onKey = (event: KeyboardEvent) => {
				if (!(event.metaKey || event.ctrlKey)) return;
				const tag = (event.target as HTMLElement | null)?.tagName;
				if (event.key.toLowerCase() !== 'z' || tag === 'INPUT' || tag === 'SELECT') return;
				event.preventDefault();
				actions.stepHistory(!event.shiftKey);
			};
			window.addEventListener('keydown', onKey);
			return () => window.removeEventListener('keydown', onKey);
		});

		// The window title says which container this window holds - the native equivalent of the
		// in-app strip that used to repeat the application name back at the OS title bar. One window
		// per project (Q16), so the window is the right place to name it.
		$effect(() => {
			const name = actions.title();
			void getCurrentWindow().setTitle(name ? `${name} - VersaTiles Studio` : 'VersaTiles Studio');
		});
	}
};

/**
 * Opens everything the OS has queued for this window, in order.
 *
 * Draining rather than reading, so two windows cannot both take the same path - and awaited one at a
 * time, because opening a project replaces what is open and two of those racing would leave the
 * window holding half of each.
 */
async function drain(actions: Actions): Promise<void> {
	for (const path of await takeOpened().catch(() => [])) await actions.openPath(path);
}
