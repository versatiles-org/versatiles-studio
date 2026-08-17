<script lang="ts">
	import { open } from '@tauri-apps/plugin-dialog';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import type { Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';
	import AppShell from './lib/components/shell/AppShell.svelte';
	import StatusBar, { type Status } from './lib/components/shell/StatusBar.svelte';
	import Inspector from './lib/components/shell/Inspector.svelte';
	import LandingScreen from './lib/components/shell/LandingScreen.svelte';
	import LeftPane from './lib/components/shell/LeftPane.svelte';
	import VplNodeCard from './lib/components/shell/VplNodeCard.svelte';
	import { nodeAtPath, walk } from './lib/vpl/node-at';
	import MapCanvas from './lib/components/map/MapCanvas.svelte';
	import FeaturePopup from './lib/components/map/FeaturePopup.svelte';
	import TileGrid from './lib/components/map/TileGrid.svelte';
	import CoordinateJump from './lib/components/map/CoordinateJump.svelte';
	import { defaultStyle } from './lib/map/default-style';
	import { addContainerToMap, removeContainerFromMap } from './lib/map/add-source';
	import {
		forgetRecent,
		getLayout,
		getPipeline,
		setPipeline,
		openContainer,
		recentSources,
		serverBaseUrl,
		setLayout,
		vplRemoveProperty,
		vplSetValue,
		type ContainerInfo,
		type DocumentView,
		type Layout,
		type Span,
		type OpenedContainer,
		type RecentEntry
	} from './lib/ipc/commands';

	const EXTENSIONS = ['versatiles', 'mbtiles', 'pmtiles', 'tar'];

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
	const selectedNode = $derived(selected && pipeline ? nodeAtPath(pipeline.pipeline, selected) : null);

	/// Editing a parameter of the selected node rewrites the document through the core, which owns
	/// the quoting and refuses anything that would not parse.
	async function editSelected(run: (text: string) => Promise<string>) {
		if (!pipeline) return;
		try {
			const text = await run(pipeline.text);
			pipeline = await setPipeline(text);
			pipelineRevision += 1;
			await syncContainersToPipeline();
		} catch (e) {
			fail(typeof e === 'object' && e && 'message' in e ? (e as { message: unknown }).message : e);
		}
	}
	// What the application is doing, shown along the bottom (Q24). Errors live here too — an error
	// is a state the application is in, and covering the map to say so was never a good trade.
	let status = $state<Status>({ kind: 'idle' });
	let showGrid = $state(false);
	let recents = $state<RecentEntry[]>([]);

	// The landing screen is what an *empty* window shows — it goes away for good once something is
	// open, and never gates anything (Q13).
	let empty = $derived(containers.length === 0);

	$effect(() => {
		void refreshRecents();
		void getLayout().then((loaded) => (layout = loaded));
		void getPipeline().then((loaded) => {
			pipeline = loaded;
			pipelineRevision += 1;
		});
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
			.then((url) => (style = defaultStyle(url)))
			.catch(fail);
	});

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
			filters: [{ name: 'Tile containers', extensions: EXTENSIONS }]
		});
		if (typeof picked === 'string') await load(picked);
	}

	/// Opens a container and puts it on the map. Does not touch the pipeline — see {@link load}.
	async function mount(source: string) {
		const result = await openContainer(source);
		if (map) addContainerToMap(map, result);
		containers = [...containers.filter((c) => c.info.source !== result.info.source), result];
		return result;
	}

	/// Opening a file *is* setting the pipeline to its read node (Q22, Q25).
	async function load(source: string) {
		// A remote container reads its index over the network, so this is not always instant.
		status = { kind: 'busy', message: `Opening ${filename(source)}…` };
		try {
			const result = await mount(source);
			pipeline = await setPipeline(result.vpl);
			pipelineRevision += 1;
			selected = null;
			await refreshRecents();
			status = { kind: 'idle' };
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
		const wanted = new Set<string>();
		for (const { node } of walk(pipeline.pipeline)) {
			if (node.name !== 'from_container') continue;
			const property = node.properties.find((p) => p.key === 'filename');
			if (property?.value.kind === 'single' && property.value.value) wanted.add(property.value.value);
		}

		for (const container of containers) {
			if (!wanted.has(container.info.source) && map) removeContainerFromMap(map, container.name);
		}
		containers = containers.filter((c) => wanted.has(c.info.source));

		for (const source of wanted) {
			if (containers.some((c) => c.info.source === source)) continue;
			status = { kind: 'busy', message: `Opening ${filename(source)}…` };
			await mount(source);
		}
		status = { kind: 'idle' };
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
		onPipelineChange={(text) => void setPipeline(text).then((next) => (pipeline = next))}
		{selected}
		onSelect={(path) => (selected = path)}
	/>
{/snippet}

{#snippet rightPaneContent()}
	<div class="right-stack">
		<!-- Q22: the parameters of the current selection, and the metadata that results from it. The
		     node's fields sit above the container's own numbers, in that order. -->
		{#if selectedNode}
			<VplNodeCard
				node={selectedNode}
				onCommit={(span: Span, value: string) => void editSelected((text) => vplSetValue(text, span, value))}
				onRemove={(span: Span) => void editSelected((text) => vplRemoveProperty(text, span))}
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
		{#if style}<MapCanvas {style} bind:map />{/if}
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
			<button class="grid-toggle" class:on={showGrid} onclick={() => (showGrid = !showGrid)}> z/x/y grid </button>
		{/if}
	{/snippet}
	{#snippet statusBar()}
		<StatusBar {status} onDismiss={() => (status = { kind: 'idle' })} />
	{/snippet}
</AppShell>

<style>
	.grid-toggle {
		position: absolute;
		right: 0.5rem;
		bottom: 0.5rem;
		z-index: 4;
		padding: var(--space-2) var(--space-4);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--float-bg);
	}
	.grid-toggle.on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
	}
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
