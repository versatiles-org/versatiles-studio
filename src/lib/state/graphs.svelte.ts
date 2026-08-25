/**
 * The project's graphs, and which of them the map draws ([Q32], [Q49]).
 *
 * Several named VPL documents, each producing one named tile source. The list is what the pane draws
 * and what the style names its sources by; the eyes are which of them, and how much of each, is
 * being drawn.
 *
 * **Three rules that were enforced by statement order and are now enforced by the functions.**
 * Removing a graph has to read its name *before* the removal, or its tiles stay on the map for the
 * rest of the session with nothing left to look the name up with. Renaming has to forget the old
 * name and rebuild, because the mount moves with it. And both have to refetch the list, because the
 * unsaved dot lives on it.
 *
 * **What this does not own.** Which document is on screen - that is `document.svelte.ts`, and this
 * only says which graphs exist. Redrawing the map after any of this is the application's fan-out.
 *
 * [Q32]: ../../../docs/decisions.md
 * [Q49]: ../../../docs/decisions.md
 */

import { listGraphs, removeGraph, renameGraph, setGraphEnabled, setNodeEnabled, type GraphInfo } from '../ipc/commands';
import { preview } from './preview.svelte';

let list = $state<GraphInfo[]>([]);

export const graphs = {
	get list(): GraphInfo[] {
		return list;
	},

	/** Whether a graph is drawn at all - its row's eye ([Q49]). Unknown graphs count as drawn. */
	isEnabled(id: number): boolean {
		return list.find((graph) => graph.id === id)?.enabled ?? true;
	},

	/** The node paths switched off in a graph ([Q49]). */
	disabledIn(id: number): number[][] {
		return list.find((graph) => graph.id === id)?.disabled ?? [];
	},

	/** Whether the project has no graphs - which is the landing screen's whole condition. */
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

	/**
	 * Builds every graph that has not been built yet, so a style can draw the whole stack (S6.5).
	 *
	 * **On open, not on every refresh.** A project's graphs are one build apiece - a cost a person
	 * expects when opening something and would not forgive on every keystroke.
	 */
	async mountAll(): Promise<void> {
		// **Only the ones that are drawn** ([Q49]). A graph whose eye is off costs nothing on open,
		// which is most of why the eye is worth having on a project with a slow source in it.
		const unbuilt = list.filter((graph) => graph.enabled && !(graph.name in preview.built)).map((graph) => graph.id);
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
	 * Returns the graph that should be shown next, or `null` when that was the last one - the caller
	 * owns the document, so it decides what to open rather than being told.
	 */
	async remove(id: number): Promise<number | null> {
		// Read before it is gone: afterwards there is nothing left to look the name up with.
		const gone = this.nameOf(id);
		await removeGraph(id);
		if (gone) preview.forget(gone);
		await this.refresh();
		return list[0]?.id ?? null;
	},

	/**
	 * Switches a graph on or off ([Q49]).
	 *
	 * **The tiles go with it.** Off, its mount is forgotten so nothing draws it and nothing names it
	 * in the style; on, it is built like any graph that has not been built yet. Doing only half of
	 * this is how a source stays on the map after its eye says it is gone.
	 */
	async setEnabled(id: number, enabled: boolean): Promise<void> {
		const name = this.nameOf(id);
		await setGraphEnabled(id, enabled);
		if (!enabled && name) preview.forget(name);
		await this.refresh();
		if (enabled) await this.mountAll();
	},

	/**
	 * Switches one node of a graph on or off ([Q49]).
	 *
	 * The graph is rebuilt, because what it produces has changed - which is the whole difference
	 * between this and the pin it replaces: the tiles under that graph's name are now the tiles of
	 * the pipeline you can see.
	 */
	async setNodeEnabled(id: number, path: number[], enabled: boolean): Promise<void> {
		await setNodeEnabled(id, path, enabled);
		await this.refresh();
		await preview.rebuild(id);
	}
};
