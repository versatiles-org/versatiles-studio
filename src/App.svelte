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
	import { declaredLayers } from './lib/map/tile-json';
	import { composition } from './lib/map/composition.svelte';
	import {
		vplRemoveProperty,
		vplSetValue,
		vplSetProperty,
		vplOperations,
		getGraph,
		type OperationInfo,
		fieldSuggestions
	} from './lib/ipc/commands';

	let map = $state<MaplibreMap | undefined>();
	// The map is created by an effect below, so the workbench is handed a way to reach it rather than
	// the instance - which would be stale the moment a reload replaced it.
	workbench.bind(() => map);
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

	// -- the crop ------------------------------------------------------------------------------

	/// Whether a drag on the map draws a rectangle. Local: a mode you are halfway through is not
	/// worth restoring after a reload, and leaving the app in it would be a trap.
	let drawing = $state(false);

	/// Moves a run of the stack, which is the whole of reordering ([the layer stack](docs/layers.md)).
	///
	/// **The segments are derived from the result, not edited towards it.** `move` produces the rows
	/// in their new order and `segmentsFrom` reads the runs back off them, so the boundaries are
	/// ascending by construction and there is no second place the invariant could be broken.
	async function reorderStack(range: [number, number], at: number) {
		const next = segmentsFrom(move(composition.rows, range, at));
		await styleRecipe.setSegments(next);
	}

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
     with it. An id with no arm here renders nothing, which is how a pane can exist in the core
     before it exists in the webview. -->
{#snippet paneContent(id: string)}
	{#if id === 'sources'}
		<SourcesPane
			graphs={composition.stacked}
			current={currentGraph}
			{operations}
			actions={{
				select: (id) => void workbench.select(id),
				rename: (id, name) => void workbench.rename(id, name),
				remove: (id) => void workbench.remove(id),
				setEnabled: (id, enabled) => void workbench.toggleGraph(id, enabled),
				addNode: (operation) => void workbench.newGraph(operation),
				// Both doors add a graph rather than writing into the selected one - the list they hang
				// off is what adds sources ([Q50]).
				openSource: () => void workbench.pick(undefined, 'new'),
				openPipeline: () => void workbench.pick(workbench.pipelineKind, 'new')
			}}
		/>
	{:else if id === 'pipeline'}
		<PipelinePane
			{operations}
			graph={composition.stacked.find((entry) => entry.id === currentGraph) ?? null}
			pipeline={document.current}
			pipelineRevision={document.revision}
			properties={producedProperties}
			fits={currentBuild?.fits ?? []}
			{suggestions}
			crop={document.current ? { bounds: workbench.crop, drawing } : null}
			cropActions={{
				set: (bounds) => void workbench.setCrop(bounds),
				draw: () => (drawing = !drawing),
				useView: () => workbench.cropToView()
			}}
			nodeActions={{
				setEnabled: (path, enabled) => void workbench.toggleNode(path, enabled),
				addOperation: (afterNameSpan, operation) => void workbench.addOperation(afterNameSpan, operation),
				remove: (span) => void workbench.removeNode(span),
				commitValue: (span, value) => void workbench.editText((text) => vplSetValue(text, span, value)),
				removeProperty: (span) => void workbench.editText((text) => vplRemoveProperty(text, span)),
				setProperty: (nameSpan, key, values) =>
					void workbench.editText((text) => vplSetProperty(text, nameSpan, key, values))
			}}
			documentActions={{
				change: (text) =>
					void workbench.setText(text, 'typing').then((next) => {
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
						void workbench.refresh();
					}),
				undo: () => void workbench.stepHistory(true),
				redo: () => void workbench.stepHistory(false),
				format: () => void workbench.format(),
				save: (chooseFile) => void workbench.save(chooseFile),
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
				setHidden: (graph, path, hidden) =>
					void styleRecipe.setHidden(graph, path, hidden).then(() => workbench.refresh()),
				setOverride: (graph, layer, patch) => void styleRecipe.setLayerFor(graph, layer, patch),
				select: (graph) => void workbench.select(graph),
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
				bbox={bboxField.shown ?? workbench.crop.bbox ?? null}
				drawing={bboxField.drawing || drawing}
				onDrawn={(bbox) => {
					if (bboxField.drawing) {
						bboxField.finish(bbox);
						return;
					}
					drawing = false;
					void workbench.setCrop({ bbox, minZoom: workbench.crop.minZoom, maxZoom: workbench.crop.maxZoom });
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
					onReset={() => workbench.resetView()}
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
		crop={workbench.crop}
		onEstimate={() => exporting.estimate(currentGraph, workbench.crop)}
		onCancel={() => exporting.close()}
		produces={exporting.producing}
		onExport={() => void exporting.start(currentGraph, document.current?.name ?? '', workbench.crop)}
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
