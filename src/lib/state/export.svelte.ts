/**
 * Exporting a graph to a container (F2, E7, [Q41]).
 *
 * The dialog's own state - whether it is up, what the graph turns out to produce, and the formats
 * Studio can write - plus the two things it does: estimate, and submit.
 *
 * **The crop belongs to the pane, not to this.** It is arrived at by looking at the map, lives on
 * the graph in the core, and survives a reload ([Q43]); the export only narrows to it. So it arrives
 * as an argument each time rather than being mirrored here, where a second copy could disagree with
 * the one the job actually uses.
 *
 * [Q41]: ../../../docs/decisions.md
 * [Q43]: ../../../docs/decisions.md
 */

import { save } from '@tauri-apps/plugin-dialog';
import {
	estimateExport,
	exportGraph,
	mountGraph,
	writableFormats,
	type Bounds,
	type Compression,
	type Estimate,
	type Preview
} from '../ipc/commands';
import { status } from './status.svelte';

/** Whether the export modal is up. For the graph being edited - exporting is per graph ([Q32]). */
let open = $state(false);

/**
 * What the graph turns out to produce, while the dialog is open ([Q41]).
 *
 * **Asked for by graph, not taken from `preview.hairlines`.** That one is whatever the map last
 * drew, which is the graph on screen - and an export is per graph ([Q32]), so the two are the same
 * until they are not. Numbers about a different artefact, directly above the button that writes
 * this one, would be worse than no numbers.
 *
 * Fetched on opening rather than kept in step: it is a function of the graph as it stands, and
 * asking once, when someone is about to commit, cannot go stale.
 */
let producing = $state<Preview | null>(null);

/** What Studio can write, for the modal's wording and the dialog's filters. Fetched once. */
let formats = $state<string[]>([]);

export const exporting = {
	get open(): boolean {
		return open;
	},

	get producing(): Preview | null {
		return producing;
	},

	get formats(): string[] {
		return formats;
	},

	/** Reads the writable formats. Called once, at startup. */
	async loadFormats(): Promise<void> {
		formats = await writableFormats();
	},

	close(): void {
		open = false;
	},

	/**
	 * Opens the dialog and asks what this graph produces.
	 *
	 * A build that fails is not a reason to refuse the dialog: what it must say is what will be
	 * written and what that costs, and both come from elsewhere. This is confirmation.
	 */
	async show(graph: number | null): Promise<void> {
		open = true;
		producing = null;
		if (graph === null) return;
		// The variant is not this caller's business: a graph that is switched off and one whose build
		// was superseded both produce nothing to describe, and the dialog says the same either way.
		producing = await mountGraph(graph)
			.then((mounted) => (mounted.type === 'tiles' ? mounted.preview : null))
			.catch(() => null);
	},

	/** Runs the estimate the dialog asks for.
	 *
	 *  Takes the compression because a tile's size is a property of its encoding: the core samples
	 *  through the same re-encoding the write applies, so choosing brotli changes the number. */
	estimate(graph: number | null, crop: Bounds, compression: Compression): Promise<Estimate> {
		if (graph === null) return Promise.reject(new Error('that graph is no longer open'));
		return estimateExport(graph, crop, compression);
	},

	/**
	 * Writes this graph to a container, as a job.
	 *
	 * **The dialog decides the container now, and the filename follows it.** This used to collect
	 * only the destination, on the argument that asking for a format in a form and then letting the
	 * filename contradict it would be two answers to one question. That argument still holds - what
	 * changed is which of the two answers: the picker sets the save dialog's default name and its
	 * only filter, and [`withExtension`] settles anything the platform dialog let through. So there
	 * is still exactly one answer, and it is now the one the user chose rather than the one they
	 * typed.
	 *
	 * Returns once the job is submitted rather than once it is done - an export runs for minutes, and
	 * the bar is where it is watched and cancelled (E7).
	 *
	 * **No `status` message.** The job *is* the status: the bar prefers a running job over a status
	 * line, so a message set here was invisible while the export ran and surfaced only once it had
	 * stopped - the one moment it was no longer true.
	 */
	async start(
		graph: number | null,
		name: string,
		crop: Bounds,
		format: string,
		compression: Compression
	): Promise<void> {
		open = false;
		if (graph === null) return;
		try {
			const target = await save({
				title: `Export ${name}`,
				defaultPath: `${name}.${format}`,
				// One filter, not the whole list: the picker above has already answered this, and a
				// dialog still offering the other two would be inviting the contradiction.
				filters: [{ name: format, extensions: [format] }]
			});
			if (!target) return; // cancelled
			await exportGraph(graph, withExtension(target, format), crop, compression);
		} catch (error) {
			status.fail(error);
		}
	}
};

/**
 * `path` ending in `.format`, whatever it ended in before.
 *
 * **Because the platform dialogs do not agree.** A single-extension filter is a strong hint and not
 * a guarantee: type `berlin.pmtiles` into a dialog filtered to `versatiles` and macOS asks whether
 * you meant it, GTK takes it, and Windows appends. The core reads the container from the extension,
 * so whichever way it goes the picker has to be the thing that decided.
 *
 * **Replaced only when what is there is another container extension.** `berlin.pmtiles` becomes
 * `berlin.versatiles`, and `my.export` becomes `my.export.versatiles` rather than losing the half of
 * its name that looks like a suffix and is not.
 */
export function withExtension(path: string, format: string): string {
	if (path.toLowerCase().endsWith(`.${format}`)) return path;
	const dot = path.lastIndexOf('.');
	const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	const current = dot > slash ? path.slice(dot + 1).toLowerCase() : null;
	return current !== null && formats.includes(current) ? `${path.slice(0, dot)}.${format}` : `${path}.${format}`;
}
