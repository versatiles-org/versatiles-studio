# Svelte Components

> Draft. Written from scratch, not imported ([Q18](decisions.md)) — `@versatiles/svelte`,
> `maplibre-versatiles-styler` and `versatiles-map-editor` are references to read, not dependencies.
> Svelte 5 with runes; all JavaScript bundled at build time ([Q5](decisions.md)).

Stage IDs refer to [Release 1 Scope](scope-release-1.md); feature IDs to the
[Feature Catalogue](features.md).

## Read before writing

Three problems the org has already solved. Copying them is cheap; hitting them blind is not.

| Problem                                                                                        | Reference                                                               |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **MapLibre 6's worker breaks when bundled.** Needs a build step and an exact `maplibre-gl` pin | `node-versatiles-svelte/scripts/bundle_worker.ts` and `BasicMap.svelte` |
| **Drag-to-draw a bbox on a map** — most of F2                                                  | `node-versatiles-svelte/.../BBoxMap/lib/bbox_drawer.ts` (227 lines)     |
| **Showing that a value differs from its default** — what makes a generated form legible        | `maplibre-versatiles-styler/src/lib/components/inputs/`                 |

The last matters most here: `VPLFieldMeta` carries `is_required` but **no defaults**
([inventory](ecosystem.md)), so Studio's forms have to make "unset" and "set to the default" visually
distinct or every operation looks half-configured.

## Where a component lives, and what it is called

Two rules. The first decides the folder, the second decides the name, and neither does the other's
job — which is what keeps a rename from being a move.

**A component lives with what owns it**, meaning whatever imports it. Not with things of the same
_kind_: `shell/` started as "chrome" and ended up holding the application frame, three panes'
contents, the landing screen, the job bar and the VPL editor — twelve components with nothing in
common but the absence of a better home. Ownership is a fact you can check by grepping for the
import; kind is a judgement, and judgements drift.

```text
App.svelte            the workbench: one window, one project
Launcher.svelte       the launcher: what ⌘N opens, and what starts with nothing open (S7.5)
lib/shell/            the frame and its bar: AppShell · AlphaRibbon · Sidebar · Pane · PaneResizer · Boundary · StatusBar · JobsPanel · DiagnosticsPanel · UpdateDialog · AssetsDialog
lib/panes/pipeline/   PipelinePane and its parts: GraphList · NodeChain · NodeCard · NodeArgument · VplEditor
lib/panes/inspector/  Inspector
lib/map/              MapCanvas · MapControls · TileGrid · CoordinateJump · Views · FeaturePopup
lib/common/           used by more than one owner: Help · HelpTrigger · Picker · JsonTree · ImportCards · LandingScreen
```

A pane's folder is named for the pane, so "what uses `NodeArgument`?" is answered by its path before
anyone opens a file. `ImportCards` and `LandingScreen` sit in `common/` because they genuinely have
two owners — the landing screen and the Sources pane show the same cards from the same catalogue,
which is the whole point of [S3.2](scope-release-1.md).

**A name is unique across the application**, even though the folder already scopes it. The folder
helps when you are reading a path; it does not help when you are fuzzy-finding by filename or reading
the tables below, which is how components are actually looked up. So `Argument` became
`NodeArgument` and `Chain` became `NodeChain` — both were words that could mean anything — while
`Pane`, `Help` and `GraphList` were already unambiguous and stayed.

_Not_ a prefix scheme. `PipelineNodeArgument` says in the name what the path already says, pushes the
distinguishing part of the name to the end where it is hardest to read, and has to be renamed when
ownership moves. Folders carry ownership; names carry identity.

## The frame

