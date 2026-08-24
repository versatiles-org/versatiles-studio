/**
 * The VPL document on screen, and whether the editor has to reload it ([Q32], S2.8).
 *
 * **Two variables that are really one, and a rule about when they move together.** The document and
 * a revision counter lived side by side in `App.svelte`, written as a pair in six places and
 * deliberately *not* as a pair in four more — the difference being whether the text changed because
 * of the editor or in spite of it. That rule was enforced by remembering to write a second line.
 *
 * This does not own what *happens* when the document changes. Refetching the graph list, resyncing
 * the containers and rebuilding the preview are the application's fan-out, and they stay where the
 * map and the status bar are. What moves here is the state and the one rule about it.
 *
 * [Q32]: ../../../docs/decisions.md
 */

import type { DocumentView } from '../ipc/commands';

let current = $state<DocumentView | null>(null);

/**
 * Bumped whenever the editor must reload from the document rather than keep what it has.
 *
 * The textarea is uncontrolled while someone is typing in it — that is what makes typing feel like
 * typing — so it reloads on this changing and not on the text changing.
 */
let revision = $state(0);

export const document = {
	/** The document on screen, or `null` when no graph is open. */
	get current(): DocumentView | null {
		return current;
	},

	/** What the editor reloads on. */
	get revision(): number {
		return revision;
	},

	/** The graph this document belongs to, or `null` when there is none. */
	get graph(): number | null {
		return current?.graph ?? null;
	},

	/**
	 * The document changed from **outside** the editor — a different graph, an undo, a reformat, a
	 * reload. The editor reloads.
	 *
	 * Forgetting the bump is the bug this exists to make unspellable: the text would be new and the
	 * textarea would keep showing the old one, which reads as an edit that did not take.
	 */
	show(next: DocumentView | null): void {
		current = next;
		revision += 1;
	},

	/**
	 * The document changed **because of** the editor — typing, or a save that only cleared the dirty
	 * flag. The editor keeps what it has.
	 *
	 * Bumping here instead would reload the textarea on every keystroke, taking the caret with it.
	 */
	update(next: DocumentView | null): void {
		current = next;
	}
};
