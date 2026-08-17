# UI Concept

> Draft. The shape is settled ([Q13](decisions.md), [Q15](decisions.md), [Q22](decisions.md));
> section detail is not. Reasoning lives in the decision log; this document is what it looks like.

## The shape

**One map surface, not four modes** ([Q22](decisions.md)). The left pane shows the chain from data to
pixels as collapsible sections, the map sits in the middle, and the right pane shows the parameters
of whatever is selected.

Studio is a workbench, not a wizard ([Q13](decisions.md)) — so the P1 risk from `audiences.md` is
accepted rather than designed around.

**The mode bar separates map work from non-map tools** — Map, and the asset manager (G7). It no
longer divides the map work itself. It arrives at S4, when there is finally something to switch to;
a one-item bar before then would be chrome that does nothing.

**It still grows one stage at a time.** Sections are added, not rebuilt:

| Stage | What appears                                                     |
| ----- | ---------------------------------------------------------------- |
| S1    | The surface, sections collapsed: map, inspector, status bar      |
| S2    | Left pane opens — Pipeline section, Graph / VPL tabs             |
| S3    | Import cards on the landing screen and "add source"              |
| S4    | Style section — layer tree; **the mode bar appears** with Assets |
| S5    | Export section — crop, format, serve                             |

The alternatives fail differently: a **node-graph-as-app** needs the graph in S1 but C1 lands in S2,
and a layer tree is not a node; a **file-tree IDE** matches [Q6](decisions.md) but sells P1 the
toolchain they came to escape; a **task-first** app needs the pipeline layer before the flows.

## Invariants

True everywhere. These matter more than the arrangement.

- **The map never disappears.** No editor goes fullscreen.
- **One `Map` instance, always.** With no modes there is nothing to switch between, so the viewport
  simply persists — this stopped being a rule and became a property ([Q22](decisions.md)).
- **Maps that are not visible are destroyed, not hidden.** WebGL allows ~16 contexts per process and
  evicts the oldest silently. Release 1 needs one map, so this is a habit to establish before B5
  adds a second.
- **Sections collapse independently and remember it.** Load-bearing, not polish: the left pane
  carries the pipeline, the style tree and export options at once, and a 13-inch laptop is the
  machine to protect ([Q22](decisions.md)).
- **Undo is global** ([Q11](decisions.md) → G6).
- **Jobs are never modal**, and the job bar expands into a drawer with a per-job log. A conversion
  that fails at minute 40 has to say why; a failed job stays until dismissed.
- **The cost estimate (C6) appears where a run is committed** — the parameters of a node about to
  execute, and beside the export button. An estimate you must go looking for is one you will not see.
- **Nothing lives only in the webview** ([Q16](decisions.md)). Viewport, selection and scroll
  position are restorable from the core, so a crashed window reloads without losing work.

## Panes and sections

Three regions, always present — **left pane, map, right pane** — over the status and job bar, with
the mode bar arriving above them at S4.

| Region         | Holds                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mode bar**   | **Map** (default) · **Assets** (G7, from S4). Locally generated glyphs (D9) are a feature of the asset manager, not a third mode ([Q9](decisions.md)) |
| **Left pane**  | The chain, as collapsible sections: **Pipeline · Style · Export**                                                                                     |
| **Map**        | The subject, the preview, and an input device for the crop rectangle (F2)                                                                             |
| **Right pane** | Parameters of the current selection, and the metadata that results from it                                                                            |

**The left pane is the chain from data to pixels.** Sources feed the pipeline, the pipeline produces
tiles, the style renders them, export writes them out. Showing it whole is the point of merging the
modes — every one of those steps used to be a mode switch away from the others.

| Section      | Contains                                                                                                                                                   | Arrives |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **Pipeline** | Graph / VPL tabs ([Q15](decisions.md)), C1 and C4. The `from_*` read nodes at its head **are** the sources — "+ Add source" adds one ([Q14](decisions.md)) | S2      |
| **Style**    | Layer tree (D3), presets (D1)                                                                                                                              | S4      |
| **Export**   | Crop, format, zoom range, estimate, serve (F1, F2)                                                                                                         | S5      |

**A `.vpl` file is a way in, like a container is** (C9). The landing screen, the file dialog, drag &
drop and the recents list all take one — a pipeline the CLI wrote has to open here, or the two tools
cannot hand work to each other. What opens is the Pipeline section, with the map previewing the
pipeline's output rather than a container's tiles.

**A node is a form, not a line of VPL.** Its parameters get one labelled field each, because the
values are routinely longer than the pane is wide — a path can easily run past 250 characters — and a
single VPL string forces a choice between wrapping, which breaks the syntax across lines, and
scrolling, which hides the parameter names. One field per parameter keeps the key visible and lets
the value scroll inside its own box. **Nothing in the pane may set its own width**: every level of
the layout pins `min-width: 0`, or one long path widens the column and pushes the map off the edge.
The pane edge is draggable, within the range `store::Layout` enforces.

