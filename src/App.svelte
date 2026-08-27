<script lang="ts">
	import { save } from '@tauri-apps/plugin-dialog';
	import { untrack } from 'svelte';
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import AppShell from './lib/shell/AppShell.svelte';
	import StatusBar from './lib/shell/StatusBar.svelte';
	import Boundary from './lib/shell/Boundary.svelte';
	import Help from './lib/common/Help.svelte';
	import { connectJobs } from './lib/state/jobs.svelte';
	import { refresh as refreshProblems, reportProblem, watch as watchForProblems } from './lib/state/diagnostics.svelte';
	import { panels } from './lib/shell/StatusBar.svelte';
	import { anyExtension, askForSource } from './lib/common/import';
	// Named for what it is, because `style` in this file is already the rendered MapLibre style.
	import { style as styleRecipe } from './lib/state/style.svelte';
	import { registerTileProtocol } from './lib/state/tiles.svelte';
	import { preview } from './lib/state/preview.svelte';
	import { layout } from './lib/state/layout.svelte';
	import { document } from './lib/state/document.svelte';
	import { graphs } from './lib/state/graphs.svelte';
	import { project } from './lib/state/project.svelte';
	import { exporting } from './lib/state/export.svelte';
	import { status } from './lib/state/status.svelte';
	import Inspector from './lib/panes/inspector/Inspector.svelte';
	import LayersPane from './lib/panes/layers/LayersPane.svelte';
	import { move, segmentsFrom } from './lib/panes/layers/move';
	import Sidebar from './lib/shell/Sidebar.svelte';
	import { windowEvents } from './lib/shell/window-events.svelte';
	import PipelinePane from './lib/panes/pipeline/PipelinePane.svelte';
	import SourcesPane from './lib/panes/sources/SourcesPane.svelte';
	import StylePane from './lib/panes/style/StylePane.svelte';
	import AlphaRibbon from './lib/shell/AlphaRibbon.svelte';
	import AssetsDialog from './lib/shell/AssetsDialog.svelte';
	import UpdateDialog from './lib/shell/UpdateDialog.svelte';
	import ExportDialog from './lib/panes/pipeline/ExportDialog.svelte';
	import CopyDialog from './lib/panes/project/CopyDialog.svelte';
	import MapCanvas from './lib/map/MapCanvas.svelte';
	import FeaturePopup from './lib/map/FeaturePopup.svelte';
	import TileGrid from './lib/map/TileGrid.svelte';
	import { requestedZoom } from './lib/map/tile-grid';
	import TileActivity from './lib/map/TileActivity.svelte';
	import CropOverlay from './lib/map/CropOverlay.svelte';
	import { bboxField } from './lib/state/bbox.svelte';
	import MapControls from './lib/map/MapControls.svelte';
	import CoordinateJump from './lib/map/CoordinateJump.svelte';
	import Views from './lib/map/Views.svelte';
	import { fitToBounds } from './lib/map/add-source';
	import { declaredLayers } from './lib/map/tile-json';
	import { composition } from './lib/map/composition.svelte';
	import {
		setCrop,
		addGraph,
		setGraph,
		formatGraph,
		undo as undoPipeline,
		openVpl,
		saveVpl,
		redo as redoPipeline,
		vplRemoveProperty,
		vplInsertNode,
		vplRemoveNode,
		vplSetValue,
		vplSetProperty,
		vplOperations,
		getGraph,
		type DocumentView,
		type Bounds,
		type OperationInfo,
		type Span,
		importKinds,
		importOpening,
		isProject,
		type Recipe,
		importReadNode,
		fieldSuggestions,
		type EditKind,
		type ImportKind
	} from './lib/ipc/commands';

	/// Every way in this build has (S3.2). Build-time information about the binary, so it is fetched
	/// once - and it is fetched rather than written here, because the dialog, the drop target and
	/// the cards had each carried their own copy of the same list and had already fallen out of
	/// step: none of them knew about `from_geo`, which the binary has had all along.
	let kinds = $state<ImportKind[]>([]);

	/// Extensions the window accepts at all, for the drop handler. The dialog's filters come from
	/// the same catalogue through `common/import.ts`, which the launcher also uses (S7.5).
	const accepted = $derived(anyExtension(kinds));

	/// What Save writes. Taken from the same catalogue as the open side, so the extension a
	/// pipeline is saved with is by construction one that can be opened again.
	const pipelineExtensions = $derived(kinds.find((kind) => kind.id === 'pipeline')?.extensions ?? ['vpl']);

	let map = $state<MaplibreMap | undefined>();
	/// The graph being edited, and what every command that touches a document is given. One at a
	/// time on screen; the project holds several (Q32), and the list that switches between them is
	/// S2.13.
	const currentGraph = $derived(document.graph);

	// **What the style pane edits** (S6.4).
	//
	// The pane holds one graph at a time, and until this existed nothing ever told it which - so
	// every control in it read the unstyled default and wrote nowhere. It looked right, because the
	// default is what an untouched source shows, and it stayed wrong until an end-to-end test pressed
	// a preset and asked the core what it had recorded ([the plan](docs/scope-e2e.md)).
	//
	// Name as well as id, because the recipe files a source's style under its name and a rename has
	// to move the pane with it - `focus` ignores a repeat of what it already holds.
	$effect(() => {
		const id = currentGraph;
		const name = id === null ? null : graphs.nameOf(id);
		styleRecipe.focus(id !== null && name !== null ? { id, name } : null);
	});

	/// What the selected graph last built, or `null` while it has not - the inspector's other half
	/// (A6). `built` is keyed by name because that is what a mount is called.
	///
	/// **One selection, and this is it.** The panes used to follow two different answers: the style
	/// pane wrote to the *selected* graph and read what the *last preview* had produced, which are
	/// the same graph until somebody picks another one without editing it. Selecting a graph does not
	/// rebuild anything - there is nothing to rebuild - so the pane went on showing the previous
	/// graph's layers while every control wrote into the newly selected one's recipe, keyed on ids it
	/// did not have ([Q51] is the same bug one level up).
	const currentBuild = $derived(
		composition.editedName === null ? null : (preview.built[composition.editedName] ?? null)
	);

	/** Build-time information about the binary, so it is fetched once and never refreshed. */
	let operations = $state<OperationInfo[]>([]);

	/// Editing a parameter rewrites the document through the core, which owns
	/// the quoting and refuses anything that would not parse.
	/// Runs an edit that produces a new document, and applies it.
	///
	/// **The scaffolding, once.** Four functions had written out the same guard, the same `try` and
	/// the same `catch`; what varies between them is a single expression, and it was the least
	/// visible part of each.
	async function edit(produce: (doc: DocumentView) => Promise<DocumentView>) {
		const doc = document.current;
		if (!doc) return;
		try {
			await applyDocument(await produce(doc));
		} catch (e) {
			status.fail(e);
		}
	}

	/// Editing a parameter rewrites the document through the core, which owns the quoting and
	/// refuses anything that would not parse.
	const editSelected = (run: (text: string) => Promise<string>) =>
		edit(async (doc) => setPipelineText(await run(doc.text), 'structured'));
	let showGrid = $state(false);

	/// The map's zoom, as of the last gesture that ended.
	///
	/// From `onMove` rather than from `map.getZoom()`, so it is reactive: the grid's level and the
	/// number in the control that sets it are derived from this, and both have to move when the map
	/// does. `moveend` is enough - the grid itself only redraws then.
	let mapZoom = $state(0);

	/// How far the grid has been walked off the level the source is actually requesting (A5).
	let gridOffset = $state(0);

	/// What MapLibre is asking the grid's source for, and what it draws once a nudge is applied.
	const gridBase = $derived(requestedZoom(mapZoom, composition.gridSource));
	const gridLevel = $derived(Math.max(0, gridBase + gridOffset));

	// **A nudge belongs to the source it was made on.** The offset exists because one rule cannot
	// answer for a stack whose sources disagree; carrying it to the next pipeline would silently
	// re-introduce the off-by-one this control was added to end.
	$effect(() => {
		void composition.gridSource?.type;
		void composition.gridSource?.tileSize;
		gridOffset = 0;
	});

	/// What each node's fields could be set to, by the node's path (S3.4).
	///
	/// **Per node, because every node is a form.** This used to be one node's answer, fetched for
	/// whichever was selected - which was right while only the selected node had fields to fill in,
	/// and became "one file's columns offered for another file's node" the moment they all did.
	///
	/// Refetched whenever the document changes: the answer depends on each node's `filename`.
	let suggestions = $state<Record<string, Record<string, string[]>>>({});
	$effect(() => {
		// Depend on the text too - editing `filename` changes which file is being asked about.
		void document.current?.text;
		const graph = document.current?.graph;
		if (graph === undefined) {
			suggestions = {};
			return;
		}
		void fieldSuggestions(graph).then((found) => {
			suggestions = Object.fromEntries(
				found.map((node) => [node.path, Object.fromEntries(node.fields.map((f) => [f.field, f.values]))])
			);
		});
	});

	/// Property names the pipeline is producing, for the form's list fields (S3.3, E1).
	///
	/// Flattened across layers and de-duplicated: a node's `properties_include` applies to the
	/// features passing through it, not to one layer, so splitting them by layer here would be a
	/// distinction the parameter does not make.
	const producedProperties = $derived([
		...new Set((currentBuild?.layers ?? []).flatMap((layer) => layer.propertyKeys))
	]);
	/// Which surface is open (Q22, S4.1). Core-owned, so a reloaded window comes back to it.
	///
	/// A value this build does not know falls back to the map - the same rule `background` follows,
	/// and for the same reason: an old layout file must not be able to open a blank window.
	/// Whether the fonts dialog is up. Local, not durable: a window is never restored onto a dialog
	/// ([Q39]).
	let assets = $state(false);

	/// Whether the update dialog is up. Opening it is what asks - see `UpdateDialog`.
	let updating = $state(false);
	// The landing screen is what an *empty* window shows - it goes away for good once something is
	// open, and never gates anything (Q13).
	//
	// **A graph is what "something is open" means** ([Q32]). This asked `containers.length === 0`
	// until now, which was right at S1.1 when a container was the only thing you could open - and
	// silently wrong afterwards. A CSV or GeoJSON import produces a `from_csv` / `from_geo` node and
	// no container at all, and a reloaded window has its graphs back from the core before it has
	// opened anything, so both left the landing screen covering a loaded project with both panes
	// hidden.
	let empty = $derived(graphs.empty);

	// **First, and its own effect**, because everything below it can fail: an error thrown while the
	// application is still starting is the one a user can least describe, and it is worth catching
	// even if half the window never appears (S6.8). The teardown matters - a reload that left the
	// previous handlers attached would report every problem twice.
	$effect(() => {
		const stop = watchForProblems();
		// What the core already holds: a panic from the previous window, anything it warned about
		// during start-up, and whatever this window reported before it was reloaded.
		void refreshProblems();
		return stop;
	});

	$effect(() => {
		// Before anything else asks for work: a job started by the previous window - a conversion
		// still running across a reload - has to appear in the bar, not only the ones this session
		// starts.
		void connectJobs();
		void composition.load();
		void layout.load();
		void vplOperations().then((loaded) => (operations = loaded));
		// The style survives a reload the way the graphs do - the core owns it ([Q36]).
		void styleRecipe.load();
		// Once, and before any source is added: a tile URL handed to MapLibre before its scheme is
		// registered is a tile MapLibre does not know how to fetch (S2.16).
		registerTileProtocol();
		void importKinds().then((loaded) => (kinds = loaded));
		void graphs.refresh().then(async () => {
			if (graphs.first) document.show(await getGraph(graphs.first.id));
			// The graph came back from the core; the containers it reads did not. Every other path
			// that sets a pipeline syncs them - `applyDocument` and `load` - and this one was
			// missing it, so after a reload the inspector had nothing to show about a container the
			// pipeline was plainly using (A6, A4).
			await syncContainersToPipeline();
			await graphs.mountAll();
		});
		void exporting.loadFormats();
	});

	// The background map is rebuilt whenever it is chosen, which cannot be a derivation - see
	// `composition.follow`.
	composition.follow();

	// Applied locally first so a collapse paints without waiting on the round trip, then persisted.
	// The core clamps, so what comes back is authoritative and replaces the optimistic copy.
	/// Writes text into the current graph, creating one if this is the first thing opened.
	///
	/// The single place that decides *which* graph an edit lands in, which is what lets every call
	/// site stay unaware that there is more than one ([Q32]).
	///
	/// **The name it creates with is a placeholder.** `add` sanitises and makes it unique, so
	/// opening three files in a row yields `graph`, `graph-2`, `graph-3` - and under [Q32] that
	/// name is the server mount, the `style.json` source and the `.vpl` filename at once, so it is
	/// the wrong name in three places rather than one. The callers know what they opened; this
	/// signature does not carry it yet.
	async function setPipelineText(text: string, kind: EditKind = 'structured', source: string | null = null) {
		if (currentGraph === null) {
			const created = await addGraph(source, text);
			await graphs.refresh();
			return created;
		}
		return await setGraph(currentGraph, text, kind);
	}

	/// Starts a graph on a read node, with nothing filled in yet.
	///
	/// **`addGraph` rather than `setPipelineText`**, which writes into the graph on screen whenever
	/// there is one - the door says "new graph", so it makes one whether or not something is open.
	///
	/// It arrives incomplete on purpose. `from_container` with no `filename` is a node whose form
	/// says what is missing and whose path field has a picker beside it (C2, C4) - which is the
	/// same two steps the cards took, in the order that lets the second one be reconsidered.
	async function newGraph(operation: string) {
		try {
			await applyDocument(await addGraph(null, operation));
		} catch (e) {
			status.fail(e);
		}
	}

	/// Shows another graph's chain. The pin does not move: the map is a separate question ([Q32]).
	async function selectGraph(id: number) {
		const found = await getGraph(id);
		if (!found) return;
		document.show(found);
	}

	/// Renames a graph. Refused by the core when the name is taken, and the reason is worth seeing -
	/// the name is the mount, the style's source name and the `.vpl` filename at once.
	async function rename(id: number, name: string) {
		try {
			await graphs.rename(id, name);
			if (id === currentGraph) document.update(await getGraph(id));
			await refreshPreview();
		} catch (e) {
			status.fail(e);
		}
	}

	// -- the crop ------------------------------------------------------------------------------

	/// What the current graph is narrowed to (F2, S5.2, S5.4).
	///
	/// **Read from the graph list rather than kept beside it.** The crop lives on the graph in the
	/// core, which is what makes it survive a reload and land in the project manifest; a copy here
	/// would be a second answer to the same question.
	const crop = $derived<Bounds>(
		graphs.list.find((graph) => graph.id === currentGraph)?.crop ?? { bbox: null, minZoom: null, maxZoom: null }
	);

	/// Whether a drag on the map draws a rectangle. Local: a mode you are halfway through is not
	/// worth restoring after a reload, and leaving the app in it would be a trap.
	let drawing = $state(false);

	async function changeCrop(next: Bounds) {
		if (!document.current) return;
		try {
			await setCrop(document.current.graph, next);
			await graphs.refresh();
		} catch (e) {
			status.fail(e);
		}
	}

	/// Crops to what the map is showing, keeping the zoom range alone - the two are separate
	/// decisions, and someone who set 4-12 did not mean to lose it by framing a city.
	function cropToView() {
		if (!map) return;
		const bounds = map.getBounds();
		void changeCrop({
			bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
			minZoom: crop.minZoom,
			maxZoom: crop.maxZoom
		});
	}

	/// Removes a graph for good.
	///
	/// **Not undoable**, which the list says before doing it: the history restores text *into* a
	/// graph ([Q32]), so one that is gone has nothing to restore into and the core reports the step
	/// as a no-op. Everything else about the removal is the core's - it unmounts the graph so the
	/// style stops resolving a source that no longer exists, and clears the pin if it pointed here -
	/// so what is left for the webview is deciding what to look at next.
	async function removeGraphById(id: number) {
		try {
			const next = await graphs.remove(id);
			// Show the first remaining graph, or nothing at all when that was the last one.
			if (id === currentGraph) document.show(next === null ? null : ((await getGraph(next)) ?? null));

			if (document.current) {
				await refreshPreview();
			} else {
				// `refresh` returns early with no graph, so the layer it drew would outlive the graph
				// it came from - a map still showing tiles from a document that is gone.
				preview.clear(map);
			}
		} catch (e) {
			status.fail(e);
		}
	}

	/// Switches one node of the graph on screen on or off ([Q49]).
	///
	/// **The head node's eye is the graph's**, because a chain that reads nothing is not a chain -
	/// so it goes to the same switch the row in the list uses rather than to a second one that
	/// would have to be kept in step with it.
	///
	/// Refused by the core for the last source a composite has, and the message says which node
	/// needs one.
	async function toggleNode(path: number[], enabled: boolean) {
		if (currentGraph === null) return;
		try {
			if (path.length === 1 && path[0] === 0) await toggleGraph(currentGraph, enabled);
			else {
				await graphs.setNodeEnabled(currentGraph, path, enabled);
				await refreshPreview();
			}
		} catch (e) {
			status.fail(e);
		}
	}

	/// Switches a whole graph on or off - the eye on its row ([Q49]).
	///
	/// Durable, so a source somebody switched off is still off when the project is reopened. The
	/// map follows because the stack is drawn from what is built, and an off graph is not built.
	async function toggleGraph(id: number, enabled: boolean) {
		try {
			await graphs.setEnabled(id, enabled);
			await refreshPreview();
		} catch (e) {
			status.fail(e);
		}
	}

	/// Opens a project directory, replacing what is open - a window is one project ([Q16]).
	async function openProjectDir() {
		await adopt(() => project.open());
	}

	/// What a window does once a project directory has been read, however it was chosen.
	///
	/// Shared by the menu, which asks for the directory, and by a path handed to this window by the
	/// launcher - the two have to end in the same state, and the second used to end in an error.
	async function adopt(read: () => Promise<Recipe | null>) {
		try {
			const recipe = await read();
			if (!recipe) return;
			styleRecipe.restored(recipe);
			await graphs.refresh();
			if (graphs.first) document.show(await getGraph(graphs.first.id));
			await syncContainersToPipeline();
			// Every graph, not just the one that opens - a style names them all (S6.5), and this is
			// the moment a person is already waiting.
			await graphs.mountAll();
			await refreshPreview();
			status.settle();
		} catch (e) {
			status.fail(e);
		}
	}

	/// Moves a run of the stack, which is the whole of reordering ([the layer stack](docs/layers.md)).
	///
	/// **The segments are derived from the result, not edited towards it.** `move` produces the rows
	/// in their new order and `segmentsFrom` reads the runs back off them, so the boundaries are
	/// ascending by construction and there is no second place the invariant could be broken.
	async function reorderStack(range: [number, number], at: number) {
		const next = segmentsFrom(move(composition.rows, range, at));
		await styleRecipe.setSegments(next);
	}

	/// Returns the camera to what is currently open.
	///
	/// **The only thing that reframes the map after the first preview**, now that a rebuild leaves
	/// the camera alone. Animated, because someone asked for it and should see where they went.
	function resetView() {
		const bbox = currentBuild?.info.bbox;
		if (map && bbox) fitToBounds(map, bbox, true);
	}

	/// Everything that reaches this window from outside it - see `window-events.svelte.ts`.
	windowEvents.listen({
		open: () => void pick(),
		openProject: () => void openProjectDir(),
		saveProject: () => void project.save(() => composition.text()),
		saveProjectAs: () => void project.saveAs(() => composition.text()),
		saveCopy: () => void project.showCopy(),
		showAssets: () => (assets = true),
		showUpdates: () => (updating = true),
		showProblems: () => panels.show('problems'),
		reportProblem: () => void reportProblem('this').catch((error: unknown) => status.fail(error)),
		// **A project folder is not a file to import** (S7.5). The launcher hands one over the same
		// queue a double-clicked container arrives on, and everything here used to go to `load`, which
		// asks the catalogue for a read node and gets none for a directory.
		openPath: async (path) => {
			if (await isProject(path).catch(() => false)) await adopt(() => project.at(path));
			else await load(path);
		},
		accepts: (path) => accepted.some((ext) => path.toLowerCase().endsWith(`.${ext}`)),
		stepHistory: (back) => void stepHistory(back),
		title: () => {
			const newest = preview.containers.at(-1)?.info.source;
			return newest ? (newest.split(/[/\\]/).pop() ?? newest) : null;
		}
	});

	/// Opens the file dialog, narrowed to one import kind when the caller knows which.
	///
	/// Two callers, and they know different amounts: File → Open takes anything Studio can read,
	/// while "from VPL file…" is asking for a `.vpl` and says so. Whatever comes back goes to
	/// `load`, which asks the core what the file is rather than trusting which door it came
	/// through.
	///
	/// The filters live in `common/import.ts` because the launcher offers the same ones from a page
	/// that cannot reach this function - two copies of "what Studio can open" is the shape of bug
	/// where a launcher offers a format the workbench then refuses (S7.5).
	async function pick(kind?: ImportKind) {
		const picked = await askForSource(kinds, kind);
		if (picked) await load(picked);
	}

	/// Builds the preview and says in the bar what came of it.
	///
	/// The rule itself is `preview.refresh` - this is the half that is about *this window*: the map
	/// it is bound to, and the one status bar the outcome has to be reported in.
	async function refreshPreview() {
		try {
			const done = await preview.refresh({
				map,
				pipeline: document.current,
				styled: () => composition.drawn,
				// A camera came back from the core, so this window is a reload rather than a first
				// open and already knows where it was looking.
				restored: layout.current?.view != null
			});
			switch (done.kind) {
				// A newer build owns the map and is still working; the bar is its to set, not ours.
				case 'superseded':
					return;
				// Nothing was built, so nothing later will clear an "Opening …" the caller set.
				case 'nothing':
					status.settle();
					return;
				case 'unrenderable':
					status.fail(done.message);
					return;
				case 'shown':
					status.settle();
					return;
				// No map or no graph: nothing happened, and whatever the bar says still stands.
				case 'unavailable':
					return;
			}
		} catch (e) {
			status.fail(e);
		}
	}

	/// Opens whatever the pipeline now reads, naming each one in the bar as it goes.
	async function syncContainersToPipeline() {
		if (!document.current) return;
		await preview.syncContainers(document.current, (source) => {
			status.busy(`Opening ${filename(source)}…`);
		});
	}

	// The map is created by an effect, so it can appear after a pipeline has already been loaded -
	// on a reload, the document comes back from the core before there is anything to draw it on.
	// `untrack` keeps this listening for the map alone; every other trigger calls in explicitly.
	$effect(() => {
		if (!map) return;
		untrack(() => {
			if (document.current) void refreshPreview();
		});
	});

	/// Applies a document the core has handed back - after an edit, an undo, or a reload.
	///
	/// Every path that changes the pipeline ends here, so the map, the editor and the selection can
	/// never be following different versions of it.
	async function applyDocument(next: DocumentView) {
		// A path taken from one graph does not name anything in another, and undo may hand back a
		// graph other than the one on screen ([Q32]). The selection goes with it, exactly as it does
		// when a graph is chosen from the list.
		document.show(next);
		// The list shows the name, the pin and the unsaved dot - the last of which changes on every
		// edit, so refreshing here rather than only when a graph is added or removed.
		await graphs.refresh();
		await syncContainersToPipeline();
		await refreshPreview();
	}

	/// Lays the current graph's VPL out again (S1.11).
	///
	/// `applyDocument` because the text changes from outside the editor, which is what bumps the
	/// revision the editor reloads on - without it the textarea would keep the old layout while the
	/// document had the new one.
	const formatPipeline = () => edit((doc) => formatGraph(doc.graph));

	/// Adds a transform after the node whose name occupies `span`.
	///
	/// It used to select what it added, so the new node's form was showing - every node shows one
	/// now, so the insertion is the whole of the work.
	const addOperation = (afterNameSpan: Span, operation: string) =>
		edit(async (doc) => setPipelineText(await vplInsertNode(doc.text, afterNameSpan, operation), 'structured'));

	/// Removes a node.
	///
	/// Dropped here rather than left to `applyDocument`, which keeps a selection whose path still
	/// resolves: removing the middle of a three-node chain leaves `[1]` naming whatever moved up
	/// into it, so the form would quietly re-open on a node nobody chose.
	const removeNode = (span: Span) =>
		edit(async (doc) => setPipelineText(await vplRemoveNode(doc.text, span), 'structured'));

	/// Writes the pipeline as a `.vpl`. Asks where when there is no file yet, or when asked to.
	///
	/// Saving a *project* is a different command with a different scope (G1, S5.1) - this is the
	/// pipeline as the file the CLI already reads.
	async function savePipeline(chooseFile: boolean) {
		if (!document.current) return;
		try {
			let target = chooseFile ? null : document.current.path;
			if (!target) {
				target = await save({
					title: 'Save pipeline',
					// The graph's name supplies the filename ([Q35]) - the direction the binding runs.
					// `pipeline.vpl` was a leftover from when a window held exactly one document, and
					// it offered the same name for every graph in a project that now holds several.
					defaultPath: document.current.path ?? `${document.current.name}.${pipelineExtensions[0]}`,
					filters: [{ name: 'VPL pipelines', extensions: pipelineExtensions }]
				});
				if (!target) return; // cancelled
			}
			document.update(await saveVpl(document.current.graph, target));
			status.busy(`Saved ${filename(target)}`);
			// The other half of the dot: saving is what clears it, and the list has to be told.
			await graphs.refresh();
			status.settle();
		} catch (e) {
			status.fail(e);
		}
	}

	/// ⌘Z walks one stack across the graphs *and* the style ([Q36], S4.7), so the step says which
	/// document it restored and this redraws that one. Undoing a style edit and undoing a pipeline
	/// edit are the same gesture on the same history; only what changes afterwards differs.
	async function stepHistory(back: boolean) {
		try {
			const next = await (back ? undoPipeline() : redoPipeline());
			if (!next) return;
			// Tested for a value rather than for the key: specta spells the union with `?: never` on
			// the absent side, so `'graph' in next` narrows the variant without narrowing the field.
			if (next.graph) await applyDocument(next.graph);
			else if (next.style) styleRecipe.restored(next.style);
		} catch (e) {
			status.fail(e);
		}
	}

	/// Opening a file *is* setting the pipeline to its read node (Q22, Q25). Opening a `.vpl` sets
	/// the pipeline to what the file says.
	///
	/// Which read node is the catalogue's answer, not a branch here: a container becomes
	/// `from_container`, a GeoJSON `from_geo`, a CSV `from_csv` (S3.2). A container is additionally
	/// *mounted*, because the inspector reads tiles from it directly (A4); the others have nothing
	/// to inspect until the pipeline has built them, which the preview does.
	async function load(source: string) {
		// A remote container reads its index over the network, so this is not always instant.
		status.busy(`Opening ${filename(source)}…`);
		try {
			// **What it is, not what it is called.** Three formats wear `.json`, so the kind comes
			// from reading the document when its name cannot settle it - and a TileJSON on disk is
			// refused with a sentence rather than opened as GeoJSON and failed three steps later.
			const opening = await importOpening(source);
			if (opening.refused !== null) {
				status.fail(opening.refused);
				return;
			}
			const kind = opening.kind;
			if (kind === null) {
				status.fail(`Studio has no way to open ${filename(source)}`);
				return;
			}

			if (kind.operation === null) {
				// The whole document arrives at once, and the containers it names are opened by
				// `applyDocument`'s sync - including relative ones, now resolved against the file.
				//
				// Through the funnel rather than assigning `pipeline` here: `open_vpl` creates the
				// graph in the core, and a webview that only took the document back was left with a
				// graph list that did not know about it. Everything downstream of "there is now a
				// graph" then behaved as though there were none - including the landing screen,
				// which stayed up over the pipeline it had just opened.
				await applyDocument(await openVpl(source));
			} else if (kind.id === 'container') {
				const result = await preview.mount(source);
				document.show(await setPipelineText(result.vpl, 'replaced', source));
			} else {
				const opened = await setPipelineText(await importReadNode(kind.id, source), 'replaced', source);
				document.show(opened);
				// Whether the node is complete is the *document's* answer, not the kind's. A CSV
				// whose header named its coordinate columns arrives with them already set (S3.4),
				// so asking the kind - which needs them for every CSV - would tell someone to fill
				// in fields that are filled in, and skip the preview that would have shown it
				// working. The form is showing whatever is still missing, and so is the diagnostic
				// beside it (C2, C4); this only says so where the eye already is.
				if (opened.diagnostics.length > 0) {
					status.fail(opened.diagnostics[0].message);
					return;
				}
			}
			await refreshPreview();
		} catch (e) {
			status.fail(e);
		}
	}

	const filename = (source: string) => source.split(/[/\\]/).pop() || source;