**The tables below group by where a component appears on screen, not by which folder it is in** —
the folder listing above answers the other question. They list only what exists;
[Still to build](#still-to-build) covers the rest.

The five-region grid from [UI Concept](ui.md). All Studio-specific. How they are styled — the
tokens, the rules and what is enforced — is in [Styling](styling.md). A component that adds a map
layer must tag it with `role()` from `lib/map/theme.ts`, or the layer will not follow the theme.

| Component          | Does                                                                                                               | Stage |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | ----- |
| `AppShell`         | The grid: two sidebars, map, and the status bar under them                                                         | S0.1  |
| `Sidebar` + `Pane` | A sidebar renders a **list** of panes; each is foldable and its state is core-owned ([Q31](decisions.md))          | S2.2  |
| `PaneResizer`      | The draggable edge of a side pane, used on both                                                                    | S2.2  |
| `MapControls`      | Background picker, grid toggle and Reset view, over the map                                                        | S1.6  |
| `StatusBar`        | What the application is doing; progress, cancellation, and where errors land ([Q24](decisions.md))                 | S1.9  |
| `JobsPanel`        | Every job this session has run, expanded upward from the bar; opens one job's log (E7)                             | S3.1  |
| `DiagnosticsPanel` | What has gone wrong, this session and the run before it, with a report to copy into an issue (S6.8)                | S6.8  |
| `Boundary`         | One pane or the map failing instead of the window; records what it caught and offers a retry (S6.8)                | S6.8  |
| `LandingScreen`    | The ways in, the recent list and Open a project — the launcher's contents, in its own window ([Q48](decisions.md)) | S1.1  |
| `Launcher`         | The launcher window's root. Every gesture ends in a project window opening and this one closing (S7.6)             | S7.5  |
| `AlphaRibbon`      | What state this is in, across the top-right corner, linking to the repository in the system browser                | —     |
| `ImportCards`      | The ways in, from the core's catalogue; used by the landing screen and by "+ Add source" (E1–E3)                   | S3.2  |
| `CopyDialog`       | What a portable copy would carry, and whether to write it as a folder or a `.zip` (G1)                             | S5.1  |

## Map

One `Map` instance for the whole window, owned by the core ([Q16](decisions.md)).

| Component        | Does                                                                                                                                                                  | Stage |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `MapCanvas`      | Wraps MapLibre; viewport restored from the core, never from local state                                                                                               | S1.4  |
| `TileGrid`       | z/x/y grid (A5)                                                                                                                                                       | S1.7  |
| `CoordinateJump` | Jump-to-coordinate box (A5)                                                                                                                                           | S1.7  |
| `Views`          | Named views (A7): the list, and saving the camera you are on ([Q38](decisions.md))                                                                                    | S1.8  |
| `FeaturePopup`   | All attributes of the feature under the cursor (A8) — Studio's own tiles only, never the background ([Q45](decisions.md))                                             | S1.6  |
| `CropOverlay`    | The crop: everything outside it dimmed, and a drag draws a new one as a rectangle (F2, [Q44](decisions.md)). Its two overlays are `mapOverlay`s ([Q46](decisions.md)) | S5.2  |

## Left pane — the chain

| Component      | Does                                                                                                                                                                                     | Stage            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `PipelinePane` | Graph list, then the selected graph's chain, tabs and its own save/rename/export ([Q32](decisions.md))                                                                                   | S2.2             |
| `GraphList`    | The project's graphs: pin, name, unsaved dot, inline rename                                                                                                                              | S2.2             |
| `NodeChain`    | The chain of nodes; vertical, with `＋ operation…` on the rail outside them ([Q32](decisions.md))                                                                                        | S2.13            |
| `NodeCard`     | One node in the chain: its arguments, `?` docs and `×`. Every node shows all of it ([Q32](decisions.md))                                                                                 | S2.6             |
| `NodeArgument` | One argument: name, `?`, the control from `field_meta`, and a `×` unless required ([Q33](decisions.md))                                                                                  | S2.13            |
| `Help`         | The one parameter-help popover, beside the sidebar and over the map; hover peeks, click pins ([Q33](decisions.md))                                                                       | S2.13            |
| `HelpTrigger`  | The `?` that opens it — hover or focus peeks, click pins ([Q33](decisions.md))                                                                                                           | S2.13            |
| `Picker`       | `＋ operation…` and `＋ parameter…`: a filterable list, grouped, with the full text beside the row it belongs to                                                                         | S2.13            |
| `TileActivity` | Tiles the map is still waiting for, shaded and labelled `queued` or `rendering` (S2.16)                                                                                                  | S2.16            |
| `VplEditor`    | Textarea over a highlighted `<pre>`; the tokens come from the parser (C4, [Q25](decisions.md))                                                                                           | S2.3             |
| `StylePane`    | Preset and the global adjustments over it (D1) — the layer tree is S4.5                                                                                                                  | S4.2             |
| `UpdateDialog` | What came back from a check, and the Install and Restart it offers. A dialog because a menu item cannot say "Installing…" ([Q47](decisions.md)); it opens because somebody asked (G4)    | S5.8             |
| `AssetsDialog` | Font families: size, install, remove, download all. A modal, not a mode ([Q39](decisions.md)); the bundled tier is not listed, being unremovable                                         | S4.1             |
| `LayerTree`    | The rendered style's layers: search, group, hide, recolour, zoom range, and edit the filter ([Q37](decisions.md))                                                                        | S4.5             |
| `ExportDialog` | What the graph produces, what will be written, an estimate on request ([Q42](decisions.md)), then the file — modal, per graph ([Q32](decisions.md), [Q41](decisions.md))                 | S3.3, S3.6, S3.7 |
| `CropSection`  | The graph's crop: zoom range, four edges, draw-on-map, and the live estimate for it (C6, F2). Folded away by default, with a summary in its header when one is set ([Q43](decisions.md)) | S5.2, S5.4       |

## Right pane — what it turns out to be

**The parameter form moved into the node** ([Q32](decisions.md)), so this pane no longer sets
things — it reads what the pipeline turned out to be.

**The generated form carries the architecture, and it shipped as `NodeArgument`.** C2 generates
forms from `field_meta` rather than one per operation, so a single component covers all ~30 VPL
operations, upstream additions appear for free, and S3's import cards are just a `from_*` node's
form. Planned as a `ParamForm` over an `Input*` kit; built, the variants differed only in the data
handed to them, so it is one component and a `control.kind` switch. `is_sources` fields — which pick
another node — are the one control with no counterpart in any existing repo.

| Component   | Does                                                        | Stage |
| ----------- | ----------------------------------------------------------- | ----- |
| `Inspector` | Container metadata and TileJSON, viewable and editable (A6) | S1.5  |

`Bookmarks` was here until [Q38](decisions.md) renamed it `Views` and moved it onto the map: it moved
the camera, which is nothing this pane is for, and it was the only reason the pane took a `map`.

## Cross-cutting

| Component  | Does                                                                    | Stage |
| ---------- | ----------------------------------------------------------------------- | ----- |
| `JsonTree` | Any JSON, collapsible — used by `Inspector` and by `FeaturePopup`       | S1.5  |
| `Modal`    | The dialog shell: title, width, body, buttons. Used by all three modals | S5.5  |

## Still to build

Named by what they do, not by a component name chosen in advance: `ParamForm`, `MetadataPanel` and
`TileGridOverlay` all drifted from what shipped, and a planned `FileDrop` never happened at all
because Tauri's `dragDropEnabled` delivers S1.2 with no component.

| Surface | What it has to do | Stage |
| ------- | ----------------- | ----- |

## Conventions

- **Svelte 5 runes** — `$props`, `$bindable`, `$state`, `$derived`, `$effect`. Matches every current
  repository in the org.
- **A component lives with what owns it, and its name is unique across the application** — see
  [above](#where-a-component-lives-and-what-it-is-called). The second rule is enforced rather than
  remembered: a test fails when two components share a filename.
- **No component owns durable state.** Viewport, selection, mode and unsaved edits live in the core
  ([Q16](decisions.md)), so a reloaded window loses nothing. Components hold view state only.
- **Presentational components take data, not services.** Anything touching IPC goes through a thin
  layer above them, so components stay testable without a Tauri runtime — the same rule the Rust core
  follows ([Q3](decisions.md)).
- **The right pane never shows global settings.** Those belong to the asset manager or project
  settings, or the pane becomes a junk drawer.
