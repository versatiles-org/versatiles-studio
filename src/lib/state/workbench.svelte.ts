/**
 * Opening things, editing them, and keeping every view agreeing about what is open (Q22, Q25).
 *
 * **One funnel, and this is it.** Every path that changes the document ends at [`applyDocument`],
 * so the map, the editor, the graph list and the selection can never be following different versions
 * of it. That was true before this module existed and was enforced by the order of statements inside
 * two dozen functions in `App.svelte` - true, but not visible from any one call site, and not
 * testable at all: the sequence *open → sync the containers → build → say what happened* was only
 * reachable by mounting the whole application.
 *
 * **What this owns.** The catalogue of ways in (fetched once), and the sequencing. What each step
 * *does* belongs to the module that holds that state - `graphs`, `document`, `preview`, `project`,
 * `style` - and this calls them in the order that leaves the window consistent.
 *
 * **What it does not own: the map.** It is created by `MapCanvas` and bound by the component, so it
 * arrives through [`bind`] as a function rather than a value - a module holding the instance would
 * hold a stale one across the reload that replaces it. The status bar is written to rather than
 * returned, because unlike `preview.refresh` these are whole gestures: "opening a file" has one
 * outcome a person should be told about, and threading it back out would put the sentence at the
 * call site instead of where the failure happened.
 */

import type { Map as MaplibreMap } from 'maplibre-gl';
import { save } from '@tauri-apps/plugin-dialog';
import { anyExtension, askForSource } from '../common/import';
import { fitToBounds } from '../map/add-source';
import { composition } from '../map/composition.svelte';
import {
	addGraph,
	formatGraph,
	getGraph,
	importKinds,
	importOpening,
	isProject,
	importReadNode,
	openVpl,
	redo as redoStep,
	saveVpl,
	setCrop,
	setGraph,
	undo as undoStep,
	vplInsertNode,
	vplRemoveNode,
	type Bounds,
	type DocumentView,
	type EditKind,
	type ImportKind,
	type Recipe,
	type Span
} from '../ipc/commands';
import { document } from './document.svelte';
import { graphs } from './graphs.svelte';
import { layout } from './layout.svelte';
import { preview } from './preview.svelte';
import { project } from './project.svelte';
import { status } from './status.svelte';
import { style as recipe } from './style.svelte';

/**
 * Where an opened source lands.
 *
 * **`current` replaces what is on screen**, which is what File → Open and a dropped file have always
 * meant: opening a file *is* setting the pipeline to its read node (Q22, Q25), from when a window
 * held one document.
 *
 * **`new` puts it beside what is open**, which is what a door in the Sources pane means - that list
 * adds sources, and one that quietly overwrote the selected graph would be the same gesture as
 * `＋ new graph…` doing the opposite of its label. A window with nothing open cannot tell the two
 * apart, and does not have to.
 */
export type Into = 'current' | 'new';

/** The last segment of a path, which is what a person calls the thing they opened. */
const filename = (source: string) => source.split(/[/\\]/).pop() || source;

/**
 * Every way in this build has (S3.2).
 *
 * Build-time information about the binary, so it is fetched once - and fetched rather than written
 * down, because the dialog, the drop target and the cards had each carried their own copy of the
 * same list and had already fallen out of step: none of them knew about `from_geo`, which the binary
 * has had all along.
 *
 * **Not exported.** The cards read it once, to filter the file dialog on a node's read operation;
 * they read [vt#260]'s per-argument `accepts` now, which is right for every path field rather than
 * for one per node. What is left here is this window's own business - what it will accept on a drop,
 * and what Save writes.
 *
 * [vt#260]: https://github.com/versatiles-org/versatiles-rs/issues/260
 */
let kinds = $state<ImportKind[]>([]);

/** Extensions the window accepts at all, for the drop target. */
const accepted = $derived(anyExtension(kinds));

/**
 * What Save writes.
 *
 * Taken from the same catalogue as the open side, so the extension a pipeline is saved with is by
 * construction one that can be opened again.
 */
const pipelineExtensions = $derived(kinds.find((kind) => kind.id === 'pipeline')?.extensions ?? ['vpl']);

