# UI Concept

> Reasoning lives in the [decision log](decisions.md); this document is what it looks like.

## The shape

| Stage | What appears                                                                |
| ----- | --------------------------------------------------------------------------- |
| S1    | The surface, sections collapsed: map, inspector, status bar                 |
| S2    | Left pane opens - Pipeline section, Graph / VPL tabs                        |
| S3    | Import cards on the landing screen and "add source"                         |
| S4    | Style pane - layer tree and its own export                                  |
| S5    | Crop, estimate and serve join the panes that own them ([Q31](decisions.md)) |
| S6    | The style pane says what it is looking at, and draws every kind of tileset  |
| S7    | The launcher becomes a window; the in-window chrome goes to the menu        |

**One map surface, not four modes** ([Q22](decisions.md)). The left pane shows the chain from data to pixels as collapsible sections, the map sits in the middle, and the right pane shows what the pipeline and the opened container turn out to be. Parameters are not there: since [Q32](decisions.md) every node carries its own arguments in the chain.

Studio is a workbench, not a wizard ([Q13](decisions.md)) - so the P1 risk from `audiences.md` is accepted rather than designed around.

## Invariants

True everywhere. These matter more than the arrangement.

- **The map never disappears.** No editor goes fullscreen.
- **One `Map` instance, always.** With no modes there is nothing to switch between, so the viewport
  simply persists - this stopped being a rule and became a property ([Q22](decisions.md)).
- **Maps that are not visible are destroyed, not hidden.** WebGL allows ~16 contexts per process and
  evicts the oldest silently. Release 1 needs one map, so this is a habit to establish before B5
  adds a second.
- **Sections collapse independently and remember it.** Load-bearing, not polish: the left pane
  carries the pipeline, the style, the layer tree and export options at once, and a 13-inch laptop
  is the machine to protect ([Q22](decisions.md)).
- **Undo is global** ([Q11](decisions.md) → G6).
- **Jobs are never modal**, and the job bar expands into a drawer with a per-job log. A conversion
  that fails at minute 40 has to say why; a failed job stays until dismissed.
- **The cost estimate (C6) appears where a run is committed** - the parameters of a node about to
  execute, and beside the export button. An estimate you must go looking for is one you will not see.
