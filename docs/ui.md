# UI Concept

> Draft. The shell, the modes and the pipeline pane are settled
> ([Q13](decisions.md)–[Q15](decisions.md)); panel detail is not. Reasoning lives in the decision
> log; this document is what it looks like.

## The shape

One stable shell around the map, with **modes** that reconfigure the side panels, the **node graph
inside Pipeline mode** rather than as the whole app, and a **landing screen** that launches new
projects and gets out of the way.

Studio is a workbench, not a wizard ([Q13](decisions.md)) — so the P1 risk from `audiences.md` is
accepted rather than designed around.

**The shape follows build order.** It is the only arrangement that grows monotonically through the
stages, each adding a mode and rebuilding nothing:

| Stage | UI that appears                                             |
| ----- | ----------------------------------------------------------- |
| S1    | Landing screen; Explore mode: map, inspector, command strip |
| S2    | Mode bar appears; Pipeline mode tabs graph and text         |
| S3    | Import cards join the landing screen and "add source"       |
| S4    | Style mode joins the bar                                    |
| S5    | Publish mode joins the bar                                  |

The alternatives fail that test: a **node-graph-as-app** needs the graph in S1 but C1 lands in S2,
and a layer tree is not a node; a **file-tree IDE** matches [Q6](decisions.md) but sells P1 the
toolchain they came to escape; a **task-first** app needs the pipeline layer before the flows.

## Invariants

True in every mode and stage. These matter more than the panel arrangement.

- **The map never disappears.** No editor goes fullscreen.
- **Viewport survives mode switches.** Size changes between modes — Explore and Publish have no left
  pane, so the map runs wider there — which shifts the visible extent; centre and zoom must not.
- **One `Map` instance spans all four modes.** Switching costs no WebGL context and no reload.
- **Maps that are not visible are destroyed, not hidden.** WebGL allows ~16 contexts per process and
  evicts the oldest silently. Release 1 needs one map per project, so this is a habit to establish
  before B5 adds a second.
- **Undo is global and crosses modes** ([Q11](decisions.md) → G6).
- **Jobs are never modal**, and the job bar expands into a drawer with a per-job log. A conversion
  that fails at minute 40 has to say why; a failed job stays until dismissed.
- **The cost estimate (C6) appears where a run is committed** — the inspector of a node about to
  execute, and beside Publish's export button. An estimate you must go looking for is one you will
  not see.
- **The command strip is persistent, not a dialog** (G2). A menu item nobody clicks teaches nobody.
- **Nothing lives only in the webview** ([Q16](decisions.md)). Viewport, selected node, mode and
  scroll position are restorable from the core, so a crashed window reloads without losing work.

## Modes and panels

Five things are constant — **mode bar, map, right pane, job bar, command strip**. Only the **left
pane** is conditional: it appears where there is a structure to navigate.

| Pane      | Explore                       | Pipeline                  | Style                   | Publish                 |
| --------- | ----------------------------- | ------------------------- | ----------------------- | ----------------------- |
| **Left**  | —                             | Graph / VPL tabs (C1, C4) | layer tree (D3)         | —                       |
| **Map**   | the subject                   | selected node's output    | live style feedback     | crop rectangle (F2)     |
| **Right** | metadata, TileJSON, bookmarks | node parameters (C2)      | paint, expressions (D3) | export + serve (F1, F2) |

**Left is structure, right is parameters, the map is always between them.** Pipeline and Style both
have something to navigate — a chain of nodes, a stack of layers — so both get a left pane, in the
same place, doing the same job. Explore and Publish have no structure to navigate, so the map runs
wide.

**There is no sources pane.** Sources are the `from_*` read nodes at the head of the pipeline, so the
graph already shows them; a separate list duplicated them. "+ Add source" adds a read node.

**The right pane shows the parameters of what you are working on** — the container being inspected,
the selected node, the selected layer, or the export being configured — and never global settings,
or it becomes the junk drawer where every new feature lands. Global settings live in the asset
manager or project settings.

## Layouts

### Landing screen — what an empty window shows

A launcher, not a wizard: it disappears once a project is open, and everything on it is reachable
from inside the workbench. Opening a project fills that window; ⌘N opens another empty one.

```text
┌───────────────────────────────────────────────────────────┐
│  VersaTiles Studio                                        │
│  ┌───────────────────┐  ┌───────────────────┐             │
│  │ Open a tile   A1  │  │ Open a remote A2  │  + import   │
│  │ container         │  │ URL               │    cards S3 │
│  └───────────────────┘  └───────────────────┘             │
│  Recent                                             (A7)  │
│  · osm.versatiles          · MyProject/                   │
└───────────────────────────────────────────────────────────┘
```

### Explore — S1

