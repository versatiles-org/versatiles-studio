<script lang="ts">
	import { untrack } from 'svelte';
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import AppShell from './lib/shell/AppShell.svelte';
	import StatusBar from './lib/shell/StatusBar.svelte';
	import Boundary from './lib/shell/Boundary.svelte';
	import Help from './lib/common/Help.svelte';
	import { connectJobs } from './lib/state/jobs.svelte';
	import { refresh as refreshProblems, reportProblem, watch as watchForProblems } from './lib/state/diagnostics.svelte';
	import { panels } from './lib/shell/StatusBar.svelte';
	// Named for what it is, because `style` in this file is already the rendered MapLibre style.
	import { style as styleRecipe } from './lib/state/style.svelte';
	import { registerTileProtocol } from './lib/state/tiles.svelte';
	import { preview } from './lib/state/preview.svelte';
	import { layout } from './lib/state/layout.svelte';
	import { document } from './lib/state/document.svelte';
	import { workbench } from './lib/state/workbench.svelte';
	import { graphs } from './lib/state/graphs.svelte';
	import { project } from './lib/state/project.svelte';
	import { exporting } from './lib/state/export.svelte';
	import { status } from './lib/state/status.svelte';
	import { PANES, isPaneId, paneDetail } from './lib/panes/registry';
	import Sidebar from './lib/shell/Sidebar.svelte';
	import { windowEvents } from './lib/shell/window-events.svelte';
	import AlphaRibbon from './lib/shell/AlphaRibbon.svelte';
	import AssetsDialog from './lib/shell/AssetsDialog.svelte';
	import UpdateDialog from './lib/shell/UpdateDialog.svelte';
	import TileDialog from './lib/shell/TileDialog.svelte';
	import { tileDialog } from './lib/state/tile-dialog.svelte';
	import ExportDialog from './lib/panes/pipeline/ExportDialog.svelte';
	import CopyDialog from './lib/panes/project/CopyDialog.svelte';
	import MapCanvas from './lib/map/MapCanvas.svelte';
	import FeaturePopup from './lib/map/FeaturePopup.svelte';
	import TileGrid from './lib/map/TileGrid.svelte';
	import HeatMap from './lib/map/HeatMap.svelte';
	import HeatLegend from './lib/map/HeatLegend.svelte';
	import { heat } from './lib/state/heat.svelte';
	import { analysis } from './lib/state/analysis.svelte';
	import { requestedZoom } from './lib/map/tile-grid';
	import TileActivity from './lib/map/TileActivity.svelte';
	import CropOverlay from './lib/map/CropOverlay.svelte';
	import { bboxField } from './lib/state/bbox.svelte';
	import MapControls from './lib/map/MapControls.svelte';
	import SearchBox from './lib/map/SearchBox.svelte';
	import Views from './lib/map/Views.svelte';
	import Note from './lib/common/Note.svelte';
	import { composition } from './lib/map/composition.svelte';
	import { getGraph } from './lib/ipc/commands';

	let map = $state<MaplibreMap | undefined>();
	// The map is created by an effect below, so the workbench is handed a way to reach it rather than
	// the instance - which would be stale the moment a reload replaced it.
	workbench.bind(() => map);
	// **Wiring and markup, nothing else** (S10.10). The selection is `workbench.selected`, what it built
	// is `composition.editedBuild`, and each pane's connection to those lives in its own folder as a
	// `*Section` component - so a rule about one pane is found beside that pane, and a rule about the
	// window is in the module it is about ([Svelte Components](docs/components.md)).

	let showGrid = $state(false);

	/// What the heat map is drawn for (S14.3): the selected source as it is built now, and the levels
	/// its squares can stand for. `null` hides the control - nothing is selected, or nothing built.
	const heatOf = $derived.by(() => {
		const selected = workbench.selected;
		const build = composition.editedBuild;
		return selected && build
			? { graph: selected.id, name: selected.name, build: build.tileUrl, info: build.info }
			: null;
	});

	// **It follows the selection**, and the build: a rebuild may read another container.
	$effect(() => {
		const of = heatOf;
		untrack(() => void heat.follow(of?.graph ?? null, of?.build ?? null, of?.info.maxZoom ?? null));
	});

	/// The detail level's own figures, when the source has been measured and the figures still apply.
	const heatFigures = $derived.by(() => {
		const drawn = heat.drawn;
		if (!heatOf || !drawn || analysis.stale(heatOf.graph, heatOf.build)) return null;
		return analysis.of(heatOf.graph).sizes?.levels.find((level) => level.level === drawn.detail) ?? null;
	});

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
		// The style survives a reload the way the graphs do - the core owns it ([Q36]).
		void styleRecipe.load();
		// Once, and before any source is added: a tile URL handed to MapLibre before its scheme is
		// registered is a tile MapLibre does not know how to fetch (S2.16).
		registerTileProtocol();
		void workbench.load();
		void graphs.refresh().then(async () => {
			if (graphs.first) document.show(await getGraph(graphs.first.id));
			// The graph came back from the core; the containers it reads did not. Every other path
			// that sets a pipeline syncs them - `applyDocument` and `open` - and this one was missing
			// it, so after a reload the inspector had nothing to show about a container the pipeline
			// was plainly using (A6, A4).
			await workbench.syncContainers();
			await graphs.mountAll();
		});
		void exporting.loadFormats();
	});

	// The background map is rebuilt whenever it is chosen, which cannot be a derivation - see
	// `composition.follow`.
	composition.follow();

	// **The first preview waits for the map.** It is created by an effect, so it can appear after a
	// pipeline has already been loaded - on a reload the document comes back from the core before
	// there is anything to draw it on. `untrack` keeps this listening for the map alone; every other
	// trigger calls the workbench in explicitly.
	$effect(() => {
		if (!map) return;
		untrack(() => {
			if (document.current) void workbench.refresh();
		});
	});

	/// What each pane's header says it is about (S10.4).
	///
	/// **The chain alternates scope and nothing said so.** Sources and Layers span the project;
	/// Pipeline, Style and the Inspector follow the selected graph - and the only cue for which graph
	/// that was sat in a row of the Sources pane, which may be folded or scrolled away. The header
	/// carries it instead, and keeps carrying it while the pane is folded. Which panes are which is
	/// the registry's to say (S10.9).
	const detailOf = (id: string): string | null => paneDetail(id, workbench.selected?.name ?? null);

	/// Everything that reaches this window from outside it - see `window-events.svelte.ts`.
	windowEvents.listen({
		open: () => void workbench.pick(),
		openProject: () => void workbench.openProject(),
		saveProject: () => void project.save(() => composition.text()),
		saveProjectAs: () => void project.saveAs(() => composition.text()),
		saveCopy: () => void project.showCopy(),
		showAssets: () => (assets = true),
		showUpdates: () => (updating = true),
		showProblems: () => panels.show('problems'),
		inspectTile: () => {
			const selected = workbench.selected;
			const deepest = composition.editedBuild?.info.maxZoom;
			const tile = deepest === undefined ? null : workbench.centreTile(deepest);
			if (selected && tile) void tileDialog.open(selected.id, tile.z, tile.x, tile.y);
			else status.fail(new Error('Select a source that is drawn on the map to inspect one of its tiles.'));
		},
		reportProblem: () => void reportProblem('this').catch((error: unknown) => status.fail(error)),
		openPath: (path) => workbench.openPath(path),
		accepts: (path) => workbench.accepts(path),
		stepHistory: (back) => void workbench.stepHistory(back),
		title: () => {
			const newest = preview.containers.at(-1)?.info.source;
			return newest ? (newest.split(/[/\\]/).pop() ?? newest) : null;
		}
	});