/** The map this window draws on, or `undefined` before `MapCanvas` has made one. */
let mapOf: () => MaplibreMap | undefined = () => undefined;

export const workbench = {
	/** Points this at the window's map. Called once, from the component that binds it. */
	bind(map: () => MaplibreMap | undefined): void {
		mapOf = map;
	},

	/** Reads the catalogue of ways in. Called once, at startup. */
	async load(): Promise<void> {
		kinds = await importKinds().catch(() => []);
	},

	/** Whether a dropped path is one this build can read at all. */
	accepts(path: string): boolean {
		return accepted.some((extension) => path.toLowerCase().endsWith(`.${extension}`));
	},

	/** What the graph on screen is narrowed to (F2, S5.2, S5.4). */
	get crop(): Bounds {
		const found = graphs.list.find((graph) => graph.id === document.graph);
		return found?.crop ?? { bbox: null, minZoom: null, maxZoom: null };
	},

	// -- the funnel ------------------------------------------------------------------------------

	/**
	 * Applies a document the core has handed back - after an edit, an undo, or a reload.
	 *
	 * Every path that changes the pipeline ends here, so the map, the editor and the selection can
	 * never be following different versions of it.
	 */
	async applyDocument(next: DocumentView): Promise<void> {
		// A path taken from one graph does not name anything in another, and undo may hand back a
		// graph other than the one on screen ([Q32]). The selection goes with it, exactly as it does
		// when a graph is chosen from the list.
		document.show(next);
		// The list shows the name and the unsaved dot - the last of which changes on every edit, so
		// this refreshes here rather than only when a graph is added or removed.
		await graphs.refresh();
		await this.syncContainers();
		await this.refresh();
	},

	/**
	 * Builds the preview and says in the bar what came of it.
	 *
	 * The rule itself is `preview.refresh`; this is the half that is about *this window* - the map it
	 * is bound to, and the one status bar the outcome has to be reported in.
	 */
	async refresh(): Promise<void> {
		try {
			const done = await preview.refresh({
				map: mapOf(),
				pipeline: document.current,
				styled: () => composition.drawn,
				// A camera came back from the core, so this window is a reload rather than a first open
				// and already knows where it was looking.
				restored: layout.current?.view != null
			});
			switch (done.kind) {
				// A newer build owns the map and is still working; the bar is its to set, not ours.
				case 'superseded':
					return;
				// Nothing was built, so nothing later will clear an "Opening …" the caller set.
				case 'nothing':
					return status.settle();
				case 'unrenderable':
					return status.fail(done.message);
				case 'shown':
					return status.settle();
				// No map or no graph: nothing happened, and whatever the bar says still stands.
				case 'unavailable':
					return;
			}
		} catch (error) {
			status.fail(error);
		}
	},

	/** Opens whatever the pipeline now reads, naming each one in the bar as it goes. */
	async syncContainers(): Promise<void> {
		if (!document.current) return;
		await preview.syncContainers(document.current, (source) => status.busy(`Opening ${filename(source)}…`));
	},

	/**
	 * Runs an edit that produces a new document, and applies it.
	 *
	 * **The scaffolding, once.** Four functions had written out the same guard, the same `try` and the
	 * same `catch`; what varies between them is a single expression, and it was the least visible part
	 * of each.
	 */
	async edit(produce: (doc: DocumentView) => Promise<DocumentView>): Promise<void> {
		const doc = document.current;
		if (!doc) return;
		try {
			await this.applyDocument(await produce(doc));
		} catch (error) {
			status.fail(error);
		}
	},

	/**
	 * Editing a parameter rewrites the document through the core, which owns the quoting and refuses
	 * anything that would not parse.
	 */
	editText(run: (text: string) => Promise<string>): Promise<void> {
		return this.edit(async (doc) => this.setText(await run(doc.text), 'structured'));
	},

	/**
	 * Writes text into the current graph, creating one if this is the first thing opened.
	 *
	 * The single place that decides *which* graph an edit lands in, which is what lets every call site
	 * stay unaware that there is more than one ([Q32]).
	 *
	 * **The name it creates with is a placeholder.** `add` sanitises and makes it unique, so opening
	 * three files in a row yields `graph`, `graph-2`, `graph-3` - and under [Q32] that name is the
	 * server mount, the `style.json` source and the `.vpl` filename at once, so it is the wrong name
	 * in three places rather than one. The callers know what they opened; this signature does not
	 * carry it yet.
	 */
	async setText(
		text: string,
		kind: EditKind = 'structured',
		source: string | null = null,
		into: Into = 'current'
	): Promise<DocumentView> {
		if (into === 'new' || document.graph === null) {
			const created = await addGraph(source, text);
			await graphs.refresh();
			return created;
		}
		return await setGraph(document.graph, text, kind);
	},

	// -- the graphs ------------------------------------------------------------------------------

	/**
	 * Starts a graph on a read node, with nothing filled in yet.
	 *
	 * **`addGraph` rather than `setText`**, which writes into the graph on screen whenever there is
	 * one - the door says "new graph", so it makes one whether or not something is open.
	 *
	 * It arrives incomplete on purpose. `from_container` with no `filename` is a node whose form says
	 * what is missing and whose path field has a picker beside it (C2, C4).
	 */
	async newGraph(operation: string): Promise<void> {
		try {
			await this.applyDocument(await addGraph(null, operation));
		} catch (error) {
			status.fail(error);
		}
	},

	/** Shows another graph's chain. The map is a separate question ([Q32]). */
	async select(id: number): Promise<void> {
		const found = await getGraph(id);
		if (found) document.show(found);
	},

	/**
	 * Renames a graph. Refused by the core when the name is taken, and the reason is worth seeing -
	 * the name is the mount, the style's source name and the `.vpl` filename at once.
	 */
	async rename(id: number, name: string): Promise<void> {
		try {
			await graphs.rename(id, name);
			if (id === document.graph) document.update(await getGraph(id));
			await this.refresh();
		} catch (error) {
			status.fail(error);
		}
	},

	/**
	 * Removes a graph for good.
	 *
	 * **Not undoable**, which the list says before doing it: the history restores text *into* a graph
	 * ([Q32]), so one that is gone has nothing to restore into. Everything else about the removal is
	 * the core's - it unmounts the graph so the style stops resolving a source that no longer exists -
	 * so what is left here is deciding what to look at next.
	 */
	async remove(id: number): Promise<void> {
		try {
			const next = await graphs.remove(id);
			// The first remaining graph, or nothing at all when that was the last one.
			if (id === document.graph) document.show(next === null ? null : ((await getGraph(next)) ?? null));

			// `refresh` returns early with no graph, so the layer it drew would outlive the graph it
			// came from - a map still showing tiles from a document that is gone.
			if (document.current) await this.refresh();
			else preview.clear(mapOf());
		} catch (error) {
			status.fail(error);
		}
	},

	/**
	 * Switches one node of the graph on screen on or off ([Q49]).
	 *
	 * **The head node's eye is the graph's**, because a chain that reads nothing is not a chain - so
	 * it goes to the same switch the row in the list uses rather than to a second one that would have
	 * to be kept in step with it.
	 */
	async toggleNode(path: number[], enabled: boolean): Promise<void> {
		const graph = document.graph;
		if (graph === null) return;
		try {
			if (path.length === 1 && path[0] === 0) await this.toggleGraph(graph, enabled);
			else {
				await graphs.setNodeEnabled(graph, path, enabled);
				await this.refresh();
			}
		} catch (error) {
			status.fail(error);
		}
	},

	/**
	 * Switches a whole graph on or off - the eye on its row ([Q49]).
	 *
	 * Durable, so a source somebody switched off is still off when the project is reopened. The map
	 * follows because the stack is drawn from what is built, and an off graph is not built.
	 */
	async toggleGraph(id: number, enabled: boolean): Promise<void> {
		try {
			await graphs.setEnabled(id, enabled);
			await this.refresh();
		} catch (error) {
			status.fail(error);
		}
	},

	// -- the crop --------------------------------------------------------------------------------

	async setCrop(next: Bounds): Promise<void> {
		if (!document.current) return;
		try {
			await setCrop(document.current.graph, next);
			await graphs.refresh();
		} catch (error) {
			status.fail(error);
		}
	},

	/**
	 * Crops to what the map is showing, keeping the zoom range alone - the two are separate
	 * decisions, and someone who set 4-12 did not mean to lose it by framing a city.
	 */
	cropToView(): void {
		const map = mapOf();
		if (!map) return;
		const bounds = map.getBounds();
		void this.setCrop({
			bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
			minZoom: this.crop.minZoom,
			maxZoom: this.crop.maxZoom
		});
	},

	/**
	 * Returns the camera to what is currently open.
	 *
	 * **The only thing that reframes the map after the first preview**, now that a rebuild leaves the
	 * camera alone. Animated, because someone asked for it and should see where they went.
	 */
	resetView(): void {
		const map = mapOf();
		const bbox = composition.editedName === null ? null : (preview.built[composition.editedName]?.info.bbox ?? null);
		if (map && bbox) fitToBounds(map, bbox, true);
	},

	// -- the document ----------------------------------------------------------------------------

	/** Lays the current graph's VPL out again (S1.11). */
	format(): Promise<void> {
		return this.edit((doc) => formatGraph(doc.graph));
	},

	/** Adds a transform after the node whose name occupies `span`. */
	addOperation(afterNameSpan: Span, operation: string): Promise<void> {
		return this.edit(async (doc) => this.setText(await vplInsertNode(doc.text, afterNameSpan, operation)));
	},

	/**
	 * Removes a node.
	 *
	 * Dropped here rather than left to `applyDocument`, which keeps a selection whose path still
	 * resolves: removing the middle of a three-node chain leaves `[1]` naming whatever moved up into
	 * it, so the form would quietly re-open on a node nobody chose.
	 */
	removeNode(span: Span): Promise<void> {
		return this.edit(async (doc) => this.setText(await vplRemoveNode(doc.text, span)));
	},

	/**
	 * Writes the pipeline as a `.vpl`. Asks where when there is no file yet, or when asked to.
	 *
	 * Saving a *project* is a different command with a different scope (G1, S5.1) - this is the
	 * pipeline as the file the CLI already reads.
	 */
	async save(chooseFile: boolean): Promise<void> {
		const doc = document.current;
		if (!doc) return;
		try {
			let target = chooseFile ? null : doc.path;
			if (!target) {
				target = await save({
					title: 'Save pipeline',
					// The graph's name supplies the filename ([Q35]) - the direction the binding runs.
					// `pipeline.vpl` was a leftover from when a window held exactly one document, and it
					// offered the same name for every graph in a project that now holds several.
					defaultPath: doc.path ?? `${doc.name}.${pipelineExtensions[0]}`,
					filters: [{ name: 'VPL pipelines', extensions: pipelineExtensions }]
				});
				if (!target) return; // cancelled
			}
			document.update(await saveVpl(doc.graph, target));
			status.busy(`Saved ${filename(target)}`);
			// The other half of the dot: saving is what clears it, and the list has to be told.
			await graphs.refresh();
			status.settle();
		} catch (error) {
			status.fail(error);
		}
	},

	/**
	 * ⌘Z walks one stack across the graphs *and* the style ([Q36], S4.7), so the step says which
	 * document it restored and this redraws that one. Undoing a style edit and undoing a pipeline edit
	 * are the same gesture on the same history; only what changes afterwards differs.
	 */
	async stepHistory(back: boolean): Promise<void> {
		try {
			const next = await (back ? undoStep() : redoStep());
			if (!next) return;
			// Tested for a value rather than for the key: specta spells the union with `?: never` on the
			// absent side, so `'graph' in next` narrows the variant without narrowing the field.
			if (next.graph) await this.applyDocument(next.graph);
			else if (next.style) recipe.restored(next.style);
		} catch (error) {
			status.fail(error);
		}
	},

	// -- the ways in -----------------------------------------------------------------------------

	/**
	 * Opens the file dialog, narrowed to one import kind when the caller knows which.
	 *
	 * Two callers, and they know different amounts: File → Open takes anything Studio can read, while
	 * "from VPL file…" is asking for a `.vpl` and says so. Whatever comes back goes to [`open`], which
	 * asks the core what the file is rather than trusting which door it came through.
	 */
	async pick(kind?: ImportKind, into: Into = 'current'): Promise<void> {
		const picked = await askForSource(kinds, kind);
		if (picked) await this.open(picked, into);
	},

	/** The pipeline kind, for the door that asks for a `.vpl` and says so. */
	get pipelineKind(): ImportKind | undefined {
		return kinds.find((kind) => kind.id === 'pipeline');
	},

	/**
	 * Opening a file *is* setting the pipeline to its read node (Q22, Q25). Opening a `.vpl` sets the
	 * pipeline to what the file says.
	 *
	 * Which read node is the catalogue's answer, not a branch here: a container becomes
	 * `from_container`, a GeoJSON `from_geo`, a CSV `from_csv` (S3.2). A container is additionally
	 * *mounted*, because the inspector reads tiles from it directly (A4); the others have nothing to
	 * inspect until the pipeline has built them, which the preview does.
	 */
	async open(source: string, into: Into = 'current'): Promise<void> {
		// A remote container reads its index over the network, so this is not always instant.
		status.busy(`Opening ${filename(source)}…`);
		try {
			// **What it is, not what it is called.** Three formats wear `.json`, so the kind comes from
			// reading the document when its name cannot settle it - and a TileJSON on disk is refused
			// with a sentence rather than opened as GeoJSON and failed three steps later.
			const opening = await importOpening(source);
			if (opening.refused !== null) return status.fail(opening.refused);

			const kind = opening.kind;
			if (kind === null) return status.fail(`Studio has no way to open ${filename(source)}`);

			if (kind.operation === null) {
				// Through the funnel rather than assigning the document here: `open_vpl` creates the graph
				// in the core, and a webview that only took the document back was left with a graph list
				// that did not know about it. Everything downstream of "there is now a graph" then behaved
				// as though there were none - including the landing screen, which stayed up over the
				// pipeline it had just opened.
				await this.applyDocument(await openVpl(source));
			} else if (kind.id === 'container') {
				const result = await preview.mount(source);
				document.show(await this.setText(result.vpl, 'replaced', source, into));
			} else {
				const opened = await this.setText(await importReadNode(kind.id, source), 'replaced', source, into);
				document.show(opened);
				// Whether the node is complete is the *document's* answer, not the kind's. A CSV whose
				// header named its coordinate columns arrives with them already set (S3.4), so asking the
				// kind - which needs them for every CSV - would tell someone to fill in fields that are
				// filled in. The form is already showing whatever is missing (C2, C4); this only says so
				// where the eye already is.
				if (opened.diagnostics.length > 0) return status.fail(opened.diagnostics[0].message);
			}
			await this.refresh();
		} catch (error) {
			status.fail(error);
		}
	},

	/** Opens a project directory, replacing what is open - a window is one project ([Q16]). */
	openProject(): Promise<void> {
		return this.adopt(() => project.open());
	},

	/**
	 * What a window does once a project directory has been read, however it was chosen.
	 *
	 * Shared by the menu, which asks for the directory, and by a path handed to this window by the
	 * launcher - the two have to end in the same state, and the second used to end in an error.
	 */
	async adopt(read: () => Promise<Recipe | null>): Promise<void> {
		try {
			const found = await read();
			if (!found) return;
			recipe.restored(found);
			await graphs.refresh();
			if (graphs.first) document.show(await getGraph(graphs.first.id));
			await this.syncContainers();
			// Every graph, not just the one that opens - a style names them all (S6.5), and this is the
			// moment a person is already waiting.
			await graphs.mountAll();
			await this.refresh();
			status.settle();
		} catch (error) {
			status.fail(error);
		}
	},

	/**
	 * What everything the OS hands over ends up at - a file, or a project directory.
	 *
	 * **A project folder is not a file to import** (S7.5). The launcher hands one over the same queue
	 * a double-clicked container arrives on, and everything here used to go to `open`, which asks the
	 * catalogue for a read node and gets none for a directory.
	 */
	async openPath(path: string): Promise<void> {
		if (await isProject(path).catch(() => false)) await this.adopt(() => project.at(path));
		else await this.open(path);
	}
};