```text
┌───────────────────────────────────────────────────────────┐
│ ≡  MyProject                                    assets ⚙  │
├─────────────────────────────────────────┬─────────────────┤
│                  MAP                    │ INSPECTOR       │
│            grid overlay (A5)            │ format, zooms   │
│            feature popup (A8)           │ TileJSON (A6)   │
├─────────────────────────────────────────┴─────────────────┤
│ $ versatiles probe osm.versatiles -d              [copy]  │
└───────────────────────────────────────────────────────────┘
```

### Pipeline — S2

Graph and VPL tabs take the left pane. A pipeline is mostly a chain, so it reads better stacked in a
narrow column than spread across a wide canvas.

```text
┌───────────────────────────────────────────────────────────┐
│ Explore │ Pipeline │                             assets ⚙ │
├───────────────────┬──────────────────────┬────────────────┤
│ [ Graph ] [ VPL ⚠]│                      │ INSPECTOR      │
│   ┌────────┐      │   MAP — selected     │ parameters of  │
│   │from_geo│      │        node ●        │ the selected   │
│   └───┬────┘      │                      │ node, from     │
│   ┌───▼────┐      │                      │ field_meta     │
│   │ filter │      │                      │ (C2)           │
│   └───┬────┘      │                      │                │
│   ┌───▼────┐      │                      │                │
│   │   ●    │      │                      │                │
│   └────────┘      │                      │                │
├───────────────────┴──────────────────────┴────────────────┤
│ Jobs ▸ idle          $ versatiles convert pipeline.vpl …  │
└───────────────────────────────────────────────────────────┘
```

Tabs, not a split — one pane is usable on a 13-inch laptop. Side by side existed to show that graph
and file agree, so the tabs owe that back: **selection survives the switch** (select a node, switch
to VPL, land on its span), **the Graph tab never shows a stale graph** (a parse failure is shown, not
the last good render), **the VPL tab carries an error badge**, and **switching is free** — both are
views over one syntax tree.

### Style — S4

The layer tree takes the left pane, in the same place the graph occupies in Pipeline.

```text
┌───────────────────────────────────────────────────────────┐
│ Explore │ Pipeline │ Style │ Publish             assets ⚙ │
├───────────────────┬──────────────────────┬────────────────┤
│ LAYER TREE   (D3) │                      │ PAINT          │
│  ▸ background     │        MAP           │ colour, width, │
│  ▸ water          │   live style         │ opacity,       │
│  ▸ landuse        │     feedback         │ zoom stops,    │
│  ▸ buildings      │                      │ expressions    │
│  ▸ roads          │                      │                │
│  ▸ labels         │                      │                │
├───────────────────┴──────────────────────┴────────────────┤
│ Jobs ▸ …                    $ versatiles serve project/   │
└───────────────────────────────────────────────────────────┘
```

### Publish — S5

The map becomes an **input device**: F2's crop is a rectangle dragged on it. Export parameters take
the right pane — the export is what you are configuring, so it belongs where parameters live.

```text
┌───────────────────────────────────────────────────────────┐
│ Explore │ Pipeline │ Style │ Publish             assets ⚙ │
├─────────────────────────────────────────┬─────────────────┤
│                                         │ EXPORT     (F2) │
│     MAP — drag a rectangle to crop      │ .versatiles ▾   │
│        ┌ ─ ─ ─ ─ ─ ─ ─ ┐                │ zoom 0–14       │
│        │     bbox      │                │ est. 2.3 GB     │
│        └ ─ ─ ─ ─ ─ ─ ─ ┘                │ [ Export ]      │
│                                         │ ─────────────── │
│                                         │ SERVE      (F1) │
│                                         │ LAN URL · QR    │
├─────────────────────────────────────────┴─────────────────┤
│ Jobs ▸ …            $ versatiles convert --bbox … -z 14   │
└───────────────────────────────────────────────────────────┘
```

## Import has no surface of its own

A card opens the native file dialog, inserts a node into the pipeline and selects it. The generated
form (C2) is the configuration UI, the live preview (C3) is the preview, inline errors (C4) are the
validation. E1's "map columns, layer name, zoom range, simplification, with a preview" is a filled-in
form beside a live map, not a dialog sequence — a bespoke flow would be a second place where
pipelines are authored.

**No mode of its own, and no split by data type.** Importing is building, and building is Pipeline.
Splitting raster from vector would break mixed pipelines — `from_stacked_raster` and
`from_merged_vector` are first-class, and a hillshade under vector OSM is one pipeline — while adding
nothing the generated form does not handle. VPL makes no such split either.

## State that must survive a mode switch

Map viewport · the selected source · the pipeline's selected node · the global undo stack · running
jobs and their logs · unsaved edits in every mode, not just the visible one.

## Still loose

**Where project settings live**, since the inspector is reserved for selection properties.

A3 was dropped ([Q17](decisions.md)), so **release 1 has no
comparison view at all** — C3 shows one node's output on one map. B5 is the first feature needing
two, and it is post-1.0.