</script>

<!-- Declared out here and passed by reference, so an empty window can pass nothing at all. A
     snippet is always truthy once declared inline, which would leave the shell holding an empty
     column the width of a pane that has nothing in it. -->
<!-- One snippet for both sidebars, keyed by pane id (Q31). Shared rather than one per side,
     because which side a pane is on is data - a pane that moves must not need its markup moved
     with it. An id with no arm here renders nothing, which is how a pane can exist in the core
     before it exists in the webview. -->
{#snippet paneContent(id: string)}
	{#if id === 'sources'}
		<SourcesPane
			graphs={composition.stacked}
			current={currentGraph}
			{operations}
			actions={{
				select: (id) => void selectGraph(id),
				rename: (id, name) => void rename(id, name),
				remove: (id) => void removeGraphById(id),
				setEnabled: (id, enabled) => void toggleGraph(id, enabled),
				addNode: (operation) => void newGraph(operation),
				openFile: () => void pick(kinds.find((kind) => kind.id === 'pipeline'))
			}}
		/>
	{:else if id === 'pipeline'}
		<PipelinePane
			{kinds}
			{operations}
			graph={composition.stacked.find((entry) => entry.id === currentGraph) ?? null}
			pipeline={document.current}
			pipelineRevision={document.revision}
			properties={producedProperties}
			fits={currentBuild?.fits ?? []}
			{suggestions}
			crop={document.current ? { bounds: crop, drawing } : null}
			cropActions={{
				set: (bounds) => void changeCrop(bounds),
				draw: () => (drawing = !drawing),
				useView: cropToView
			}}
			nodeActions={{
				setEnabled: (path, enabled) => void toggleNode(path, enabled),
				addOperation: (afterNameSpan, operation) => void addOperation(afterNameSpan, operation),
				remove: (span) => void removeNode(span),
				commitValue: (span, value) => void editSelected((text) => vplSetValue(text, span, value)),
				removeProperty: (span) => void editSelected((text) => vplRemoveProperty(text, span)),
				setProperty: (nameSpan, key, values) => void editSelected((text) => vplSetProperty(text, nameSpan, key, values))
			}}
			documentActions={{
				change: (text) =>
					void setPipelineText(text, 'typing').then((next) => {
						// The graph list's unsaved dot reads `graphs`, not `pipeline`, so it only moves when
						// that list is refetched - and typing deliberately does not go through
						// `applyDocument`, which is what refetches it. Without this the Save button lit up
						// on the first keystroke while the dot beside the graph's name stayed clean.
						//
						// On the transition rather than on every keystroke: `dirty` flips once per save
						// cycle, so a round trip per character to be told nothing changed is a poor trade.
						const flipped = document.current?.dirty !== next.dirty;
						document.update(next);
						if (flipped) void graphs.refresh();
						void refreshPreview();
					}),
				undo: () => void stepHistory(true),
				redo: () => void stepHistory(false),
				format: () => void formatPipeline(),
				save: (chooseFile) => void savePipeline(chooseFile),
				export: () => void exporting.show(currentGraph)
			}}
		/>
	{:else if id === 'style'}
		<StylePane
			rendered={composition.style}
			basis={composition.edited?.basis ?? 'none'}
			own={composition.edited?.style ?? null}
			source={currentBuild
				? {
						tileFormat: currentBuild.info.tileFormat,
						tileSchema: currentBuild.info.tileSchema,
						layers: declaredLayers(currentBuild.info)
					}
				: null}
		/>
	{:else if id === 'layers'}
		<LayersPane
			rows={composition.rows}
			sources={composition.sources}
			actions={{
				setHidden: (graph, path, hidden) => void styleRecipe.setHidden(graph, path, hidden).then(refreshPreview),
				setOverride: (graph, layer, patch) => void styleRecipe.setLayerFor(graph, layer, patch),
				select: (graph) => void selectGraph(graph),
				reorder: (range, at) => void reorderStack(range, at)
			}}
		/>
	{:else if id === 'inspector'}
		<Inspector
			containers={preview.containers.map((c) => c.info)}
			result={currentBuild?.info ?? null}
			graph={composition.editedName}
		/>
	{/if}
{/snippet}

{#snippet leftPaneContent()}
	<Sidebar panes={layout.on('left')} onToggle={(id, open) => layout.toggle(id, open)} content={paneContent} />
{/snippet}

{#snippet rightPaneContent()}
	<Sidebar panes={layout.on('right')} onToggle={(id, open) => layout.toggle(id, open)} content={paneContent} />
{/snippet}

<AppShell
	leftPane={layout.current ? leftPaneContent : undefined}
	leftWidth={layout.current?.leftWidth}
	onLeftResize={(width, done) => layout.resize('left', width, done)}
	rightWidth={layout.current?.rightWidth}
	onRightResize={(width, done) => layout.resize('right', width, done)}
	rightPane={rightPaneContent}
>
	{#snippet mapPane()}
		<!-- The map inside a boundary of its own, for the same reason the panes are: a style or a
		     container it cannot make sense of should not take the editor and the status bar with it,
		     which is the one place that could then say what happened. -->
		<Boundary label="The map">
			{#if composition.style}
				<MapCanvas
					style={composition.style}
					bind:map
					initialView={layout.current?.view ?? null}
					onMove={(view) => {
						mapZoom = view.zoom;
						layout.rememberView(view);
					}}
					onStyleLoad={() => preview.restore(map, composition.drawn)}
				/>
			{/if}
			<!-- `mount` is what the click is allowed to hit: Studio's own tiles, never the background. -->
			<FeaturePopup
				{map}
				{drawing}
				source={preview.containers.at(-1)?.info.source ?? null}
				mount={composition.editedName}
			/>
			<TileGrid {map} visible={showGrid} level={gridLevel} />
			<!-- Always mounted: it draws nothing until tiles have been pending for a second (S2.16), so it
		     has no visibility of its own to toggle. -->
			<TileActivity {map} />
			<!-- Always mounted: with no crop it draws nothing, and drawing mode is a prop rather than a
		     mount, so leaving it does not have to tear down the rectangle it just made. -->
			<!-- **One rectangle on the map, whoever is asking for it** ([Q53]). The crop sets it, and so
			     does a `bbox=` in a node's form - the same overlay either way, because two dimmed
			     rectangles at once are two crops as far as the eye is concerned. A field that has taken
			     the map displaces the crop while it holds it, and gives it back on blur. -->
			<CropOverlay
				{map}
				bbox={bboxField.shown ?? crop.bbox ?? null}
				drawing={bboxField.drawing || drawing}
				onDrawn={(bbox) => {
					if (bboxField.drawing) {
						bboxField.finish(bbox);
						return;
					}
					drawing = false;
					void changeCrop({ bbox, minZoom: crop.minZoom ?? null, maxZoom: crop.maxZoom ?? null });
				}}
			/>
			{#if empty}
				<!-- **Quiet, and not a launcher** (S7.9, [Q48]). The launcher is a window now; putting
				     one inside a window that is already a project is what made a project window two
				     different things depending on its contents. This is a window between documents -
				     it says where the way in is and gets out of the way.
				
				     It no longer takes the panes with it ([Q54]): the door it points at is not the only
				     one, and the other is `＋ new graph…` in the Sources pane - which this used to
				     hide, for exactly as long as there was nothing to list. -->
				<p class="nothing">
					Nothing is open. <strong>File → Open…</strong> brings a container, a pipeline or a table into this window.
				</p>
			{/if}
			<!-- **One stack, top left** ([Q52]). The three of these used to place themselves in three
			     different corners, which meant the map's own controls had to be read as three
			     unrelated things and each one had to know where the others were not. Down one edge
			     they are one list, and adding a fourth is a line here rather than a free corner to
			     find. Left over the right, which is where the attribution and MapLibre's own
			     controls sit.
			
			     Shown with nothing open too ([Q54]): they are about looking at the map, and a map with
			     only a basemap on it is still a map somebody may want to move around. -->
			<div class="map-controls">
				<MapControls
					background={layout.background}
					{showGrid}
					{gridLevel}
					gridNudged={gridOffset !== 0}
					canReset={Boolean(currentBuild?.info.bbox)}
					onBackground={(id) => layout.current && void layout.change({ ...layout.current, background: id })}
					onToggleGrid={() => (showGrid = !showGrid)}
					onGridLevel={(by) => (gridOffset = by === 0 ? 0 : gridOffset + by)}
					onReset={resetView}
				>
					{#snippet views()}<Views {map} />{/snippet}
					{#snippet jump()}<CoordinateJump {map} />{/snippet}
				</MapControls>
			</div>
		</Boundary>
	{/snippet}
	{#snippet statusBar()}
		<StatusBar status={status.current} onDismiss={() => status.dismiss()} />
	{/snippet}
</AppShell>

<!-- Outside the shell on purpose: the sidebars scroll and clip, and this has to sit over the
     map beside them ([Q33]). -->
{#if exporting.open && document.current}
	<ExportDialog
		name={document.current.name}
		formats={exporting.formats}
		{crop}
		onEstimate={() => exporting.estimate(currentGraph, crop)}
		onCancel={() => exporting.close()}
		produces={exporting.producing}
		onExport={() => void exporting.start(currentGraph, document.current?.name ?? '', crop)}
	/>
{/if}

{#if project.copying}
	<CopyDialog
		plan={project.copying}
		onCancel={() => project.cancelCopy()}
		onWrite={(zip) => void project.writeCopy(zip, () => composition.text())}
	/>
{/if}

<!-- Outside the map region, like every other modal: the map keeps running behind it rather than
     being torn down, so coming back from installing a font returns to the view you left. -->
{#if updating}
	<UpdateDialog onClose={() => (updating = false)} />
{/if}

{#if assets}
	<AssetsDialog onClose={() => (assets = false)} />
{/if}

<!-- Outside the shell, like the modals: it belongs to the window rather than to a cell of the grid. -->
<AlphaRibbon />

<Help />

<style>
	/* Everything the map is controlled by, down its top left edge ([Q52]).
	   
	   `align-items: flex-start` rather than a width: each control is as wide as what it says, so the
	   stack is a list of separate things rather than a panel - and the map stays visible beside the
	   short ones.
	   
	   No `overflow` of its own, deliberately: the saved-views panel opens *out* of this box, and a
	   scroll container would clip it on both axes rather than let it hang over the map. The stack is
	   a handful of rows, so there is nothing to scroll. */
	.map-controls {
		position: absolute;
		top: var(--space-4);
		left: var(--space-4);
		/* Over the feature popup, which sits at 5. These are the map's chrome and the popup is its
		   content: a panel opening behind the thing it was opened from is never what was meant. */
		z-index: 6;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
	}

	/* A window between documents. Over the map rather than replacing it - the map keeps running, so
	   opening something does not have to build one - and small enough to read as a note rather than
	   as a screen (S7.9). */
	.nothing {
		position: absolute;
		inset: auto 0 0;
		margin: 0;
		padding: var(--space-4) var(--space-5);
		z-index: 6;
		font-size: var(--text-sm);
		color: var(--ink-2);
		text-align: center;

		strong {
			color: var(--ink);
			font-weight: 500;
			white-space: nowrap;
		}
	}
</style>
