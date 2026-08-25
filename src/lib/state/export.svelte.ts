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
	type Estimate,
	type Preview
} from '../ipc/commands';
import { status } from './status.svelte';

/** Whether the export modal is up. For the graph being edited - exporting is per graph ([Q32]). */
let open = $state(false);

/**
 * What the graph turns out to produce, while the dialog is open ([Q41]).
 *
 * **Asked for by name, not taken from `preview.last`.** That one follows the pin, so with a node
 * pinned it describes an intermediate step - and the export writes the graph regardless. Numbers
 * about a different artefact, directly above the button that writes this one, would be worse than
 * no numbers.
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
		producing = await mountGraph(graph).catch(() => null);
	},

	/** Runs the estimate the dialog asks for. */
	estimate(graph: number | null, crop: Bounds): Promise<Estimate> {
		if (graph === null) return Promise.reject(new Error('that graph is no longer open'));
		return estimateExport(graph, crop);
	},

	/**
	 * Writes this graph to a container, as a job.
	 *
	 * Collects only the *destination*: the extension chosen is what decides the format, and asking
	 * for a format in a form and then letting the filename contradict it would be two answers to one
	 * question.
	 *
	 * Returns once the job is submitted rather than once it is done - an export runs for minutes, and
	 * the bar is where it is watched and cancelled (E7).
	 *
	 * **No `status` message.** The job *is* the status: the bar prefers a running job over a status
	 * line, so a message set here was invisible while the export ran and surfaced only once it had
	 * stopped - the one moment it was no longer true.
	 */
	async start(graph: number | null, name: string, crop: Bounds): Promise<void> {
		open = false;
		if (graph === null) return;
		try {
			const target = await save({
				title: `Export ${name}`,
				defaultPath: `${name}.${formats[0] ?? 'versatiles'}`,
				filters: [{ name: 'Tile containers', extensions: formats }]
			});
			if (!target) return; // cancelled
			await exportGraph(graph, target, crop);
		} catch (error) {
			status.fail(error);
		}
	}
};
