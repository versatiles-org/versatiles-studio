/**
 * Writing a project out, and reading one back ([Q6], G1, S5.1).
 *
 * A directory holding `project.yaml`, one `.vpl` per graph and a rendered `style.json` - files that
 * work without Studio, which is the whole of [Q6].
 *
 * **The style arrives as text rather than being fetched.** `@versatiles/style` renders in the
 * webview ([Q36]), so the core cannot produce the `style.json` it writes beside the manifest; the
 * caller hands it over. That is also why `styleText` is a function here and not a value: the style
 * is derived from whatever is on the map at the moment someone chooses a directory.
 *
 * **What this does not own.** Opening a project changes which document is on screen and which
 * graphs exist - both other modules' - so `open` returns rather than assigning, and the caller
 * sequences the rest.
 *
 * [Q6]: ../../../docs/decisions.md
 * [Q36]: ../../../docs/decisions.md
 */

import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import {
	copyPlan,
	isProject,
	openProject,
	projectPath,
	saveProject,
	saveProjectCopy,
	type CopyPlan,
	type Recipe
} from '../ipc/commands';
import { status } from './status.svelte';

/** The copy dialog's plan, or `null` when it is closed. */
let plan = $state<CopyPlan | null>(null);

export const project = {
	get copying(): CopyPlan | null {
		return plan;
	},

	/** Closes the copy dialog without writing anything. */
	cancelCopy(): void {
		plan = null;
	},

	/** Asks the core what a copy would contain, which is what the dialog lists. */
	async showCopy(): Promise<void> {
		try {
			plan = await copyPlan();
		} catch (error) {
			status.fail(error);
		}
	},

	/**
	 * Writes the project back where it came from, asking only if there is nowhere yet (⌘S).
	 *
	 * **The asking is what tells this from `saveAs`.** A Save that opened a directory picker every
	 * time would be Save As under another name, and the shortcut on it would be a shortcut to a
	 * dialog. Where the project lives is the core's to remember ([Q16]) - a window that kept it
	 * would forget on reload, and forget differently from the window next to it.
	 */
	async save(styleText: () => string | null): Promise<void> {
		try {
			const dir = await projectPath();
			if (dir === null) {
				await this.saveAs(styleText);
				return;
			}
			status.busy('Saving the project…');
			await saveProject(dir, styleText());
			status.settle();
		} catch (error) {
			status.fail(error);
		}
	},

	/** Writes the project into a directory someone chooses (⇧⌘S). */
	async saveAs(styleText: () => string | null): Promise<void> {
		try {
			const dir = await openDialog({ directory: true, title: 'Save project into…' });
			if (typeof dir !== 'string') return;
			status.busy('Saving the project…');
			await saveProject(dir, styleText());
			status.settle();
		} catch (error) {
			status.fail(error);
		}
	},

	/**
	 * Writes a copy, as a directory or a zip.
	 *
	 * The dialog closes first: it is a modal over the file picker that is about to open, and leaving
	 * it up puts two questions on screen at once.
	 */
	async writeCopy(zip: boolean, styleText: () => string | null): Promise<void> {
		plan = null;
		try {
			const target = zip
				? await saveDialog({
						// Trails off for the same reason its sibling below does: the phrase is not finished
						// until the panel is. The titles that *are* a finished phrase - `Open project`,
						// `Save pipeline` - carry no ellipsis.
						title: 'Save a copy as…',
						defaultPath: 'project.zip',
						filters: [{ name: 'Zip archive', extensions: ['zip'] }]
					})
				: await openDialog({ directory: true, title: 'Save a copy into…' });
			if (typeof target !== 'string') return;
			status.busy('Copying the project…');
			await saveProjectCopy(target, zip, styleText());
			status.settle();
		} catch (error) {
			status.fail(error);
		}
	},

	/**
	 * Opens a project directory, returning its style recipe - or `null` when nothing was opened.
	 *
	 * **Returns rather than assigns.** What follows is a sequence across three other modules - the
	 * graph list, the document, every graph mounted - and the order of it is the caller's to state,
	 * where it can be read in one place.
	 */
	async open(): Promise<Recipe | null> {
		const dir = await openDialog({ directory: true, title: 'Open project' });
		if (typeof dir !== 'string') return null;
		return await openAt(dir);
	},

	/**
	 * The same, for a directory something else has already chosen.
	 *
	 * **The launcher's third door ends here** ([S7.5]). It hands a path to a new window, and that
	 * window used to send everything it was handed down the file path - where a directory has no
	 * read node, so opening a project folder opened an empty window and said Studio had no way to
	 * open it. Found by the end-to-end story that saves a project and opens it again.
	 *
	 * [S7.5]: ../../../docs/history.md
	 */
	async at(dir: string): Promise<Recipe | null> {
		return await openAt(dir);
	}
};

/** Shared by both doors: what a directory has to be before it can be opened as a project. */
async function openAt(dir: string): Promise<Recipe | null> {
	if (!(await isProject(dir))) {
		status.fail(`${dir} holds no project.yaml`);
		return null;
	}
	status.busy('Opening the project…');
	return await openProject(dir);
}