</script>

<!-- Declared out here and passed by reference, so an empty window can pass nothing at all. A
     snippet is always truthy once declared inline, which would leave the shell holding an empty
     column the width of a pane that has nothing in it. -->
<!-- One snippet for both sidebars, keyed by pane id (Q31). Shared rather than one per side,
     because which side a pane is on is data - a pane that moves must not need its markup moved
     with it. Which component an id means is the registry's (S10.9), and each is a `*Section` that
     wires its pane to the state modules (S10.10) - so adding a pane is an entry there, a folder, and
     nothing here. An id the registry does not know renders nothing, which is how a pane can exist
     in the core before it exists in the webview. -->
{#snippet paneContent(id: string)}
	{#if isPaneId(id)}
		{@const Section = PANES[id].component}
		<Section />
	{/if}
{/snippet}

{#snippet leftPaneContent()}
	<Sidebar
		panes={layout.on('left')}
		onToggle={(id, open) => layout.toggle(id, open)}
		detail={detailOf}
		content={paneContent}
	/>
{/snippet}

{#snippet rightPaneContent()}
	<Sidebar
		panes={layout.on('right')}
		onToggle={(id, open) => layout.toggle(id, open)}
		detail={detailOf}
		content={paneContent}
	/>
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
				drawing={workbench.drawing || heat.on}
				graph={workbench.selected?.id ?? null}
				mount={composition.editedName}
				onInspect={(z, x, y) => {
					if (workbench.selected) void tileDialog.open(workbench.selected.id, z, x, y);
				}}
			/>
			<TileGrid {map} visible={showGrid} level={gridLevel} />
			<HeatMap
				{map}
				mount={heat.on ? heat.mount : null}
				graph={heat.drawn?.graph ?? null}
				detail={heat.drawn?.detail ?? null}
				onPick={(z, x, y) => {
					if (heat.drawn) void tileDialog.open(heat.drawn.graph, z, x, y);
				}}
			/>
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
				bbox={bboxField.shown ?? workbench.crop.bbox ?? null}
				drawing={bboxField.drawing || workbench.drawing}
				onDrawn={(bbox) => {
					if (bboxField.drawing) {
						bboxField.finish(bbox);
						return;
					}
					workbench.drawing = false;
					void workbench.setCrop({ bbox, minZoom: workbench.crop.minZoom, maxZoom: workbench.crop.maxZoom });
				}}
			/>
			{#if empty}
				<!-- **Quiet, and not a launcher** (S7.9, [Q48]). The launcher is a window now; putting
				     one inside a window that is already a project is what made a project window two
				     different things depending on its contents. This is a window between documents -
				     it says where the way in is and gets out of the way.
				
				     It no longer takes the panes with it ([Q54]): the door it points at is not the only
				     one, and the other is `+ new source…` in the Sources pane - which this used to
				     hide, for exactly as long as there was nothing to list. -->
				<div class="between">
					<Note tone="empty">
						Nothing is open. <strong>File → Open…</strong> brings a container, a pipeline or a table into this window.
					</Note>
				</div>
			{/if}
			<!-- **One layer, two clusters** ([Q67]). These used to place themselves in three corners, and
			     then became one stack down the left edge; `MapControls` now arranges them by what they
			     answer - where you are looking, top left; what is drawn and how the camera sits, top
			     right - so each corner is one control rather than a pile of them. The attribution keeps
			     the bottom right.
			
			     Shown with nothing open too ([Q54]): they are about looking at the map, and a map with
			     only a basemap on it is still a map somebody may want to move around. -->
			<div class="map-controls">
				<MapControls
					{map}
					background={layout.background}
					{showGrid}
					{gridLevel}
					gridNudged={gridOffset !== 0}
					canReset={Boolean(composition.editedBuild?.info.bbox)}
					onBackground={(id) => layout.current && void layout.change({ ...layout.current, background: id })}
					backgroundLabels={layout.backgroundLabels}
					onBackgroundLabels={(on) => layout.current && void layout.change({ ...layout.current, backgroundLabels: on })}
					onToggleGrid={() => (showGrid = !showGrid)}
					onGridLevel={(by) => (gridOffset = by === 0 ? 0 : gridOffset + by)}
					heat={heatOf
						? {
								on: heat.on,
								level: heat.drawn?.detail ?? heatOf.info.maxZoom,
								min: heatOf.info.minZoom,
								max: heatOf.info.maxZoom
							}
						: null}
					onToggleHeat={() => {
						if (heat.on) void heat.hide();
						else if (heatOf) void heat.show(heatOf.graph, heatOf.build, heatOf.info.maxZoom);
					}}
					onHeatLevel={(by) => heatOf && void heat.step(by, heatOf.info.minZoom, heatOf.info.maxZoom)}
					onReset={() => workbench.resetView()}
				>
					{#snippet heatLegend()}
						<HeatLegend
							source={heatOf?.name ?? null}
							bands={heat.mount?.bands ?? []}
							detail={heat.drawn?.detail ?? null}
							minZoom={heat.mount?.minZoom ?? null}
							zoom={mapZoom}
							figures={heatFigures}
							error={heat.error}
						/>
					{/snippet}
					{#snippet views()}<Views {map} />{/snippet}
					{#snippet jump()}<SearchBox {map} />{/snippet}
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
		crop={workbench.crop}
		onEstimate={(compression) => exporting.estimate(document.graph, workbench.crop, compression)}
		onCancel={() => exporting.close()}
		produces={exporting.producing}
		onExport={({ format, compression }) =>
			void exporting.start(document.graph, document.current?.name ?? '', workbench.crop, format, compression)}
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

{#if tileDialog.at}
	{@const at = tileDialog.at}
	<TileDialog
		{at}
		dissection={tileDialog.dissection}
		error={tileDialog.error}
		loading={tileDialog.loading}
		onGo={(z, x, y) => void tileDialog.go(z, x, y)}
		onShowOnMap={() => {
			workbench.showTile(at.z, at.x, at.y);
			tileDialog.close();
		}}
		onClose={() => tileDialog.close()}
	/>
{/if}

<!-- Outside the shell, like the modals: it belongs to the window rather than to a cell of the grid. -->
<AlphaRibbon />

<Help />

<style>
	/* Everything the map is controlled by ([Q67]). `MapControls` places the clusters inside it.
	   
	   No `overflow` of its own, deliberately: the dropdown panels open *out* of their buttons and hang
	   over the map, and a scroll container would clip them. */
	.map-controls {
		position: absolute;
		inset: 0;
		/* Over the feature popup, which sits at 5. These are the map's chrome and the popup is its
		   content: a panel opening behind the thing it was opened from is never what was meant. */
		z-index: 6;
		/* The whole map, so `MapControls` can put each cluster in its own corner - and transparent to
		   the pointer, so the box between them is still map. */
		pointer-events: none;
	}

	/* A window between documents. Over the map rather than replacing it - the map keeps running, so
	   opening something does not have to build one - and small enough to read as a note rather than
	   as a screen (S7.9). */
	.between {
		position: absolute;
		inset: auto 0 0;
		padding: var(--space-4) var(--space-5);
		z-index: 6;
		text-align: center;

		strong {
			color: var(--ink);
			font-weight: 500;
			white-space: nowrap;
		}
	}
</style>
