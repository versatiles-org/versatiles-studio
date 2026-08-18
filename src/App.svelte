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
	import Inspector from './lib/panes/inspector/Inspector.svelte';
	import LandingScreen from './lib/common/LandingScreen.svelte';
	import PipelineOutput from './lib/panes/output/PipelineOutput.svelte';
	import Sidebar from './lib/shell/Sidebar.svelte';
	import PipelinePane from './lib/panes/pipeline/PipelinePane.svelte';
	import { nodeAt, samePath, walk } from './lib/vpl/node-at';
	import MapCanvas from './lib/map/MapCanvas.svelte';
	import FeaturePopup from './lib/map/FeaturePopup.svelte';
	import TileGrid from './lib/map/TileGrid.svelte';
	import MapControls from './lib/map/MapControls.svelte';
	import { buildBackground, isBackgroundId, type BackgroundId } from './lib/map/background';
	import CoordinateJump from './lib/map/CoordinateJump.svelte';
	import { defaultStyle } from './lib/map/default-style';
	import { addContainerToMap, removeContainerFromMap } from './lib/map/add-source';
	import { whyNotRenderable } from './lib/map/tile-format';
	import {
		forgetRecent,
		takeOpened,
		OPENED_EVENT,
		getLayout,
		listGraphs,
		mountGraph,
		setPin,
		getPinned,
		renameGraph,
		addGraph,
		setGraph,
		undo as undoPipeline,
		openVpl,
		saveVpl,
		redo as redoPipeline,
		openContainer,
		recentSources,
		serverBaseUrl,
		setLayout,
		vplRemoveProperty,
		vplInsertNode,
		vplRemoveNode,
		vplSetValue,
		vplSetProperty,
		vplOperations,
		getGraph,
		previewPipeline,
		type DocumentView,
		type Layout,
		type OperationInfo,
		type Preview,
		type Span,
		importKinds,
		importKindFor,
		importReadNode,
		fieldSuggestions,
		type EditKind,
		type GraphInfo,
		type ImportKind,
		type OpenedContainer,
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
	// The opened containers, each with the read node it corresponds to (Q22).
	let containers = $state<OpenedContainer[]>([]);
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
	/** The node selected in the graph or the text. The right pane shows its parameters (Q22). */
	let selected = $state<number[] | null>(null);
	/** Build-time information about the binary, so it is fetched once and never refreshed. */
	let operations = $state<OperationInfo[]>([]);

	/// Editing a parameter of the selected node rewrites the document through the core, which owns
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
	/** The last preview that was put on the map, so a style swap can restore it without rebuilding. */
	let lastPreview = $state<Preview | null>(null);

	/// Values the selected node's fields could take, read from what that node points at (S3.4).
	///
	/// Refetched whenever the selection or the document changes: the answer depends on the node's
	/// `filename`, so a stale map would offer one file's columns for another file's node.
	let suggestions = $state<Record<string, string[]>>({});
	$effect(() => {
		const path = selected;
		// Depend on the document too — editing `filename` changes which file is being asked about.
		void pipeline?.text;
		const graph = pipeline?.graph;
		if (!path || graph === undefined) {
			suggestions = {};
			return;
		}
		void fieldSuggestions(graph, path).then((found) => {
			suggestions = Object.fromEntries(found.map((each) => [each.field, each.values]));
		});
	});

	/// Property names the pipeline is producing, for the form's list fields (S3.3, E1).
	///
	/// Flattened across layers and de-duplicated: a node's `properties_include` applies to the
	/// features passing through it, not to one layer, so splitting them by layer here would be a
	/// distinction the parameter does not make.
	const producedProperties = $derived([...new Set((lastPreview?.layers ?? []).flatMap((layer) => layer.propertyKeys))]);
	let serverUrl = $state<string | null>(null);

	/** A value from an older build is not trusted — the catalogue decides what exists. */
	const background = $derived<BackgroundId>(isBackgroundId(layout?.background) ? layout.background : 'none');
	let recents = $state<RecentEntry[]>([]);

	// The landing screen is what an *empty* window shows — it goes away for good once something is
	// open, and never gates anything (Q13).
	let empty = $derived(containers.length === 0);

	$effect(() => {
		// Before anything else asks for work: a job started by the previous window — a conversion
		// still running across a reload — has to appear in the bar, not only the ones this session
		// starts.
		void connectJobs();
		void refreshRecents();
		void getLayout().then((loaded) => (layout = loaded));
		void vplOperations().then((loaded) => (operations = loaded));
		void importKinds().then((loaded) => (kinds = loaded));
		void refreshGraphs().then(async () => {
			if (graphs.length > 0) pipeline = await getGraph(graphs[0].id);
			pipelineRevision += 1;
		});
		void getPinned().then((found) => (pinned = found));
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
		const newest = containers.at(-1)?.info.source;
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
	/// A shim while the graph list is still to come (S2.13): it keeps every existing call site
	/// working against the plural API, and is the one place that will need to know about the
	/// selected graph when there is more than one.
	async function setPipelineText(text: string, kind: EditKind = 'structured') {
		if (currentGraph === null) {
			const created = await addGraph('graph', text);
			await refreshGraphs();
			return created;
		}
		return await setGraph(currentGraph, text, kind);
	}

	/// Shows another graph's chain. The pin does not move: the map is a separate question ([Q32]).
	async function selectGraph(id: number) {
		selected = null;
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

	async function changeLayout(next: Layout) {
		layout = next;
		layout = await setLayout(next).catch(() => next);
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

	// The background is the one part of Studio that fetches from the network (G5), so it is built
	// only when asked for. `none` returns to the empty style the map starts on.
	$effect(() => {
		const chosen = background;
		const url = serverUrl;
		if (!url) return;
		void untrack(async () => {
			try {
				style = (await buildBackground(chosen, url)) ?? defaultStyle(url);
			} catch (e) {
				fail(e);
			}
		});
	});

	/// Puts the preview back after a style swap, which discards every layer added to the old style.
	function restorePreview() {
		if (map && lastPreview) addContainerToMap(map, lastPreview);
	}

	/// Returns the camera to what is currently open.
	function resetView() {
		const bbox = lastPreview?.info.bbox;
		if (map && bbox) map.fitBounds(bbox, { padding: 24, duration: 400 });
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

	/// Opens a container and remembers it. Does not put it on the map — the map shows what the
	/// *pipeline* produces (C3), and a container is only ever an input to that.
	async function mount(source: string) {
		const result = await openContainer(source);
		containers = [...containers.filter((c) => c.info.source !== result.info.source), result];
		return result;
	}

	/// Runs the pipeline up to the selected node and points the map at the result.
	///
	/// This is what "instantly see the result" means (M4): the map shows the data as it is at the
	/// selected step, so tightening a filter changes the tiles rather than a number in a form.
	let previewName = $state<string | null>(null);

	// The map is created by an effect, so it can appear after a pipeline has already been loaded —
	// on a reload, the document comes back from the core before there is anything to draw it on.
	// `untrack` keeps this listening for the map alone; every other trigger calls in explicitly.
	$effect(() => {
		if (!map) return;
		untrack(() => {
			if (pipeline) void refreshPreview();
		});
	});

	async function refreshPreview() {
		if (!map || !pipeline) return;
		try {
			// The build is a job in the runner's `latest` lane, so **editing again stops the build
			// that is now out of date** rather than leaving it to finish. That also removes the
			// token this used to carry: which preview is current is the runner's to know, and a
			// second answer to that question in here could only ever disagree with it.
			// The map follows the **pin**, not the selection ([Q32]): with nothing pinned it shows
			// every graph in full, which is what a style will draw over.
			const outcome = pinned
				? await previewPipeline(pinned.graph, pinned.path)
				: await mountGraph(pipeline.graph).then((p) => (p ? ({ kind: 'ready', ...p } as const) : null));
			if (!outcome) return;
			if (outcome.kind === 'superseded') return;

			if (previewName && map) removeContainerFromMap(map, previewName);
			previewName = null;
			const result = outcome.kind === 'ready' ? outcome : null;
			lastPreview = result;
			if (result) {
				previewName = result.name;
				// A format the map cannot draw is a thing to say, not a blank map with errors in the
				// console — which is what it used to be.
				if (!addContainerToMap(map, result)) {
					status = { kind: 'error', message: whyNotRenderable(result.info.tileFormat) };
					return;
				}
			}
			status = { kind: 'idle' };
		} catch (e) {
			fail(e);
		}
	}

	/// Applies a document the core has handed back — after an edit, an undo, or a reload.
	///
	/// Every path that changes the pipeline ends here, so the map, the editor and the selection can
	/// never be following different versions of it.
	async function applyDocument(next: DocumentView) {
		pipeline = next;
		pipelineRevision += 1;
		// The list shows the name, the pin and the unsaved dot — the last of which changes on every
		// edit, so refreshing here rather than only when a graph is added or removed.
		await refreshGraphs();
		await syncContainersToPipeline();
		await refreshPreview();
	}

	/// Adds a transform after the selected node, or after the last one when nothing is selected.
	///
	/// Selects what it added, for the same reason an import selects its node ([Q29]): the next thing
	/// to do is set its parameters, and the form for them is one unmarked click away otherwise.
	/// Adds a transform after the node whose name occupies `span`, and selects what it added.
	///
	/// Selecting it is the point: the next thing to do is set its parameters, and after [Q32] the
	/// node *is* the form — an unselected one shows only its name.
	async function addOperation(afterNameSpan: Span, operation: string) {
		if (!pipeline) return;
		const at = nodeAt(pipeline.pipeline, afterNameSpan.start)?.path;
		try {
			await applyDocument(
				await setPipelineText(await vplInsertNode(pipeline.text, afterNameSpan, operation), 'structured')
			);
			if (at) {
				const next = [...at];
				next[next.length - 1] += 1;
				selected = next;
			}
		} catch (e) {
			fail(e);
		}
	}

	/// Removes the selected node. The selection moves to whatever took its place in the chain.
	/// Removes a node. The selection is dropped: what was selected is gone.
	async function removeNode(span: Span) {
		if (!pipeline) return;
		try {
			const next = await setPipelineText(await vplRemoveNode(pipeline.text, span), 'structured');
			selected = null;
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
					defaultPath: pipeline.path ?? 'pipeline.vpl',
					filters: [{ name: 'VPL pipelines', extensions: pipelineExtensions }]
				});
				if (!target) return; // cancelled
			}
			pipeline = await saveVpl(pipeline.graph, target);
			status = { kind: 'busy', message: `Saved ${filename(target)}` };
			await refreshRecents();
			status = { kind: 'idle' };
		} catch (e) {
			fail(e);
		}
	}

	async function stepHistory(back: boolean) {
		try {
			const next = await (back ? undoPipeline() : redoPipeline());
			if (next) await applyDocument(next);
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
		selected = null;
		try {
			const kind = await importKindFor(source);
			if (kind === null) {
				status = { kind: 'error', message: `Studio has no way to open ${filename(source)}` };
				return;
			}

			if (kind.operation === null) {
				// The whole document arrives at once, and the containers it names are opened by the
				// sync below — including relative ones, now resolved against the file.
				pipeline = await openVpl(source);
				pipelineRevision += 1;
				await syncContainersToPipeline();
			} else if (kind.id === 'container') {
				const result = await mount(source);
				pipeline = await setPipelineText(result.vpl, 'replaced');
				pipelineRevision += 1;
			} else {
				pipeline = await setPipelineText(await importReadNode(kind.id, source), 'replaced');
				pipelineRevision += 1;
				// Selected, so the form for it is showing. Importing *is* configuring: `from_geo`
				// takes a zoom range, simplification and property filters, and the generated form
				// is where those are set — [ui.md](../docs/ui.md) settled that there is no import
				// surface of its own. Landing on an unselected node would mean the one thing an
				// import needs next is one click away and unmarked.
				selected = [0];
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

	/// Makes the map show what the pipeline says.
	///
	/// The read nodes are the sources (Q22), so editing one — pointing `filename` somewhere else, or
	/// deleting a node — has to move the map with it. Without this the document and the picture drift
	/// apart, which is the one thing merging the modes was meant to prevent.
	async function syncContainersToPipeline() {
		if (!pipeline) return;
		// A plain Set, not `SvelteSet`: this is a local working set inside one call, never held in
		// `$state` and never read reactively, so there is nothing for a reactive wrapper to do.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const wanted = new Set<string>();
		for (const { node } of walk(pipeline.pipeline)) {
			if (node.name !== 'from_container') continue;
			const property = node.properties.find((p) => p.key === 'filename');
			if (property?.value.kind === 'single' && property.value.value) wanted.add(property.value.value);
		}

		containers = containers.filter((c) => wanted.has(c.info.source));

		for (const source of wanted) {
			if (containers.some((c) => c.info.source === source)) continue;
			status = { kind: 'busy', message: `Opening ${filename(source)}…` };
			await mount(source);
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
			{selected}
			properties={producedProperties}
			{suggestions}
			pinned={pinned && pinned.graph === currentGraph ? pinned.path : null}
			graphActions={{
				select: (id) => void selectGraph(id),
				rename: (id, name) => void rename(id, name),
				addSource: (kind) => void pick(kind)
			}}
			nodeActions={{
				// No preview refresh: since [Q32] the map follows the *pin*, not the selection, so
				// rebuilding here would produce the identical tiles. It used to, when the two were
				// the same thing.
				select: (path) => {
					selected = path;
				},
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
						pipeline = next;
						void refreshPreview();
					}),
				undo: () => void stepHistory(true),
				redo: () => void stepHistory(false),
				save: (chooseFile) => void savePipeline(chooseFile)
			}}
		/>
	{:else if id === 'output'}
		<PipelineOutput preview={lastPreview} />
	{:else if id === 'inspector'}
		<Inspector containers={containers.map((c) => c.info)} {map} onOpen={pick} onOpenUrl={(url) => void load(url)} />
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
	{#snippet mapPane()}
		{#if style}<MapCanvas {style} bind:map onStyleLoad={restorePreview} />{/if}
		<FeaturePopup {map} source={containers.at(-1)?.info.source ?? null} />
		<TileGrid {map} visible={showGrid} />
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
			<MapControls
				{background}
				{showGrid}
				canReset={Boolean(lastPreview?.info.bbox)}
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