**Clearing a field removes the parameter**, because VPL has no empty value
([Q23](decisions.md)) — there is no third state to fall back on.

**Collapse everything and you have what used to be Explore** — map and inspector, nothing else. That
was never an activity; it was "I am not editing right now".

**The right pane shows the parameters of the current selection, and the metadata that results from
it.** For a read node that means both its VPL fields and what the container turned out to contain —
format, real zoom range, TileJSON (A6). The two belong together: the parameters are what you set, the
metadata is what you got. It never shows global settings, or it becomes the junk drawer where every
new feature lands. Project settings open as a dialog from the
mode bar, beside the asset manager.

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

### S1 — sections collapsed

Nothing is open yet, so there is nothing to show in the chain. This is what used to be Explore.

```text
┌───────────────────────────────────────────────────────────┐
│ ≡  MyProject                                              │
├─────────────────────────────────────────┬─────────────────┤
│                                         │ INSPECTOR       │
│                  MAP                    │ format, zooms   │
│            grid overlay (A5)            │ TileJSON (A6)   │
│            feature popup (A8)           │ bookmarks (A7)  │
├─────────────────────────────────────────┴─────────────────┤
│ $ versatiles probe osm.versatiles -d              [copy]  │
└───────────────────────────────────────────────────────────┘
```

### S2 — the Pipeline section opens

Graph and VPL as tabs inside the section. A pipeline is mostly a chain, so it reads better stacked in
a narrow column than spread across a wide canvas.

```text
┌───────────────────────────────────────────────────────────┐
│ ≡  MyProject                                              │
├───────────────────┬──────────────────────┬────────────────┤
│ ▾ PIPELINE        │                      │ INSPECTOR      │
│  [Graph] [VPL ⚠]  │   MAP — selected     │ parameters of  │
│   from_geo        │        node ●        │ the selected   │
│      ↓            │                      │ node (C2),     │
│   vector_filter   │                      │ plus what it   │
│      ↓            │                      │ produced (A6)  │
│   ● preview       │                      │                │
│   + add source    │                      │                │
├───────────────────┴──────────────────────┴────────────────┤
│ Jobs ▸ idle          $ versatiles convert pipeline.vpl …  │
└───────────────────────────────────────────────────────────┘
```

Tabs, not a split — one pane is usable on a 13-inch laptop. Side by side existed to show that graph
and file agree, so the tabs owe that back: **selection survives the switch** (select a node, switch
to VPL, land on its span), **the Graph tab never shows a stale graph** (a parse failure is shown, not
the last good render), **the VPL tab carries an error badge**, and **switching is free** — both are
views over one syntax tree.

### S4 and S5 — Style and Export join the chain

Nothing moves. Two more sections appear below the ones already there, and the asset manager joins the
mode bar.

```text
┌───────────────────────────────────────────────────────────┐
│ Map │ Assets                                              │
├───────────────────┬──────────────────────┬────────────────┤
│ ▸ PIPELINE        │        MAP           │ PAINT          │
│ ▾ STYLE     (D3)  │   live style         │ colour, width, │
│   ▸ background    │     feedback         │ opacity, zoom  │
│   ▸ water         │                      │ stops,         │
│   ▸ roads         │                      │ expressions    │
│   ▸ labels        │  ┌ ─ ─ ─ ┐           │                │
│                   │  │ bbox  │      (F2) │                │
│ ▾ EXPORT          │  └ ─ ─ ─ ┘           │                │
│   .versatiles ▾   │                      │                │
│   zoom 0–14       │                      │                │
│   ~2.3 GB         │                      │                │
│   [ Export ]      │                      │                │
│   serve · QR (F1) │                      │                │
├───────────────────┴──────────────────────┴────────────────┤
│ Jobs ▸ …            $ versatiles convert --bbox … -z 14   │
└───────────────────────────────────────────────────────────┘
```

Export keeps the map as an **input device**: F2's crop is a rectangle dragged on it, not a coordinate
form. That is a map tool, not a mode — the same way a selection tool would be.

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

## State the core must own

Not because of mode switches — there are none — but because a window can crash or reload
([Q16](decisions.md)):

Map viewport · the selected source · the pipeline's selected node · which sections are collapsed ·
the global undo stack · running jobs and their logs · unsaved edits.

## Settled elsewhere

**Project settings open as a dialog from the mode bar**, beside the asset manager. They are edited
rarely and are not a selection, so a modal is honest — and it keeps the right pane's rule intact
rather than carving an exception into it.

A3 was dropped ([Q17](decisions.md)), so **release 1 has no
comparison view at all** — C3 shows one node's output on one map. B5 is the first feature needing
two, and it is post-1.0.
