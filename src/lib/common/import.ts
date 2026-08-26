/**
 * The file dialog's filters, from the core's catalogue of ways in (E1-E3, S3.2).
 *
 * **Here rather than in `App.svelte`, because there are two callers now** ([S7.5]): the workbench's
 * File → Open, and the launcher window, which is a page of its own with no access to the other's
 * functions. Two copies of "which extensions can Studio open" is the shape of bug where a launcher
 * offers a format the workbench then refuses.
 *
 * [S7.5]: ../../../docs/history.md
 */

import { open } from '@tauri-apps/plugin-dialog';
import type { ImportKind } from '../ipc/commands';

/** Every extension this build accepts, for a catch-all filter and for the drop handler. */
export function anyExtension(kinds: ImportKind[]): string[] {
	return kinds.flatMap((kind) => kind.extensions);
}

/**
 * Asks for a file, narrowed to one kind when a card chose it.
 *
 * A card's whole contribution is *saying what you are bringing in before you go looking for it*, so
 * the dialog it opens shows that kind's files and nothing else. With no card - the keyboard route,
 * or "+ Add source" before a choice - every kind is offered at once.
 *
 * `null` when the dialog was cancelled, which is ordinary and worth nothing being said about.
 */
export async function askForSource(kinds: ImportKind[], kind?: ImportKind): Promise<string | null> {
	const filters = kind
		? [{ name: kind.label, extensions: kind.extensions }]
		: [
				{ name: 'Everything Studio can open', extensions: anyExtension(kinds) },
				...kinds.map((each) => ({ name: each.label, extensions: each.extensions }))
			];
	const picked = await open({ multiple: false, filters });
	return typeof picked === 'string' ? picked : null;
}

/** Asks for a project directory. `null` when the dialog was cancelled. */
export async function askForProject(): Promise<string | null> {
	const picked = await open({ directory: true, title: 'Open project' });
	return typeof picked === 'string' ? picked : null;
}

/**
 * Asks for a file to put in a path parameter of a node (S3.2).
 *
 * **Not `askForSource`**, though both open a picker over the same catalogue. That one is "bring
 * something into Studio", and with no card chosen it offers every way in at once - which is the
 * wrong answer here, where the field may want something that is not a tile source at all. A
 * `*_file` on a transform is a file nothing is known about, so nothing is claimed about it: no
 * filters, every file offered.
 *
 * `kind` is the way in whose read operation this node is, when it is one, and then the dialog
 * shows what that operation reads - the same list File → Open uses for it.
 *
 * **No "All files" alongside it**, deliberately: macOS flattens every filter into one
 * allow-everything list rather than a menu to choose between (`rfd`'s `setAllowedFileTypes`), so
 * such an entry would not be a choice anyone could make there, and on GTK it becomes `*.*`, which
 * hides files without an extension. The field is still typable, which is the escape hatch for a
 * container that does not wear one of its extensions.
 *
 * `null` when the dialog was cancelled, which is ordinary and worth nothing being said about.
 */
export async function askForPath(kind?: ImportKind, title?: string): Promise<string | null> {
	const picked = await open({
		multiple: false,
		title,
		filters: kind ? [{ name: kind.label, extensions: kind.extensions }] : undefined
	});
	return typeof picked === 'string' ? picked : null;
}