- **Nothing durable lives only in the webview** ([Q16](decisions.md)). The map camera, the graphs
  and their text, and the pane layout all come back from the core, so a reloaded window is looking
  where it was. **Scroll position** deliberately stays in the webview
  ([Q35](decisions.md#q35---a-graphs-name-is-chosen-once)):
  both cost a gesture to restore, not work.

## Panes and sections

| Region         | Holds                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Left pane**  | The chain, as collapsible sections: **Sources · Pipeline · Style · Layers**                                                                                              |
| **Map**        | The subject, the preview, an input device for the crop rectangle (F2), and the controls that move the camera - coordinate jump and named views (A7, [Q38](decisions.md)) |
| **Right pane** | What things turn out to be - the pipeline's output, and an opened container's own metadata. Not parameters ([Q32](decisions.md))                                         |

| Pane          | Contains                                                                                                                                                                                                                                                                                                                       | Arrives |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| **Sources**   | What data exists: one row per graph, the eye that says whether it is drawn, the name, how much of it runs. A set, not a stack - order lives in Layers ([Q62](decisions.md)). `＋ new graph…` opens its two doors here                                                                                                          | S2      |
| **Pipeline**  | The selected graph's chain, with Graph / VPL tabs ([Q15](decisions.md)), C1 and C4, its crop, and what it writes ([Q50](decisions.md))                                                                                                                                                                                         | S2      |
| **Style**     | How one source is drawn: preset and the adjustments over it (D1), and its own export (D8). The core owns the **recipe** it is rendered from, not the style ([Q36](decisions.md)). The layer tree left for Layers ([Q62](decisions.md))                                                                                         | S4      |
| **Layers**    | What the map paints: every source's layers in paint order, as categories over runs ([Q63](decisions.md)). Where the eyes (D3, [Q64](decisions.md)) and the arranging are, and the only place order lives                                                                                                                       | S4      |
| **Inspector** | Both sides of the selected graph, in the order the pipeline runs: the containers it reads, folded, then what it produced, open. Each with its metadata and TileJSON (A6). The eyes choose where in the chain the result is read from ([Q49](decisions.md)). Nothing else - no way in, and no named views ([Q38](decisions.md)) | S1      |

Three regions, always present - **left pane, map, right pane** - over the status and job bar. What is about Studio or the project is in the native menu above all of them, not in the window ([Q47](decisions.md)).

**The left pane is the chain from data to pixels.** Sources feed the pipeline, the pipeline produces tiles, the style says how each source is drawn, and the layers say in what order they are painted - steps that used to be a mode switch apart, which is the point of merging the modes.

**The sources list says what data exists; the layers list says what is painted** ([Q62](decisions.md)). One row per graph, an eye that says whether it is drawn, and a highlight that says which one you are editing - two questions, kept apart: a graph you cannot see is still one you can work on. Inside a graph, each node has an eye of its own saying whether that operation runs.

**A source is not a place on the map.** Its layers are, and they need not be together: the Layers pane holds one ordered list over every source, so a data visualisation can sit between a basemap's roads and its labels. Moving a run there is the only way the stack is arranged, and clicking one selects its source, so Pipeline and Style follow what was clicked.

**A switched-off node is a ghost, not a gap.** It keeps its place and its form, and the pipe runs _through_ it: the nodes after it carry on, because a bypass is not a truncation. That is what lets one branch of a `from_stacked` leave the bracket while the composite and everything after it keep running. Two eyes cannot be switched off - the node a chain starts with, which is the graph's own switch, and the last source a composite has. Both eyes are remembered in `project.yaml` beside the crop, and neither is written into the `.vpl`: that file stays the pipeline every tool runs. Containers are inputs; the map never shows one directly.

## Layouts

### Launcher - a window of its own

```text
┌────────────────────────────────────────────────────────────┐
│  ◆  VersaTiles Studio                                      │
│                                                            │
│  START                      RECENT                         │
│  Open a local file      (A1) osm.versatiles       2 h ago  │
│  Tile container · Vector…    MyProject/          yesterday │
│  …or drop a file anywhere    berlin.vpl           3 d ago  │
│  Open a remote file     (A2) …                             │
│  HTTPS or SFTP                                             │
│  Open a project folder  (G1)                               │
│  pipelines, style, manifest                                │
│  ──────────────────────                                    │
│  New empty project                                         │
│  A window with nothing in it yet                           │
│                                                            │
│  VersaTiles Studio 0.2.0 · alpha · github                  │
└────────────────────────────────────────────────────────────┘
```

A launcher, not a wizard: everything on it is reachable from inside the workbench, and nothing on it gates anything. It opens when Studio starts with nothing to open and when ⌘N asks for a project, and it closes the moment something is opened from it ([Q48](decisions.md#q48---a-window-is-a-project), [S7.5](history.md)).

It was an overlay inside a project window until [S7.9](history.md), which made a window two different things depending on whether it happened to hold any graphs. A project window between documents now says one quiet line - where the way in is - rather than becoming a launcher.

### S1 - sections collapsed

```text
┌───────────────────────────────────────────────────────────┐
│ ≡  MyProject                                              │
├─────────────────────────────────────────┬─────────────────┤
│ [Views ▾] [reset] (A7)                  │ INSPECTOR       │
│ [z/x/y or lat,lng] (A5)   MAP           │ format, zooms   │
│ [No background ▾]                       │ TileJSON (A6)   │
│ [grid] [- z14 +]       feature popup    │                 │
│                                    (A8) │                 │
├─────────────────────────────────────────┴─────────────────┤
│ $ versatiles probe osm.versatiles -d              [copy]  │
└───────────────────────────────────────────────────────────┘
```

Nothing is open yet, so there is nothing to show in the chain. Collapse every section later and you are back here - which is what used to be a whole Explore mode, and was never an activity so much as "I am not editing right now".

### S2 - the Pipeline section opens

```text
┌───────────────────────────────────────────────────────────┐
│ ≡  MyProject                                              │
├───────────────────┬──────────────────────┬────────────────┤
│ ▾ PIPELINE        │                      │ INSPECTOR      │
│  [Graph] [VPL ⚠]  │   MAP - selected     │ what the node  │
│   from_geo        │        node ●        │ produced (A6): │
│      ↓            │                      │ format, zooms, │
│   vector_filter   │                      │ TileJSON       │
│      ↓            │                      │                │
│   ● preview       │                      │                │
│   + add source    │                      │                │
├───────────────────┴──────────────────────┴────────────────┤
│ Jobs ▸ idle          $ versatiles convert pipeline.vpl …  │
└───────────────────────────────────────────────────────────┘
```

Graph and VPL as tabs inside the section. A pipeline is mostly a chain, so it reads better stacked in a narrow column than spread across a wide canvas.

Tabs, not a split - one pane is usable on a 13-inch laptop. Side by side existed to show that graph and file agree, so the tabs owe that back; [Q15](decisions.md#q15---the-pipeline-pane-tabs-graph-and-text) lists the four debts and this is where they are paid.

### S4 onward - Style and Layers join the chain

```text
┌───────────────────────────────────────────────────────────┐
│ ≡  MyProject                                              │
├───────────────────┬──────────────────────┬────────────────┤
│ ▾ PIPELINE        │        MAP           │ ▾ INSPECTOR    │
│   ◉ basemap    •  │   live style over    │ format, zooms  │
│   ◉ hillshade 3/5 │   every graph that   │ TileJSON (A6)  │
│   ◌ places        │   is switched on     │                │
│   ＋ new graph…    │                      │                │
│  ─────────────    │  ┌ ─ ─ ─ ┐           │                │
│   Graph │ VPL     │  │ live  │      (C3) │                │
│   from_geo  ⌄.geo │  └ ─ ─ ─ ┘           │                │
│   ◉ vector_filter │                      │                │
│     filter  ? …   │                      │                │
│     ＋ parameter…  │                      │                │
│   ╰ ＋ operation…  │                      │                │
│   [Save][Export]  │                      │                │
│ ▾ STYLE      (D1) │                      │                │
│   [Colorful] …    │                      │                │
│   [Export style]  │                      │                │
│ ▾ LAYERS     (D3) │                      │                │
│  ▸◉ basemap  324↑↓│                      │                │
│  ▸◉ places     2↑↓│                      │                │
├───────────────────┴──────────────────────┴────────────────┤
│ Jobs (1) ▸        Writing basemap.versatiles - 47%  Cancel │
└───────────────────────────────────────────────────────────┘
```

Nothing moves. More panes appear below the ones already there, and the asset manager opens as a dialog over them ([Q39](decisions.md)). Export is not among them: it belongs to the pane whose output it writes ([Q31](decisions.md)), and to the graph that produced it ([Q32](decisions.md)). Opening, saving and fonts are in the menu rather than in a strip along the top ([Q47](decisions.md)).

The full drawing, including the export modal, is the [wireframe](https://claude.ai/code/artifact/69159dd5-bfb3-4619-bbee-eb5a5c15497a).

## Import has no surface of its own

"＋ new graph…" offers two doors - **from VPL node**, which picks the `from_*` the chain begins with, and **from VPL file**, which opens a `.vpl` someone already wrote. Either **creates a graph** and selects it. Everything after that is the node's own form: the generated fields are the wizard (C2), with a file picker on every path parameter, the live preview (C3) is the preview, inline errors (C4) are the validation. E1's "map columns, layer name, zoom range, simplification, with a preview" is a filled-in form beside a live map, not a dialog sequence - a bespoke flow would be a second place where pipelines are authored.

**No mode of its own, and no split by data type.** Importing is building, and building is Pipeline. Splitting raster from vector would break mixed pipelines - `from_stacked_raster` and `from_merged_vector` are first-class, and a hillshade under vector OSM is one pipeline - while adding nothing the generated form does not handle. VPL makes no such split either.

## State the core must own

Not because of mode switches - there are none - but because a window can crash or reload ([Q16](decisions.md)). **Per window, because a window is a project** ([Q48](decisions.md)):

Map camera · the graphs and their text · the sources they read · which panes are open and how wide · the undo stack · the jobs that project has run · unsaved edits.

## Settled elsewhere

**Project settings open as a dialog from the menu**, beside the asset manager - which [Q39](decisions.md) made a dialog too, for the same reason. They are edited rarely and are not a selection, so a modal is honest - and it keeps the right pane's rule intact rather than carving an exception into it.

A3 was dropped ([Q17](decisions.md)), so **release 1 has no comparison view at all** - C3 shows one node's output on one map. B5 is the first feature needing two, and it is post-1.0.
