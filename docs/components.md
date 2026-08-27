# Svelte Components

Written from scratch, not imported ([Q18](decisions.md)) - `@versatiles/svelte`,
`maplibre-versatiles-styler` and `versatiles-map-editor` are references to read, not dependencies.
Svelte 5 with runes; all JavaScript bundled at build time ([Q5](decisions.md)).

Stage IDs refer to the scope documents; feature IDs to the [Feature Catalogue](features.md).

## Read before writing

Three problems the org has already solved. Copying them is cheap; hitting them blind is not.

| Problem                                                                                        | Reference                                                               |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **MapLibre 6's worker breaks when bundled.** Needs a build step and an exact `maplibre-gl` pin | `node-versatiles-svelte/scripts/bundle_worker.ts` and `BasicMap.svelte` |
| **Drag-to-draw a bbox on a map** - most of F2                                                  | `node-versatiles-svelte/.../BBoxMap/lib/bbox_drawer.ts` (227 lines)     |
| **Showing that a value differs from its default** - what makes a generated form legible        | `maplibre-versatiles-styler/src/lib/components/inputs/`                 |

The last matters most: `VPLFieldMeta` carries `is_required` but **no defaults**
([inventory](ecosystem.md)), so Studio's forms have to make "unset" and "set to the default" visually
distinct or every operation looks half-configured.

## Where a component lives, and what it is called

Two rules. The first decides the folder, the second the name, and neither does the other's job -
which is what keeps a rename from being a move.

**A component lives with what owns it**, meaning whatever imports it - not with things of the same
_kind_. `shell/` started as "chrome" and ended up holding the frame, three panes' contents, the
landing screen, the job bar and the VPL editor: twelve components with nothing in common but the
absence of a better home. Ownership is a fact you can check by grepping for the import; kind is a
judgement, and judgements drift.

```text
App.svelte            the workbench: one window, one project
Launcher.svelte       the launcher: what ⌘N opens, and what starts with nothing open (S7.5)
lib/shell/            the frame and its bar: AppShell · AlphaRibbon · Sidebar · Pane · PaneResizer · Boundary · StatusBar · JobsPanel · DiagnosticsPanel · UpdateDialog · AssetsDialog
lib/panes/sources/    SourcesPane - which graphs there are, which are drawn, and in what order (Q50)
lib/panes/pipeline/   PipelinePane and its parts: GraphList · NodeChain · NodeCard · NodeArgument · VplEditor · CropSection · ExportDialog
lib/panes/style/      StylePane
lib/panes/layers/     LayersPane · LayerRow
lib/panes/project/    CopyDialog
lib/panes/inspector/  Inspector
lib/map/              MapCanvas · MapControls · Dropdown · TileGrid · TileActivity · CoordinateJump · Views · FeaturePopup · CropOverlay
lib/common/           used by more than one owner: Help · HelpTrigger · Menu · Picker · ColorPicker · JsonTree · Modal · LandingScreen
```

A pane's folder is named for the pane, so "what uses `NodeArgument`?" is answered by its path before
anyone opens a file. `ImportCards` used to sit in `common/` on the strength of two owners - the same
cards from the same catalogue, which is the whole point of [S3.2](history.md). The launcher
dropped them for four doors sorted by _where the thing is_, and then "＋ new graph…" dropped them for
two sorted by _how the graph is written_; a component in `common/` with no owners left is a component,
so it went. The catalogue it drew on did not: it still decides what the file dialogs offer.

**A name is unique across the application**, even though the folder already scopes it. The folder
helps when reading a path; it does not help when fuzzy-finding by filename or reading the tables
below, which is how components are actually looked up. So `Argument` became `NodeArgument` and
`Chain` became `NodeChain` - both words that could mean anything - while `Pane`, `Help` and
`GraphList` were already unambiguous and stayed.

_Not_ a prefix scheme. `PipelineNodeArgument` says in the name what the path already says, pushes the
distinguishing part to the end where it is hardest to read, and has to be renamed when ownership
moves. **Folders carry ownership; names carry identity.**

## The inventory lives in the components

Every component carries a header comment saying what it is for and why it is shaped that way - which
is where that belongs, since a table here is a second copy that goes stale silently. `src/lib` is
laid out by owner, so the folder answers "what uses this" before anyone opens a file:

```text
src/App.svelte · src/Launcher.svelte   the two pages
lib/shell/                             frame: AppShell, Sidebar, Pane, StatusBar, dialogs
lib/map/                               the map surface and its overlays
lib/panes/<pane>/                      one folder per pane, named for the pane
                                       sources · pipeline · style · layers · inspector · project
lib/common/                            used by more than one owner
```

## Conventions

- **Svelte 5 runes** - `$props`, `$bindable`, `$state`, `$derived`, `$effect`. Matches every current
  repository in the org.
- **A component lives with what owns it, and its name is unique across the application** - see
  [above](#where-a-component-lives-and-what-it-is-called). Both are enforced rather than remembered:
  a test fails on a duplicate filename or a component outside the documented folders.
- **Two page roots, one per window** - `App` and `Launcher`. A third would be a third window with a
  page of its own, which is worth stopping to justify.
- **No component owns durable state.** Viewport, selection and unsaved edits live in the core
  ([Q16](decisions.md)), so a reloaded window loses nothing. Components hold view state only.
- **Presentational components take data, not services.** Anything touching IPC goes through a thin
  layer above them, so components stay testable without a Tauri runtime - the same rule the Rust core
  follows ([Q3](decisions.md)).
- **The right pane never shows global settings.** Those belong to the asset manager or project
  settings, or the pane becomes a junk drawer.

**Named by what they do, not by a name chosen in advance.** `ParamForm`, `MetadataPanel` and
`TileGridOverlay` all drifted from what shipped, and a planned `FileDrop` never happened at all -
Tauri enables drag and drop by default, which delivers S1.2 with no component.
