<script lang="ts">
	import { open, save } from '@tauri-apps/plugin-dialog';
	import { untrack } from 'svelte';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { listen } from '@tauri-apps/api/event';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import type { Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';
	import AppShell from './lib/shell/AppShell.svelte';
	import StatusBar, { type Status } from './lib/shell/StatusBar.svelte';
	import Help from './lib/common/Help.svelte';
	import { connectJobs } from './lib/state/jobs.svelte';
	// Named for what it is, because `style` in this file is already the rendered MapLibre style.
	import { style as styleRecipe } from './lib/state/style.svelte';
	import { registerTileProtocol } from './lib/state/tiles.svelte';
	import { preview } from './lib/state/preview.svelte';
	import Inspector from './lib/panes/inspector/Inspector.svelte';
	import LandingScreen from './lib/common/LandingScreen.svelte';
	import Sidebar from './lib/shell/Sidebar.svelte';
	import PipelinePane from './lib/panes/pipeline/PipelinePane.svelte';
	import StylePane from './lib/panes/style/StylePane.svelte';
	import AppBar from './lib/shell/AppBar.svelte';
	import AssetsDialog from './lib/shell/AssetsDialog.svelte';
	import ExportDialog from './lib/panes/pipeline/ExportDialog.svelte';
	import CopyDialog from './lib/panes/project/CopyDialog.svelte';
	import { samePath } from './lib/vpl/node-at';
	import MapCanvas from './lib/map/MapCanvas.svelte';
	import FeaturePopup from './lib/map/FeaturePopup.svelte';
	import TileGrid from './lib/map/TileGrid.svelte';
	import TileActivity from './lib/map/TileActivity.svelte';
	import CropOverlay from './lib/map/CropOverlay.svelte';
	import MapControls from './lib/map/MapControls.svelte';
	import { buildBackground, isBackgroundId, type BackgroundId } from './lib/map/background';
	import CoordinateJump from './lib/map/CoordinateJump.svelte';
	import Views from './lib/map/Views.svelte';
	import { defaultStyle } from './lib/map/default-style';
	import { fitToBounds } from './lib/map/add-source';
	import { deriveStyle, drawsAnything, renderStyle } from './lib/map/style';
	import { forExport } from './lib/map/style-code';
	import {
		forgetRecent,
		takeOpened,
		OPENED_EVENT,
		getLayout,
		listGraphs,
		setPin,
		getPinned,
		removeGraph,
		exportGraph,
		estimateExport,
		setCrop,
		writableFormats,
		renameGraph,
		addGraph,
		setGraph,
		formatGraph,
		undo as undoPipeline,
		openVpl,
		saveVpl,
		redo as redoPipeline,
		recentSources,
		serverBaseUrl,
		setLayout,
		saveProject,
		openProject,
		isProject,
		copyPlan,
		saveProjectCopy,
		vplRemoveProperty,
		vplInsertNode,
		vplRemoveNode,
		vplSetValue,
		vplSetProperty,
		vplOperations,
		getGraph,
		mountGraph,
		type DocumentView,
		type Bounds,
		type Estimate,
		type Preview,
		type CopyPlan,
		type Camera,
		type Layout,
		type OperationInfo,
		type Span,
		importKinds,
		importKindFor,
		importReadNode,
		fieldSuggestions,
		type EditKind,
		type GraphInfo,
		type ImportKind,
		type RecentEntry
	} from './lib/ipc/commands';

	/// Every way in this build has (S3.2). Build-time information about the binary, so it is fetched
	/// once — and it is fetched rather than written here, because the dialog, the drop target and
	/// the cards had each carried their own copy of the same list and had already fallen out of
	/// step: none of them knew about `from_geo`, which the binary has had all along.
	let kinds = $state<ImportKind[]>([]);

	/// Extensions the window accepts at all, for the dialog's catch-all filter and for drop.
	const anyExtension = $derived(kinds.flatMap((kind) => kind.extensions));

	/// What Save writes. Taken from the same catalogue as the open side, so the extension a
	/// pipeline is saved with is by construction one that can be opened again.
	const pipelineExtensions = $derived(kinds.find((kind) => kind.id === 'pipeline')?.extensions ?? ['vpl']);

	let style = $state<StyleSpecification | null>(null);
	let map = $state<MaplibreMap | undefined>();
	let layout = $state<Layout | null>(null);
	/** This window's pipeline. The core owns it (Q25); this is a copy to render. */
	/// The graph being edited. One document at a time on screen; the project holds several (Q32),
	/// and the graph list that lets you switch between them is S2.13.
	let pipeline = $state<DocumentView | null>(null);
	/// Which graph `pipeline` is. Every command that touches a document takes it.
	const currentGraph = $derived(pipeline?.graph ?? null);
	/// Every graph in the project, for the list at the top of the Pipeline pane ([Q32]).
	let graphs = $state<GraphInfo[]>([]);
	/// Where the map is looking. **Not the selection** — you can edit one node while watching
	/// another, in another graph ([Q32]). `null` is the ordinary state: the map shows every graph.
	let pinned = $state<{ graph: number; path: number[] } | null>(null);
	/** Bumped when the pipeline changes from somewhere other than the editor, so the editor knows
	 *  to reload rather than being fought over its own buffer. */
	let pipelineRevision = $state(0);
	/** Build-time information about the binary, so it is fetched once and never refreshed. */
	let operations = $state<OperationInfo[]>([]);

	/// Editing a parameter rewrites the document through the core, which owns
	/// the quoting and refuses anything that would not parse.
	async function editSelected(run: (text: string) => Promise<string>) {
		if (!pipeline) return;
		try {
			await applyDocument(await setPipelineText(await run(pipeline.text), 'structured'));
		} catch (e) {
			fail(typeof e === 'object' && e && 'message' in e ? (e as { message: unknown }).message : e);
		}
	}
	// What the application is doing, shown along the bottom (Q24). Errors live here too — an error
	// is a state the application is in, and covering the map to say so was never a good trade.
	let status = $state<Status>({ kind: 'idle' });
	let showGrid = $state(false);

	/// What each node's fields could be set to, by the node's path (S3.4).
	///
	/// **Per node, because every node is a form.** This used to be one node's answer, fetched for
	/// whichever was selected — which was right while only the selected node had fields to fill in,
	/// and became "one file's columns offered for another file's node" the moment they all did.
	///
	/// Refetched whenever the document changes: the answer depends on each node's `filename`.
	let suggestions = $state<Record<string, Record<string, string[]>>>({});
	$effect(() => {
		// Depend on the text too — editing `filename` changes which file is being asked about.
		void pipeline?.text;
		const graph = pipeline?.graph;
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
		...new Set((preview.last?.layers ?? []).flatMap((layer) => layer.propertyKeys))
	]);
	let serverUrl = $state<string | null>(null);

	/** A value from an older build is not trusted — the catalogue decides what exists. */
	const background = $derived<BackgroundId>(isBackgroundId(layout?.background) ? layout.background : 'none');

	/// Which surface is open (Q22, S4.1). Core-owned, so a reloaded window comes back to it.
	///
	/// A value this build does not know falls back to the map — the same rule `background` follows,
	/// and for the same reason: an old layout file must not be able to open a blank window.
	/// Whether the fonts dialog is up. Local, not durable: a window is never restored onto a dialog
	/// ([Q39]).
	let assets = $state(false);
	let recents = $state<RecentEntry[]>([]);

	// The landing screen is what an *empty* window shows — it goes away for good once something is
	// open, and never gates anything (Q13).
	//
	// **A graph is what "something is open" means** ([Q32]). This asked `containers.length === 0`
	// until now, which was right at S1.1 when a container was the only thing you could open — and
	// silently wrong afterwards. A CSV or GeoJSON import produces a `from_csv` / `from_geo` node and
	// no container at all, and a reloaded window has its graphs back from the core before it has
	// opened anything, so both left the landing screen covering a loaded project with both panes
	// hidden.
	let empty = $derived(graphs.length === 0);

	$effect(() => {
		// Before anything else asks for work: a job started by the previous window — a conversion
		// still running across a reload — has to appear in the bar, not only the ones this session
		// starts.
		void connectJobs();
		void refreshRecents();
		void getLayout().then((loaded) => (layout = loaded));
		void vplOperations().then((loaded) => (operations = loaded));
		// The style survives a reload the way the graphs do — the core owns it ([Q36]).
		void styleRecipe.load();
		// Once, and before any source is added: a tile URL handed to MapLibre before its scheme is
		// registered is a tile MapLibre does not know how to fetch (S2.16).
		registerTileProtocol();
		void importKinds().then((loaded) => (kinds = loaded));
		void refreshGraphs().then(async () => {
			if (graphs.length > 0) pipeline = await getGraph(graphs[0].id);
			pipelineRevision += 1;
			// The graph came back from the core; the containers it reads did not. Every other path
			// that sets a pipeline syncs them — `applyDocument` and `load` — and this one was
			// missing it, so after a reload the inspector had nothing to show about a container the
			// pipeline was plainly using (A6, A4).
			await syncContainersToPipeline();
		});
		void getPinned().then((found) => (pinned = found));
		void writableFormats().then((loaded) => (formats = loaded));
	});

	// ⌘Z / ⇧⌘Z reach the document from anywhere, because there is one stack for every view (G6).
	//
	// A focused `<input>` or `<select>` keeps its own undo: the user is mid-edit in a parameter
	// field and has not committed anything yet, so the document has nothing to step back to. The VPL
	// textarea is deliberately *not* excluded — its text is the document, and letting the browser
	// undo it locally would leave the two disagreeing until the next keystroke.
	$effect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey)) return;
			const key = event.key.toLowerCase();
			const tag = (event.target as HTMLElement | null)?.tagName;
			if (key === 's') {
				event.preventDefault();
				void savePipeline(event.shiftKey);
				return;
			}
			if (key !== 'z' || tag === 'INPUT' || tag === 'SELECT') return;
			event.preventDefault();
			void stepHistory(!event.shiftKey);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	// The window title says which container this window holds — the native equivalent of the in-app
	// strip that used to repeat the application name back at the OS title bar. One window per
	// project (Q16), so the window is the right place to name it.
	$effect(() => {
		const newest = preview.containers.at(-1)?.info.source;
		const name = newest ? (newest.split(/[/\\]/).pop() ?? newest) : null;
		void getCurrentWindow().setTitle(name ? `${name} — VersaTiles Studio` : 'VersaTiles Studio');
	});

	// A drag repaints on every pointer move but only writes on release — otherwise a single resize
	// would be a few hundred file writes.
	function resizePane(side: 'left' | 'right', width: number, done: boolean) {
		if (!layout) return;
		const next = side === 'left' ? { ...layout, leftWidth: width } : { ...layout, rightWidth: width };
		if (done) void changeLayout(next);
		else layout = next;
	}

	// Applied locally first so a collapse paints without waiting on the round trip, then persisted.
	// The core clamps, so what comes back is authoritative and replaces the optimistic copy.
	/// Writes text into the current graph, creating one if this is the first thing opened.
	///
	/// The single place that decides *which* graph an edit lands in, which is what lets every call
	/// site stay unaware that there is more than one ([Q32]).
	///
	/// **The name it creates with is a placeholder.** `add` sanitises and makes it unique, so
	/// opening three files in a row yields `graph`, `graph-2`, `graph-3` — and under [Q32] that
	/// name is the server mount, the `style.json` source and the `.vpl` filename at once, so it is
	/// the wrong name in three places rather than one. The callers know what they opened; this
	/// signature does not carry it yet.
	async function setPipelineText(text: string, kind: EditKind = 'structured', source: string | null = null) {
		if (currentGraph === null) {
			const created = await addGraph(source, text);
			await refreshGraphs();
			return created;
		}
		return await setGraph(currentGraph, text, kind);
	}

	/// Shows another graph's chain. The pin does not move: the map is a separate question ([Q32]).
	async function selectGraph(id: number) {
		const found = await getGraph(id);
		if (!found) return;
		pipeline = found;
		pipelineRevision += 1;
	}

	/// Renames a graph. Refused by the core when the name is taken, and the reason is worth seeing —
	/// the name is the mount, the style's source name and the `.vpl` filename at once.
	async function rename(id: number, name: string) {
		try {
			await renameGraph(id, name);
			await refreshGraphs();
			if (id === currentGraph) pipeline = await getGraph(id);
			await refreshPreview();
		} catch (e) {
			fail(e);
		}
	}

	// -- the crop ------------------------------------------------------------------------------

	/// What the current graph is narrowed to (F2, S5.2, S5.4).
	///
	/// **Read from the graph list rather than kept beside it.** The crop lives on the graph in the
	/// core, which is what makes it survive a reload and land in the project manifest; a copy here
	/// would be a second answer to the same question.
	const crop = $derived<Bounds>(
		graphs.find((graph) => graph.id === currentGraph)?.crop ?? { bbox: null, minZoom: null, maxZoom: null }
	);

	/// Whether a drag on the map draws a rectangle. Local: a mode you are halfway through is not
	/// worth restoring after a reload, and leaving the app in it would be a trap.
	let drawing = $state(false);

	async function changeCrop(next: Bounds) {
		if (!pipeline) return;
		try {
			await setCrop(pipeline.graph, next);
			await refreshGraphs();
		} catch (e) {
			fail(e);
		}
	}

	/// Crops to what the map is showing, keeping the zoom range alone — the two are separate
	/// decisions, and someone who set 4–12 did not mean to lose it by framing a city.
	function cropToView() {
		if (!map) return;
		const bounds = map.getBounds();
		void changeCrop({
			bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
			minZoom: crop.minZoom,
			maxZoom: crop.maxZoom
		});
	}

	/// Whether the export modal is up. For the graph being edited — exporting is per graph ([Q32]).
	let exporting = $state(false);

	/// What the graph turns out to produce, while the export dialog is open ([Q41]).
	///
	/// **Asked for by name, not taken from `preview.last`.** That one follows the pin ([Q32]), so
	/// with a node pinned it describes an intermediate step — and the export writes the graph
	/// regardless. Numbers about a different artefact, directly above the button that writes this
	/// one, would be worse than no numbers.
	///
	/// Fetched on opening rather than kept in step, like the copy plan: it is a function of the
	/// graph as it stands, and asking once, when someone is about to commit, cannot go stale.
	let producing = $state<Preview | null>(null);

	/// Runs the estimate the export dialog asks for.
	///
	/// A named function rather than a closure at the call site: the `{#if exporting && pipeline}`
	/// around the dialog narrows `pipeline` for the markup, not for a callback that runs later.
	function estimateForExport(): Promise<Estimate> {
		if (!pipeline) return Promise.reject(new Error('that graph is no longer open'));
		return estimateExport(pipeline.graph, crop);
	}

	async function showExport() {
		exporting = true;
		producing = null;
		if (!pipeline) return;
		// A build that fails is not a reason to refuse the dialog: what it must say is what will be
		// written and what that costs, and both come from elsewhere. This is confirmation.
		producing = await mountGraph(pipeline.graph).catch(() => null);
	}
	/// What Studio can write, for the modal's wording and the dialog's filters. Fetched once.
	let formats = $state<string[]>([]);

	/// Writes this graph to a container, as a job.
	///
	/// The crop is the pane's; this collects only the *destination*, because the extension chosen is
	/// what decides the format — asking for a format in a form and then letting the filename
	/// contradict it would be two answers to one question.
	///
	/// Returns once the job is submitted rather than once it is done: an export runs for minutes,
	/// and the bar is where it is watched and cancelled (E7).
	async function startExport() {
		if (!pipeline) return;
		exporting = false;
		try {
			const target = await save({
				title: `Export ${pipeline.name}`,
				defaultPath: `${pipeline.name}.${formats[0] ?? 'versatiles'}`,
				filters: [{ name: 'Tile containers', extensions: formats }]
			});
			if (!target) return; // cancelled
			// No `status` message: the job *is* the status. The bar prefers a running job over a
			// `status` line, so a message set here was invisible while the export ran and surfaced
			// only once it had stopped — the one moment it was no longer true.
			await exportGraph(pipeline.graph, target, crop);
		} catch (e) {
			fail(e);
		}
	}

	/// Removes a graph for good.
	///
	/// **Not undoable**, which the list says before doing it: the history restores text *into* a
	/// graph ([Q32]), so one that is gone has nothing to restore into and the core reports the step
	/// as a no-op. Everything else about the removal is the core's — it unmounts the graph so the
	/// style stops resolving a source that no longer exists, and clears the pin if it pointed here —
	/// so what is left for the webview is deciding what to look at next.
	async function removeGraphById(id: number) {
		try {
			await removeGraph(id);
			await refreshGraphs();
			// The core may have dropped the pin; ask rather than assume which way it went.
			pinned = await getPinned();

			if (id === currentGraph) {
				// Show the first remaining graph, or nothing at all when that was the last one.
				const next = graphs[0]?.id ?? null;
				pipeline = next === null ? null : ((await getGraph(next)) ?? null);
				pipelineRevision += 1;
			}

			if (pipeline) {
				await refreshPreview();
			} else {
				// `refresh` returns early with no graph, so the layer it drew would outlive the graph
				// it came from — a map still showing tiles from a document that is gone.
				preview.clear(map);
			}
		} catch (e) {
			fail(e);
		}
	}

	async function refreshGraphs() {
		graphs = await listGraphs().catch(() => []);
	}

	/// Moves the map to a node, or clears the pin when it is already there.
	///
	/// Clicking the pinned node again is what gets you back to seeing every graph — the same
	/// gesture off as on, because a separate "clear" would be a control that only exists sometimes.
	async function pin(path: number[]) {
		if (currentGraph === null) return;
		const same = pinned && pinned.graph === currentGraph && samePath(pinned.path, path);
		pinned = await setPin(same ? null : { graph: currentGraph, path });
		await refreshPreview();
	}

	/// Writes the project into a directory someone chooses (G1, S5.1).
	///
	/// The rendered style goes with it: the core holds the recipe, and `style.json` is for the tools
	/// that cannot render one ([Q36]).
	async function saveProjectAs() {
		try {
			const dir = await open({ directory: true, title: 'Save project into…' });
			if (typeof dir !== 'string') return;
			status = { kind: 'busy', message: 'Saving the project…' };
			await saveProject(dir, styled ? JSON.stringify(forExport(styled), null, '\t') : null);
			status = { kind: 'idle' };
		} catch (e) {
			fail(e);
		}
	}

	/// Opens a project directory, replacing what is open — a window is one project ([Q16]).
	async function openProjectDir() {
		try {
			const dir = await open({ directory: true, title: 'Open project' });
			if (typeof dir !== 'string') return;
			if (!(await isProject(dir))) {
				status = { kind: 'error', message: `${dir} holds no project.yaml` };
				return;
			}
			status = { kind: 'busy', message: 'Opening the project…' };
			styleRecipe.restored(await openProject(dir));
			await refreshGraphs();
			if (graphs.length > 0) pipeline = await getGraph(graphs[0].id);
			pipelineRevision += 1;
			await syncContainersToPipeline();
			await refreshPreview();
			status = { kind: 'idle' };
		} catch (e) {
			fail(e);
		}
	}

	/// What a copy would carry, while the dialog asking about it is open (S5.1).
	///
	/// Fetched on opening rather than kept in step, and the write plans again on the other side: what
	/// lands is what the project is then, rather than what it was when this dialog appeared.
	let copying = $state<CopyPlan | null>(null);

	async function showCopy() {
		try {
			copying = await copyPlan();
		} catch (e) {
			fail(e);
		}
	}

	/// Asks where, then writes it. A zip is one file and a folder is a directory, so the two take
	/// different pickers.
	async function writeCopy(zip: boolean) {
		copying = null;
		try {
			const target = zip
				? await save({
						title: 'Save a copy as',
						defaultPath: 'project.zip',
						filters: [{ name: 'Zip archive', extensions: ['zip'] }]
					})
				: await open({ directory: true, title: 'Save a copy into…' });
			if (typeof target !== 'string') return;
			status = { kind: 'busy', message: 'Copying the project…' };
			await saveProjectCopy(target, zip, styled ? JSON.stringify(forExport(styled), null, '\t') : null);
			status = { kind: 'idle' };
		} catch (e) {
			fail(e);
		}
	}

	async function changeLayout(next: Layout) {
		layout = next;
		layout = await setLayout(next).catch(() => next);
	}

	/**
	 * Remembers where the camera came to rest, so a reloaded window is looking where it was (Q16).
	 *
	 * Coalesced for the same reason a pane drag only writes on release: one scroll-zoom settles
	 * several times, and each would otherwise be its own atomic write. `layout` is read when the
	 * timer fires rather than when it is set, so a collapse in between is not undone.
	 */
	let viewTimer: ReturnType<typeof setTimeout> | undefined;
	function rememberView(view: Camera) {
		clearTimeout(viewTimer);
		viewTimer = setTimeout(() => {
			if (layout) void changeLayout({ ...layout, view });
		}, 400);
	}

	/// The panes belonging to one sidebar, in the order the layout remembers (Q31).
	///
	/// `panes` is optional in the generated type only because `Layout` carries serde's `default` for
	/// the file it is read from — a command always returns the reconciled list.
	const panesOn = (side: 'left' | 'right') => (layout?.panes ?? []).filter((pane) => pane.side === side);

	/// Folding a pane is durable state, so it goes to the core like the widths do (Q16).
	function togglePane(id: string, open: boolean) {
		if (!layout) return;
		void changeLayout({
			...layout,
			panes: layout.panes?.map((pane) => (pane.id === id ? { ...pane, open } : pane))
		});
	}

	/// Returns the bar to quiet, without swallowing anything it still has to say.
	///
	/// Only a `busy` message is cleared: an error is a state someone has to answer, and dropping it
	/// because unrelated work finished would hide the thing that needs answering.
	function settle() {
		if (status.kind === 'busy') status = { kind: 'idle' };
	}

	function fail(message: unknown) {
		status = { kind: 'error', message: String(message) };
	}

	async function refreshRecents() {
		recents = await recentSources().catch(() => []);
	}

	$effect(() => {
		serverBaseUrl()
			.then((url) => {
				serverUrl = url;
				style = defaultStyle(url);
			})
			.catch(fail);
	});

	/// The style the recipe describes, or `null` when it would draw nothing (S4.3).
	///
	/// **Null is a real answer, not a failure.** The six presets are written against Shortbread's
	/// layer names; a container that names its layers something else gets a background and no
	/// features, which reads as a broken map rather than as an unstyled one. Deriving a style from
	/// the layers a container actually has is S4.4 — until then the hairlines stay, and this says
	/// which of the two the map is showing.
	const styled = $derived.by(() => {
		const recipe = styleRecipe.current;
		const source = preview.last;
		if (!recipe || !source || !serverUrl) return null;
		const sources = [{ name: source.name, tileUrl: source.tileUrl }];

		// Built from what the tiles have rather than from what a schema expects (S4.4). The probe
		// already reports each layer's geometry, so nothing extra is read to draw them.
		if (recipe.preset === 'derived') return deriveStyle(source.layers, sources, serverUrl);

		const rendered = renderStyle(recipe, sources, serverUrl);
		return rendered && drawsAnything(rendered, preview.mountedLayers) ? rendered : null;
	});

	// **One owner for the map's style.** The recipe and the background both want to set it, and two
	// effects assigning it in whatever order they happen to run is how a map ends up showing the
	// wrong one after a reload. A styled recipe wins: a full basemap under it would be invisible,
	// and the background exists to give *unstyled* pipeline output something to sit on (G5).
	$effect(() => {
		const rendered = styled;
		const chosen = background;
		const url = serverUrl;
		if (!url) return;
		if (rendered) {
			style = rendered;
			return;
		}
		void untrack(async () => {
			try {
				style = (await buildBackground(chosen, url)) ?? defaultStyle(url);
			} catch (e) {
				fail(e);
			}
		});
	});

	/// Returns the camera to what is currently open.
	///
	/// **The only thing that reframes the map after the first preview**, now that a rebuild leaves
	/// the camera alone. Animated, because someone asked for it and should see where they went.
	function resetView() {
		const bbox = preview.last?.info.bbox;
		if (map && bbox) fitToBounds(map, bbox, true);
	}

	// A file double-clicked in Finder or passed on the command line. It can arrive before this
	// window exists, so the queue is drained on start as well as on the event — the event alone
	// would miss the launch case entirely.
	$effect(() => {
		void drainOpened();
		const unlisten = listen(OPENED_EVENT, () => void drainOpened());
		return () => void unlisten.then((stop) => stop());
	});

	async function drainOpened() {
		for (const path of await takeOpened().catch(() => [])) await load(path);
	}

	// Drag & drop is a shell affordance, so it goes through the same path as the file dialog.
	$effect(() => {
		const unlisten = getCurrentWebview().onDragDropEvent((event) => {
			if (event.payload.type !== 'drop') return;
			for (const path of event.payload.paths) {
				if (anyExtension.some((ext) => path.toLowerCase().endsWith(`.${ext}`))) void load(path);
			}
		});
		return () => void unlisten.then((f) => f());
	});

	/// Opens the file dialog, narrowed to one import kind when a card chose it.
	///
	/// A card's whole contribution is *saying what you are bringing in before you go looking for
	/// it*, so the dialog it opens shows that kind's files and nothing else. With no card — the
	/// keyboard route, or "+ Add source" before a choice — every kind is offered at once.
	async function pick(kind?: ImportKind) {
		const filters = kind
			? [{ name: kind.label, extensions: kind.extensions }]
			: [
					{ name: 'Everything Studio can open', extensions: anyExtension },
					...kinds.map((each) => ({ name: each.label, extensions: each.extensions }))
				];
		const picked = await open({ multiple: false, filters });
		if (typeof picked === 'string') await load(picked);
	}

	/// Builds the preview and says in the bar what came of it.
	///
	/// The rule itself is `preview.refresh` — this is the half that is about *this window*: the map
	/// it is bound to, and the one status bar the outcome has to be reported in.
	async function refreshPreview() {
		try {
			const done = await preview.refresh({ map, pipeline, pinned, styled: () => styled !== null });
			switch (done.kind) {
				// A newer build owns the map and is still working; the bar is its to set, not ours.
				case 'superseded':
					return;
				// Nothing was built, so nothing later will clear an "Opening …" the caller set.
				case 'nothing':
					settle();
					return;
				case 'unrenderable':
					status = { kind: 'error', message: done.message };
					return;
				case 'shown':
					status = { kind: 'idle' };
					return;
				// No map or no graph: nothing happened, and whatever the bar says still stands.
				case 'unavailable':
					return;
			}
		} catch (e) {
			fail(e);
		}
	}

	/// Opens whatever the pipeline now reads, naming each one in the bar as it goes.
	async function syncContainersToPipeline() {
		if (!pipeline) return;
		await preview.syncContainers(pipeline, (source) => {
			status = { kind: 'busy', message: `Opening ${filename(source)}…` };
		});
	}

	// The map is created by an effect, so it can appear after a pipeline has already been loaded —
	// on a reload, the document comes back from the core before there is anything to draw it on.
	// `untrack` keeps this listening for the map alone; every other trigger calls in explicitly.
	$effect(() => {
		if (!map) return;
		untrack(() => {
			if (pipeline) void refreshPreview();
		});
	});

	/// Applies a document the core has handed back — after an edit, an undo, or a reload.
	///
	/// Every path that changes the pipeline ends here, so the map, the editor and the selection can
	/// never be following different versions of it.
	async function applyDocument(next: DocumentView) {
		// A path taken from one graph does not name anything in another, and undo may hand back a
		// graph other than the one on screen ([Q32]). The selection goes with it, exactly as it does
		// when a graph is chosen from the list.
		pipeline = next;
		pipelineRevision += 1;
		// The list shows the name, the pin and the unsaved dot — the last of which changes on every
		// edit, so refreshing here rather than only when a graph is added or removed.
		await refreshGraphs();
		await syncContainersToPipeline();
		await refreshPreview();
	}

	/// Lays the current graph's VPL out again (S1.11).
	///
	/// `applyDocument` because the text changes from outside the editor, which is what bumps the
	/// revision the editor reloads on — without it the textarea would keep the old layout while the
	/// document had the new one.
	async function formatPipeline() {
		if (!pipeline) return;
		try {
			await applyDocument(await formatGraph(pipeline.graph));
		} catch (e) {
			fail(e);
		}
	}

	/// Adds a transform after the node whose name occupies `span`.
	///
	/// It used to select what it added, so the new node's form was showing — every node shows one
	/// now, so the insertion is the whole of the work.
	async function addOperation(afterNameSpan: Span, operation: string) {
		if (!pipeline) return;
		try {
			await applyDocument(
				await setPipelineText(await vplInsertNode(pipeline.text, afterNameSpan, operation), 'structured')
			);
		} catch (e) {
			fail(e);
		}
	}

	/// Removes a node.
	///
	/// Dropped here rather than left to `applyDocument`, which keeps a selection whose path still
	/// resolves: removing the middle of a three-node chain leaves `[1]` naming whatever moved up
	/// into it, so the form would quietly re-open on a node nobody chose.
	async function removeNode(span: Span) {
		if (!pipeline) return;
		try {
			const next = await setPipelineText(await vplRemoveNode(pipeline.text, span), 'structured');
			await applyDocument(next);
		} catch (e) {
			fail(e);
		}
	}

	/// Writes the pipeline as a `.vpl`. Asks where when there is no file yet, or when asked to.
	///
	/// Saving a *project* is a different command with a different scope (G1, S5.1) — this is the
	/// pipeline as the file the CLI already reads.
	async function savePipeline(chooseFile: boolean) {
		if (!pipeline) return;
		try {
			let target = chooseFile ? null : pipeline.path;
			if (!target) {
				target = await save({
					title: 'Save pipeline',
					// The graph's name supplies the filename ([Q35]) — the direction the binding runs.
					// `pipeline.vpl` was a leftover from when a window held exactly one document, and
					// it offered the same name for every graph in a project that now holds several.
					defaultPath: pipeline.path ?? `${pipeline.name}.${pipelineExtensions[0]}`,
					filters: [{ name: 'VPL pipelines', extensions: pipelineExtensions }]
				});
				if (!target) return; // cancelled
			}
			pipeline = await saveVpl(pipeline.graph, target);
			status = { kind: 'busy', message: `Saved ${filename(target)}` };
			// The other half of the dot: saving is what clears it, and the list has to be told.
			await refreshGraphs();
			await refreshRecents();
			status = { kind: 'idle' };
		} catch (e) {
			fail(e);
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
			fail(e);
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
		status = { kind: 'busy', message: `Opening ${filename(source)}…` };
		try {
			const kind = await importKindFor(source);
			if (kind === null) {
				status = { kind: 'error', message: `Studio has no way to open ${filename(source)}` };
				return;
			}

			if (kind.operation === null) {
				// The whole document arrives at once, and the containers it names are opened by
				// `applyDocument`'s sync — including relative ones, now resolved against the file.
				//
				// Through the funnel rather than assigning `pipeline` here: `open_vpl` creates the
				// graph in the core, and a webview that only took the document back was left with a
				// graph list that did not know about it. Everything downstream of "there is now a
				// graph" then behaved as though there were none — including the landing screen,
				// which stayed up over the pipeline it had just opened.
				await applyDocument(await openVpl(source));
			} else if (kind.id === 'container') {
				const result = await preview.mount(source);
				pipeline = await setPipelineText(result.vpl, 'replaced', source);
				pipelineRevision += 1;
			} else {
				pipeline = await setPipelineText(await importReadNode(kind.id, source), 'replaced', source);
				pipelineRevision += 1;
				// Whether the node is complete is the *document's* answer, not the kind's. A CSV
				// whose header named its coordinate columns arrives with them already set (S3.4),
				// so asking the kind — which needs them for every CSV — would tell someone to fill
				// in fields that are filled in, and skip the preview that would have shown it
				// working. The form is showing whatever is still missing, and so is the diagnostic
				// beside it (C2, C4); this only says so where the eye already is.
				if (pipeline.diagnostics.length > 0) {
					status = { kind: 'error', message: pipeline.diagnostics[0].message };
					await refreshRecents();
					return;
				}
			}
			await refreshRecents();
			await refreshPreview();
		} catch (e) {
			fail(e);
		}
	}

	const filename = (source: string) => source.split(/[/\\]/).pop() || source;
</script>

<!-- Declared out here and passed by reference, so an empty window can pass nothing at all. A
     snippet is always truthy once declared inline, which would leave the shell holding an empty
     column the width of a pane that has nothing in it. -->
<!-- One snippet for both sidebars, keyed by pane id (Q31). Shared rather than one per side,
     because which side a pane is on is data — a pane that moves must not need its markup moved
     with it. An id with no arm here renders nothing, which is how a pane can exist in the core
     before it exists in the webview. -->
{#snippet paneContent(id: string)}
	{#if id === 'pipeline'}
		<PipelinePane
			{kinds}
			{operations}
			{graphs}
			{pipeline}
			{pipelineRevision}
			properties={producedProperties}
			fits={preview.last?.fits ?? []}
			{suggestions}
			pinned={pinned && pinned.graph === currentGraph ? pinned.path : null}
			crop={pipeline ? { bounds: crop, drawing } : null}
			cropActions={{
				set: (bounds) => void changeCrop(bounds),
				draw: () => (drawing = !drawing),
				useView: cropToView
			}}
			graphActions={{
				select: (id) => void selectGraph(id),
				rename: (id, name) => void rename(id, name),
				remove: (id) => void removeGraphById(id),
				addSource: (kind) => void pick(kind)
			}}
			nodeActions={{
				pin: (path) => void pin(path),
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
						// that list is refetched — and typing deliberately does not go through
						// `applyDocument`, which is what refetches it. Without this the Save button lit up
						// on the first keystroke while the dot beside the graph's name stayed clean.
						//
						// On the transition rather than on every keystroke: `dirty` flips once per save
						// cycle, so a round trip per character to be told nothing changed is a poor trade.
						const flipped = pipeline?.dirty !== next.dirty;
						pipeline = next;
						if (flipped) void refreshGraphs();
						void refreshPreview();
					}),
				undo: () => void stepHistory(true),
				redo: () => void stepHistory(false),
				format: () => void formatPipeline(),
				save: (chooseFile) => void savePipeline(chooseFile),
				export: () => void showExport()
			}}
		/>
	{:else if id === 'style'}
		<StylePane rendered={styled} />
	{:else if id === 'inspector'}
		<Inspector containers={preview.containers.map((c) => c.info)} />
	{/if}
{/snippet}

{#snippet leftPaneContent()}
	<Sidebar panes={panesOn('left')} onToggle={togglePane} content={paneContent} />
{/snippet}

{#snippet rightPaneContent()}
	<Sidebar panes={panesOn('right')} onToggle={togglePane} content={paneContent} />
{/snippet}

<AppShell
	leftPane={empty || !layout ? undefined : leftPaneContent}
	leftWidth={layout?.leftWidth}
	onLeftResize={(width, done) => resizePane('left', width, done)}
	rightWidth={layout?.rightWidth}
	onRightResize={(width, done) => resizePane('right', width, done)}
	rightPane={empty ? undefined : rightPaneContent}
>
	{#snippet appBar()}
		<AppBar
			onOpenAssets={() => (assets = true)}
			onOpenProject={() => void openProjectDir()}
			onSaveProject={() => void saveProjectAs()}
			onSaveCopy={() => void showCopy()}
			hasProject={graphs.length > 0}
		/>
	{/snippet}
	{#snippet mapPane()}
		{#if style}
			<MapCanvas
				{style}
				bind:map
				initialView={layout?.view ?? null}
				onMove={rememberView}
				onStyleLoad={() => preview.restore(map, styled !== null)}
			/>
		{/if}
		<!-- `mount` is what the click is allowed to hit: Studio's own tiles, never the background. -->
		<FeaturePopup
			{map}
			{drawing}
			source={preview.containers.at(-1)?.info.source ?? null}
			mount={preview.last?.name ?? null}
		/>
		<TileGrid {map} visible={showGrid} />
		<!-- Always mounted: it draws nothing until tiles have been pending for a second (S2.16), so it
		     has no visibility of its own to toggle. -->
		<TileActivity {map} />
		<!-- Always mounted: with no crop it draws nothing, and drawing mode is a prop rather than a
		     mount, so leaving it does not have to tear down the rectangle it just made. -->
		<CropOverlay
			{map}
			bbox={crop.bbox ?? null}
			{drawing}
			onDrawn={(bbox) => {
				drawing = false;
				void changeCrop({ bbox, minZoom: crop.minZoom ?? null, maxZoom: crop.maxZoom ?? null });
			}}
		/>
		{#if empty}
			<LandingScreen
				{kinds}
				{recents}
				onImport={(kind) => void pick(kind)}
				onOpenUrl={(source) => void load(source)}
				onForget={async (source) => {
					await forgetRecent(source);
					await refreshRecents();
				}}
			/>
		{:else}
			<CoordinateJump {map} />
			<Views {map} />
			<MapControls
				{background}
				{showGrid}
				canReset={Boolean(preview.last?.info.bbox)}
				onBackground={(id) => layout && void changeLayout({ ...layout, background: id })}
				onToggleGrid={() => (showGrid = !showGrid)}
				onReset={resetView}
			/>
		{/if}
	{/snippet}
	{#snippet statusBar()}
		<StatusBar {status} onDismiss={() => (status = { kind: 'idle' })} />
	{/snippet}
</AppShell>

<!-- Outside the shell on purpose: the sidebars scroll and clip, and this has to sit over the
     map beside them ([Q33]). -->
{#if exporting && pipeline}
	<ExportDialog
		name={pipeline.name}
		{formats}
		{crop}
		onEstimate={estimateForExport}
		onCancel={() => (exporting = false)}
		produces={producing}
		onExport={() => void startExport()}
	/>
{/if}

{#if copying}
	<CopyDialog plan={copying} onCancel={() => (copying = null)} onWrite={(zip) => void writeCopy(zip)} />
{/if}

<!-- Outside the map region, like every other modal: the map keeps running behind it rather than
     being torn down, so coming back from installing a font returns to the view you left. -->
{#if assets}
	<AssetsDialog onClose={() => (assets = false)} />
{/if}

<Help />

<style>
	/* The landing screen covers the map region entirely; the map keeps running behind it so that
	   opening something does not have to build one. */
	:global(.landing) {
		position: absolute;
		inset: 0;
		z-index: 6;
	}
</style>
