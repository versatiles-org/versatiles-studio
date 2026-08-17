<script lang="ts">
	import { open } from '@tauri-apps/plugin-dialog';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import type { Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';
	import AppShell from './lib/components/shell/AppShell.svelte';
	import CommandStrip from './lib/components/shell/CommandStrip.svelte';
	import Inspector from './lib/components/shell/Inspector.svelte';
	import LandingScreen from './lib/components/shell/LandingScreen.svelte';
	import LeftPane from './lib/components/shell/LeftPane.svelte';
	import MapCanvas from './lib/components/map/MapCanvas.svelte';
	import FeaturePopup from './lib/components/map/FeaturePopup.svelte';
	import TileGrid from './lib/components/map/TileGrid.svelte';
	import CoordinateJump from './lib/components/map/CoordinateJump.svelte';
	import { defaultStyle } from './lib/map/default-style';
	import { addContainerToMap } from './lib/map/add-source';
	import {
		forgetRecent,
		getLayout,
		openContainer,
		recentSources,
		serverBaseUrl,
		setLayout,
		type ContainerInfo,
		type Layout,
		type OpenedContainer,
		type RecentEntry
	} from './lib/ipc/commands';

	const EXTENSIONS = ['versatiles', 'mbtiles', 'pmtiles', 'tar'];

	let style = $state<StyleSpecification | null>(null);
	let map = $state<MaplibreMap | undefined>();
	// The opened containers, each with the read node it corresponds to (Q22).
	let containers = $state<OpenedContainer[]>([]);
	let layout = $state<Layout | null>(null);
	let command = $state<string | null>(null);
	let error = $state<string | null>(null);
	let showGrid = $state(false);
	let recents = $state<RecentEntry[]>([]);

	// The landing screen is what an *empty* window shows — it goes away for good once something is
	// open, and never gates anything (Q13).
	let empty = $derived(containers.length === 0);

	$effect(() => {
		void refreshRecents();
		void getLayout().then((loaded) => (layout = loaded));
	});

	// Applied locally first so a collapse paints without waiting on the round trip, then persisted.
	// The core clamps, so what comes back is authoritative and replaces the optimistic copy.
	async function changeLayout(next: Layout) {
		layout = next;
		layout = await setLayout(next).catch(() => next);
	}

	async function refreshRecents() {
		recents = await recentSources().catch(() => []);
	}

	$effect(() => {
		serverBaseUrl()
			.then((url) => (style = defaultStyle(url)))
			.catch((e) => (error = String(e)));
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

	async function load(source: string) {
		error = null;
		try {
			const result = await openContainer(source);
			if (map) addContainerToMap(map, result);
			containers = [...containers.filter((c) => c.info.source !== result.info.source), result];
			// G2: name the CLI equivalent of what just happened.
			command = `versatiles probe ${shellQuote(source)} -d`;
			await refreshRecents();
		} catch (e) {
			error = String(e);
		}
	}

	const shellQuote = (s: string) => (/[^\w./-]/.test(s) ? `'${s.replaceAll("'", `'\\''`)}'` : s);
</script>

<!-- Declared out here and passed by reference, so an empty window can pass nothing at all. A
     snippet is always truthy once declared inline, which would leave the shell holding an empty
     column the width of a pane that has nothing in it. -->
{#snippet leftPaneContent()}
	<LeftPane
		layout={layout as Layout}
		{containers}
		onLayoutChange={(next) => void changeLayout(next)}
		onAddSource={pick}
	/>
{/snippet}

{#snippet rightPaneContent()}
	<Inspector containers={containers.map((c) => c.info)} {map} onOpen={pick} onOpenUrl={(url) => void load(url)} />
{/snippet}

<AppShell
	leftPane={empty || !layout ? undefined : leftPaneContent}
	leftWidth={layout?.leftWidth}
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
		{#if error}<div class="error">{error}</div>{/if}
	{/snippet}
	{#snippet commandBar()}
		<CommandStrip {command} />
	{/snippet}
</AppShell>

<style>
	:global(body) {
		margin: 0;
	}
	.grid-toggle {
		position: absolute;
		right: 0.5rem;
		bottom: 0.5rem;
		z-index: 4;
		font:
			0.72rem system-ui,
			sans-serif;
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--rule);
		border-radius: 3px;
		background: rgb(255 255 255 / 0.94);
		cursor: pointer;
	}
	.grid-toggle.on {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}
	/* The landing screen covers the map region entirely; the map keeps running behind it so that
	   opening something does not have to build one. */
	:global(.landing) {
		position: absolute;
		inset: 0;
		z-index: 6;
	}
	.error {
		position: absolute;
		left: 0.75rem;
		top: 0.75rem;
		background: #fff3f3;
		border: 1px solid #f0c0c0;
		color: #b00;
		padding: 0.4rem 0.6rem;
		border-radius: 3px;
		font-size: 0.78rem;
		max-width: 28rem;
	}
</style>
