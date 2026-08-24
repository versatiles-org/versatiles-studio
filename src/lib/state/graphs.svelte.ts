/**
 * The project's graphs, and where the map is looking ([Q32]).
 *
 * Several named VPL documents, each producing one named tile source. The list is what the pane draws
 * and what the style names its sources by; the pin is which node the map shows.
 *
 * **Three rules that were enforced by statement order and are now enforced by the functions.**
 * Removing a graph has to read its name *before* the removal, or its tiles stay on the map for the
 * rest of the session with nothing left to look the name up with. Renaming has to forget the old
 * name and rebuild, because the mount moves with it. And both have to refetch the list, because the
 * unsaved dot lives on it.
 *
 * **What this does not own.** Which document is on screen — that is `document.svelte.ts`, and this
 * only says which graphs exist. Redrawing the map after any of this is the application's fan-out.
 *
 * [Q32]: ../../../docs/decisions.md
 */

import { getPinned, listGraphs, removeGraph, renameGraph, setPin, type GraphInfo } from '../ipc/commands';
import { preview } from './preview.svelte';

let list = $state<GraphInfo[]>([]);

/**
 * Where the map is looking. **Not the selection** — you can edit one node while watching another,
 * in another graph. `null` is the ordinary state: the map shows every graph.
 */
let pin = $state<{ graph: number; path: number[] } | null>(null);

/** Whether two node paths name the same node. */
const samePath = (a: number[], b: number[]) => a.length === b.length && a.every((step, i) => step === b[i]);

export const graphs = {
	get list(): GraphInfo[] {
		return list;
	},

	get pinned(): { graph: number; path: number[] } | null {
		return pin;
	},

	/** Whether the project has no graphs — which is the landing screen's whole condition. */
	get empty(): boolean {
		return list.length === 0;
	},

	/** The first graph, which is what opening a project shows. */
	get first(): GraphInfo | undefined {
		return list[0];
	},

	nameOf(id: number): string | null {
		return list.find((graph) => graph.id === id)?.name ?? null;
	},

	/**
	 * Refetches the list.
	 *
	 * Called after every edit and not only on add or remove: the unsaved dot beside a name changes
	 * with the document, and it is read from here.
	 */
	async refresh(): Promise<void> {
		list = await listGraphs().catch(() => []);
	},

	/** Reads the pin back from the core, which may have dropped it. */
	async readPin(): Promise<void> {
		pin = await getPinned();
	},

	/**
	 * Builds every graph that has not been built yet, so a style can draw the whole stack (S6.5).
	 *
	 * **On open, not on every refresh.** A project's graphs are one build apiece — a cost a person
	 * expects when opening something and would not forgive on every keystroke.
	 */
	async mountAll(): Promise<void> {
		const unbuilt = list.filter((graph) => !(graph.name in preview.built)).map((graph) => graph.id);
		if (unbuilt.length > 0) await preview.mountAll(unbuilt);
	},

	/**
	 * Renames a graph, carrying its tiles with it.
	 *
	 * The stack is keyed by name and the core remounts under the new one, so the old entry is stale
	 * the moment this returns. Dropped rather than moved: one source of truth, not two.
	 */
	async rename(id: number, name: string): Promise<void> {
		const before = this.nameOf(id);
		await renameGraph(id, name);
		if (before) preview.forget(before);
		await this.refresh();
		await this.mountAll();
	},

	/**
	 * Removes a graph and forgets its tiles.
	 *
	 * Returns the graph that should be shown next, or `null` when that was the last one — the caller
	 * owns the document, so it decides what to open rather than being told.
	 */
	async remove(id: number): Promise<number | null> {
		// Read before it is gone: afterwards there is nothing left to look the name up with.
		const gone = this.nameOf(id);
		await removeGraph(id);
		if (gone) preview.forget(gone);
		await this.refresh();
		await this.readPin();
		return list[0]?.id ?? null;
	},

	/**
	 * Moves the pin to a node, or clears it when it is already there.
	 *
	 * Clicking the pinned node again is what gets you back to seeing every graph — the same gesture
	 * off as on, because a separate "clear" would be a control that only exists sometimes.
	 */
	async togglePin(graph: number, path: number[]): Promise<void> {
		const same = pin && pin.graph === graph && samePath(pin.path, path);
		pin = await setPin(same ? null : { graph, path });
	}
};
