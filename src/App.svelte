<script lang="ts">
	import { open, save } from '@tauri-apps/plugin-dialog';
	import { untrack } from 'svelte';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { listen } from '@tauri-apps/api/event';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import type { Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';
	import AppShell from './lib/components/shell/AppShell.svelte';
	import StatusBar, { type Status } from './lib/components/shell/StatusBar.svelte';
	import { connectJobs } from './lib/state/jobs.svelte';
	import Inspector from './lib/components/shell/Inspector.svelte';
	import LandingScreen from './lib/components/shell/LandingScreen.svelte';
	import LeftPane from './lib/components/shell/LeftPane.svelte';
	import VplNodeCard from './lib/components/shell/VplNodeCard.svelte';
	import { nodeAtPath, walk } from './lib/vpl/node-at';
	import MapCanvas from './lib/components/map/MapCanvas.svelte';
	import FeaturePopup from './lib/components/map/FeaturePopup.svelte';
	import TileGrid from './lib/components/map/TileGrid.svelte';
	import MapControls from './lib/components/map/MapControls.svelte';
	import { buildBackground, isBackgroundId, type BackgroundId } from './lib/map/background';
	import CoordinateJump from './lib/components/map/CoordinateJump.svelte';
	import { defaultStyle } from './lib/map/default-style';
	import { addContainerToMap, removeContainerFromMap } from './lib/map/add-source';
	import { whyNotRenderable } from './lib/map/tile-format';
	import {
		forgetRecent,
		takeOpened,
		OPENED_EVENT,
		getLayout,
		getPipeline,
		setPipeline,
		undo as undoPipeline,
		openVpl,
		saveVpl,
		redo as redoPipeline,
		openContainer,
		recentSources,
		serverBaseUrl,
		setLayout,
		vplRemoveProperty,
		vplSetValue,
		vplSetProperty,
		vplOperations,
		previewPipeline,
		type DocumentView,
		type Layout,
		type OperationInfo,
		type Preview,
		type Span,
		type OpenedContainer,
		type RecentEntry
	} from './lib/ipc/commands';

	const CONTAINERS = ['versatiles', 'mbtiles', 'pmtiles', 'tar'];
	/** A pipeline file is a way in like a container is (C9), so every route accepts one. */
	const PIPELINES = ['vpl'];
	const EXTENSIONS = [...CONTAINERS, ...PIPELINES];

	const isPipelineFile = (source: string) => PIPELINES.some((ext) => source.toLowerCase().endsWith(`.${ext}`));

	let style = $state<StyleSpecification | null>(null);
	let map = $state<MaplibreMap | undefined>();
	// The opened containers, each with the read node it corresponds to (Q22).
	let containers = $state<OpenedContainer[]>([]);
	let layout = $state<Layout | null>(null);
	/** This window's pipeline. The core owns it (Q25); this is a copy to render. */
	let pipeline = $state<DocumentView | null>(null);
	/** Bumped when the pipeline changes from somewhere other than the editor, so the editor knows
	 *  to reload rather than being fought over its own buffer. */
	let pipelineRevision = $state(0);
	/** The node selected in the graph or the text. The right pane shows its parameters (Q22). */
	let selected = $state<number[] | null>(null);
	/** Build-time information about the binary, so it is fetched once and never refreshed. */
	let operations = $state<OperationInfo[]>([]);
	const selectedNode = $derived(selected && pipeline ? nodeAtPath(pipeline.pipeline, selected) : null);

	/// Editing a parameter of the selected node rewrites the document through the core, which owns
	/// the quoting and refuses anything that would not parse.
	async function editSelected(run: (text: string) => Promise<string>) {
		if (!pipeline) return;
		try {
			await applyDocument(await setPipeline(await run(pipeline.text), 'structured'));
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
		void getPipeline().then((loaded) => {
			pipeline = loaded;
			pipelineRevision += 1;
		});
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
	async function changeLayout(next: Layout) {
		layout = next;
		layout = await setLayout(next).catch(() => next);
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
				if (EXTENSIONS.some((ext) => path.toLowerCase().endsWith(`.${ext}`))) void load(path);
			}
		});
		return () => void unlisten.then((f) => f());
	});

	async function pick() {
		const picked = await open({
			multiple: false,
			filters: [
				{ name: 'Tile containers and pipelines', extensions: EXTENSIONS },
				{ name: 'Tile containers', extensions: CONTAINERS },
				{ name: 'VPL pipelines', extensions: PIPELINES }
			]
		});
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
			const outcome = await previewPipeline(selected ?? []);
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
		await syncContainersToPipeline();
		await refreshPreview();
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
					filters: [{ name: 'VPL pipelines', extensions: PIPELINES }]
				});
				if (!target) return; // cancelled
			}
			pipeline = await saveVpl(target);
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

	/// Opening a container *is* setting the pipeline to its read node (Q22, Q25). Opening a `.vpl`
	/// file sets the pipeline to what the file says.
	async function load(source: string) {
		// A remote container reads its index over the network, so this is not always instant.
		status = { kind: 'busy', message: `Opening ${filename(source)}…` };
		selected = null;
		try {
			if (isPipelineFile(source)) {
				// The whole document arrives at once, and the containers it names are opened by the
				// sync below — including relative ones, now resolved against the file.
				pipeline = await openVpl(source);
				pipelineRevision += 1;
				await syncContainersToPipeline();
			} else {
				const result = await mount(source);
				pipeline = await setPipeline(result.vpl, 'replaced');
				pipelineRevision += 1;
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
{#snippet leftPaneContent()}
	<LeftPane
		layout={layout as Layout}
		onLayoutChange={(next) => void changeLayout(next)}
		onAddSource={pick}
		{pipeline}
		{pipelineRevision}
		onPipelineChange={(text) =>
			void setPipeline(text, 'typing').then((next) => {
				pipeline = next;
				void refreshPreview();
			})}
		{selected}
		onSelect={(path) => {
			selected = path;
			void refreshPreview();
		}}
		onUndo={() => void stepHistory(true)}
		onRedo={() => void stepHistory(false)}
		onSave={(chooseFile) => void savePipeline(chooseFile)}
	/>
{/snippet}

{#snippet rightPaneContent()}
	<div class="right-stack">
		<!-- Q22: the parameters of the current selection, and the metadata that results from it. The
		     node's fields sit above the container's own numbers, in that order. -->
		{#if selectedNode}
			<VplNodeCard
				node={selectedNode}
				{operations}
				onCommit={(span: Span, value: string) => void editSelected((text) => vplSetValue(text, span, value))}
				onRemove={(span: Span) => void editSelected((text) => vplRemoveProperty(text, span))}
				onSet={(key: string, values: string[]) =>
					void editSelected((text) => vplSetProperty(text, selectedNode.nameSpan, key, values))}
			/>
		{/if}
		<Inspector containers={containers.map((c) => c.info)} {map} onOpen={pick} onOpenUrl={(url) => void load(url)} />
	</div>
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
				{recents}
				onOpenFile={pick}
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

<style>
	/* The landing screen covers the map region entirely; the map keeps running behind it so that
	   opening something does not have to build one. */
	/* The node form above the inspector; the inspector keeps its own scroll. */
	.right-stack {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-width: 0;
	}
	:global(.landing) {
		position: absolute;
		inset: 0;
		z-index: 6;
	}
</style>
