/**
 * The file dialog's filters, from the core's catalogue of ways in (E1-E3, S3.2).
 *
 * **Studio's own dialog for files, the system's for a project folder.** A file can be on an SFTP
 * server, which only Studio's dialog can reach (`FileDialog`); a project is a folder Studio writes
 * into, and stays on this computer.
 *
 * **Here rather than in `App.svelte`, because there are two callers now** ([S7.5]): the workbench's
 * File → Open, and the launcher window, which is a page of its own with no access to the other's
 * functions. Two copies of "which extensions can Studio open" is the shape of bug where a launcher
 * offers a format the workbench then refuses.
 *
 * [S7.5]: ../../../docs/history.md
 */

import { open } from '@tauri-apps/plugin-dialog';
import { importOpening, type ImportKind } from '../ipc/commands';
import { fileDialog } from '../state/file-dialog.svelte';

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
	return fileDialog.ask({
		title: kind ? `Open ${kind.label}` : 'Open a Source',
		extensions: kind ? kind.extensions : anyExtension(kinds),
		check: refusal
	});
}

/**
 * Why a file on a server cannot be opened, said in the dialog rather than after it closes - an
 * `.mbtiles` or a GeoJSON has no reader over the network, and the window would open only to fail.
 * A local file is left to the import that follows, which already says what it turned out to be.
 */
async function refusal(location: string): Promise<string | null> {
	if (!location.toLowerCase().startsWith('sftp://')) return null;
	const opening = await importOpening(location).catch(() => null);
	if (!opening) return null;
	return opening.refused ?? (opening.kind ? null : 'Studio does not know this kind of file.');
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
 * `extensions` is what the field itself accepts, which upstream states per argument - so a clip
 * polygon beside a raster filters for GeoJSON rather than for the raster its node reads. Empty
 * offers everything, which is the honest answer for a private key or for GDAL, neither of whose
 * accepted set is ours to state.
 *
 * A file of another kind is shown dimmed and cannot be chosen. The field is still typable, which is
 * the escape hatch for a container that does not wear one of its extensions.
 *
 * `null` when the dialog was cancelled, which is ordinary and worth nothing being said about.
 */
export async function askForPath(extensions: string[], title?: string): Promise<string | null> {
	return fileDialog.ask({ title: title ?? 'Choose a File', extensions });
}
