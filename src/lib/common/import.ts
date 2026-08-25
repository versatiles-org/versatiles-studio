/**
 * The file dialog's filters, from the core's catalogue of ways in (E1-E3, S3.2).
 *
 * **Here rather than in `App.svelte`, because there are two callers now** ([S7.5]): the workbench's
 * File → Open, and the launcher window, which is a page of its own with no access to the other's
 * functions. Two copies of "which extensions can Studio open" is the shape of bug where a launcher
 * offers a format the workbench then refuses.
 *
 * [S7.5]: ../../../docs/scope-release-3.md
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
