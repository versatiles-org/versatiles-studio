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
lib/shell/            the frame: AppShell · Sidebar · Pane · PaneResizer · StatusBar · JobsPanel
lib/panes/pipeline/   PipelinePane and its parts: GraphList · NodeChain · NodeCard · NodeArgument · VplEditor
lib/panes/inspector/  Inspector · Bookmarks
lib/panes/output/     PipelineOutput
lib/map/              MapCanvas · MapControls · TileGrid · CoordinateJump · FeaturePopup
lib/common/           used by more than one owner: Help · HelpTrigger · Picker · JsonTree · ImportCards · LandingScreen
```

A pane's folder is named for the pane, so "what uses `NodeArgument`?" is answered by its path before
anyone opens a file. `ImportCards` and `LandingScreen` sit in `common/` because they genuinely have
two owners — the landing screen and the Pipeline pane show the same cards from the same catalogue,
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

| Component          | Does                                                                                                      | Stage |
| ------------------ | --------------------------------------------------------------------------------------------------------- | ----- |
| `AppShell`         | The grid: two sidebars, map, and the status bar under them                                                | S0.1  |
| `Sidebar` + `Pane` | A sidebar renders a **list** of panes; each is foldable and its state is core-owned ([Q31](decisions.md)) | S2.2  |
| `PaneResizer`      | The draggable edge of a side pane, used on both                                                           | S2.2  |
| `MapControls`      | Background picker, grid toggle and Reset view, over the map                                               | S1.6  |
| `StatusBar`        | What the application is doing; progress, cancellation, and where errors land ([Q24](decisions.md))        | S1.9  |
| `JobsPanel`        | Every job this session has run, expanded upward from the bar; opens one job's log (E7)                    | S3.1  |
| `LandingScreen`    | What an empty window shows                                                                                | S1.1  |
| `PipelineOutput`   | What the pipeline produces: format, zoom, layers and their property keys (Q22)                            | S3.3  |
| `ImportCards`      | The ways in, from the core's catalogue; used by the landing screen and by "+ Add source" (E1–E3)          | S3.2  |

## Map

One `Map` instance for the whole window, owned by the core ([Q16](decisions.md)).

| Component        | Does                                                                    | Stage |
| ---------------- | ----------------------------------------------------------------------- | ----- |
| `MapCanvas`      | Wraps MapLibre; viewport restored from the core, never from local state | S1.4  |
| `TileGrid`       | z/x/y grid (A5)                                                         | S1.7  |
| `CoordinateJump` | Jump-to-coordinate box (A5)                                             | S1.7  |
| `FeaturePopup`   | All attributes of the feature under the cursor (A8)                     | S1.6  |

## Left pane — the chain

| Component      | Does                                                                                                               | Stage      |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| `PipelinePane` | Graph list, then the selected graph's chain, tabs and its own save/rename/export ([Q32](decisions.md))             | S2.2       |
| `GraphList`    | The project's graphs: pin, name, unsaved dot, inline rename                                                        | S2.2       |
| `NodeChain`    | The chain of nodes; vertical, with `＋ operation…` on the rail outside them ([Q32](decisions.md))                  | S2.13      |
| `NodeCard`     | One node in the chain: its arguments, `?` docs and `×`. Every node shows all of it ([Q32](decisions.md))           | S2.6       |
| `NodeArgument` | One argument: name, `?`, the control from `field_meta`, and a `×` unless required ([Q33](decisions.md))            | S2.13      |
| `Help`         | The one parameter-help popover, beside the sidebar and over the map; hover peeks, click pins ([Q33](decisions.md)) | S2.13      |
| `HelpTrigger`  | The `?` that opens it — hover or focus peeks, click pins ([Q33](decisions.md))                                     | S2.13      |
| `Picker`       | `＋ operation…` and `＋ parameter…`: a filterable list, grouped, with the full text beside the row it belongs to   | S2.13      |
| `TileActivity` | Tiles the map is still waiting for, shaded and labelled `queued` or `rendering` (S2.16)                            | S2.16      |
| `VplEditor`    | Textarea over a highlighted `<pre>`; the tokens come from the parser (C4, [Q25](decisions.md))                     | S2.3       |
| `StylePane`    | Preset and the global adjustments over it (D1) — the layer tree is S4.5                                            | S4.2       |
| `ExportDialog` | Format, zoom range and numeric bounds — modal, per graph ([Q32](decisions.md)); carries the cost estimate (C6)     | S3.6, S3.7 |

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
| `Bookmarks` | Saved views of the map (A7)                                 | S1.8  |

## Cross-cutting

| Component  | Does                                                              | Stage |
| ---------- | ----------------------------------------------------------------- | ----- |
| `JsonTree` | Any JSON, collapsible — used by `Inspector` and by `FeaturePopup` | S1.5  |

## Still to build

Named by what they do, not by a component name chosen in advance: `ParamForm`, `MetadataPanel` and
`TileGridOverlay` all drifted from what shipped, and a planned `FileDrop` never happened at all
because Tauri's `dragDropEnabled` delivers S1.2 with no component.

| Surface       | What it has to do                                                   | Stage      |
| ------------- | ------------------------------------------------------------------- | ---------- |
| Mode bar      | **Map** vs non-map tools — assets (G7), where D9 and D10 live (Q22) | S4.1       |
| Asset manager | Font families and sprite sets: install, pin, verify, remove (G7)    | S4.1       |
| Layer tree    | Style layers with visibility, selection, paint and expressions (D3) | S4.5       |
| Style export  | `style.json`, `@versatiles/style` code, or a bundle (D8)            | S4.6       |
| Crop overlay  | Drag a rectangle on the map to crop (F2) — port `BBoxDrawer`        | S5.2, S5.4 |
| Serve panel   | Local server, LAN URL and a QR code for testing on a phone (F1)     | S5.3       |
| Command strip | The CLI command, serve config or Action that reproduces this (C7)   | S5.5       |

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
