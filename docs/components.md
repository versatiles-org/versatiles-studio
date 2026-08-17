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

## Shell

The five-region grid from [UI Concept](ui.md). All Studio-specific. How they are styled — the
tokens, the rules and what is enforced — is in [Styling](styling.md). A component that adds a map
layer must tag it with `role()` from `lib/map/theme.ts`, or the layer will not follow the theme.

| Component                     | Does                                                                                                                      | Stage |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----- |
| `AppShell`                    | The grid: mode bar, left pane, map, right pane, status and job bar                                                        | S0.1  |
| `ModeBar`                     | **Map** vs non-map tools — assets (G7), which is where generated glyphs (D9) and sprites (D10) live ([Q22](decisions.md)) | S4.1  |
| `LeftPane` + `PaneSection`    | The chain as collapsible sections; collapse state is core-owned                                                           | S2.2  |
| `VplEditor`                   | Textarea over a highlighted `<pre>`; the tokens come from the parser ([Q25](decisions.md))                                | S2.3  |
| `PaneResizer`                 | The draggable edge of a side pane, used on both                                                                           | S2.2  |
| `RightPane`                   | Parameters of the current selection                                                                                       | S1.4  |
| `JobBar` + `JobDrawer`        | Progress and cancellation; expands to a per-job log (E7)                                                                  | S3.1  |
| `StatusBar`                   | What the application is doing; progress, and where errors land ([Q24](decisions.md))                                      | S1.9  |
| `LandingScreen`, `LaunchCard` | What an empty window shows; gains import cards at S3                                                                      | S1.1  |

## Map

One `Map` instance for the whole window, owned by the core ([Q16](decisions.md)).

| Component         | Does                                                                    | Stage |
| ----------------- | ----------------------------------------------------------------------- | ----- |
| `MapCanvas`       | Wraps MapLibre; viewport restored from the core, never from local state | S1.4  |
| `TileGridOverlay` | z/x/y grid (A5)                                                         | S1.7  |
| `CoordinateJump`  | Jump-to-coordinate box (A5)                                             | S1.7  |
| `FeaturePopup`    | All attributes of the feature under the cursor (A8)                     | S1.6  |
| `CropOverlay`     | Drag a rectangle to crop (F2) — port `BBoxDrawer`                       | S5.4  |

## Left pane — the chain

| Component      | Does                                                               | Stage |
| -------------- | ------------------------------------------------------------------ | ----- |
| `PipelinePane` | Graph / VPL tabs, selection synced between them, error badge (Q15) | S2.5  |
| `NodeGraph`    | The chain of nodes; vertical, because pipelines are mostly linear  | S2.5  |
| `NodeCard`     | One operation: name, ports, selected and error states              | S2.5  |
| `VplEditor`    | Text over the syntax tree, with a marker gutter (C4)               | S2.3  |
| `LayerTree`    | Style layers with visibility and selection (D3)                    | S4.5  |

## Right pane — parameters

**`ParamForm` is the component that carries the architecture.** C2 generates forms from
`field_meta` rather than hand-writing one per operation, so this single component covers all ~30 VPL
operations, new upstream operations appear for free, and S3's import cards are just a `from_*` node's
form. Getting it right delivers a large slice of S2 and S3 at once.

| Component                                                                    | Does                                                        | Stage |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- | ----- |
| `ParamForm`                                                                  | Renders `VPLFieldMeta[]` into controls                      | S2.6  |
| `InputText` · `InputNumber` · `InputCheckbox` · `InputSelect` · `InputColor` | The control kit, each with a default-aware state            | S2.6  |
| `InputStringList`                                                            | Array-typed fields                                          | S2.6  |
| `InputSourceRef`                                                             | Fields where `is_sources` is set — picks another node       | S2.6  |
| `MetadataPanel`                                                              | Container metadata and TileJSON, viewable and editable (A6) | S1.5  |
| `PaintPanel` + `ExpressionEditor`                                            | Colour, width, opacity, zoom stops (D3)                     | S4.5  |
| `ExportPanel`                                                                | Format, zoom range, estimate, and the serve toggle (F1, F2) | S5.2  |

`InputSourceRef` has no counterpart in any existing repo — it is the one control that only makes
sense inside a pipeline editor.

## Cross-cutting

| Component       | Does                                                             | Stage |
| --------------- | ---------------------------------------------------------------- | ----- |
| `Dialog`        | Modal shell — for confirmations, never for jobs or progress      | S0.1  |
| `FileDrop`      | Drag & drop target feeding the same path as the file dialog      | S1.2  |
| `ProgressBar`   | Determinate and indeterminate                                    | S3.1  |
| `CopyButton`    | Used by the command strip and by C7's exports                    | S1.9  |
| `AssetPanel`    | Font families and sprite sets: install, pin, verify, remove (G7) | S4.1  |
| `QrCode`        | LAN URL for testing on a phone (F1)                              | S5.3  |
| `EstimateBadge` | "~40 min, ~2.3 GB", shown where a run is committed (C6)          | S3.7  |

## Conventions

- **Svelte 5 runes** — `$props`, `$bindable`, `$state`, `$derived`, `$effect`. Matches every current
  repository in the org.
- **No component owns durable state.** Viewport, selection, mode and unsaved edits live in the core
  ([Q16](decisions.md)), so a reloaded window loses nothing. Components hold view state only.
- **Presentational components take data, not services.** Anything touching IPC goes through a thin
  layer above them, so components stay testable without a Tauri runtime — the same rule the Rust core
  follows ([Q3](decisions.md)).
- **The right pane never shows global settings.** Those belong to the asset manager or project
  settings, or the pane becomes a junk drawer.
