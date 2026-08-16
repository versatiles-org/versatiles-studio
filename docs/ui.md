# UI Concept

> Draft. The shell, the modes and the pipeline pane are settled ([Q13](decisions.md)–[Q15](decisions.md));
> panel detail is not. Feature IDs refer to the [Feature Catalogue](features.md).

## The tension this has to resolve

`vision.md` says **"a workbench, not a wizard"** — make the concepts visible rather than hide them.
`audiences.md` says P1 journalists have _"no patience for a toolchain"_, and that _"a rough edge a
developer shrugs off will stop a journalist entirely"_. P1 is who the funded scope targets.

**Resolved by [Q13](decisions.md): Studio is a workbench.** `vision.md` stands unamended, there is
no simplified mode, and P1 is expected to cope. The P1 risk is accepted rather than designed around
— if adoption stalls there, this is the first decision to revisit.

**The shape:** one stable shell built around the map, with **modes** that reconfigure the side
panels, the **node graph inside the Pipeline mode** rather than being the whole app, and a
**landing screen** that launches new projects and then gets out of the way.

## Why this shape

Not aesthetics — build order. It is the only arrangement that grows monotonically through the stages
in [Release 1 Scope](scope-release-1.md), with each stage adding a mode and nothing being rebuilt:

| Stage | Ships                    | UI that appears                                             |
| ----- | ------------------------ | ----------------------------------------------------------- |
| 1     | Cluster A                | Landing screen; Explore mode: map, inspector, command strip |
| 2     | Node graph, VPL, preview | Mode bar appears; Pipeline mode tabs graph and text         |
| 3     | Import wizards           | Import cards join the landing screen and "add source"       |
| 4     | Style editing            | Style mode joins the bar                                    |
| 5     | Packaging                | Publish mode joins the bar                                  |

The alternatives fail this test. A **pipeline-centric** app where everything is a node needs the
graph in stage 1, but C1 lands in stage 2 — and a layer tree with paint properties is not a node, so
cluster D never fits. A **document/IDE** layout showing `project.yaml`, `pipeline.vpl` and
`style.json` as a file tree matches [Q6](decisions.md) perfectly but sells P1 exactly the toolchain
they came to escape. A **task-first** app needs the pipeline layer before the flows, so it cannot
start at stage 1 either.

## Invariants

True in every mode and every stage. These matter more than the panel arrangement:

- **The map never disappears.** Live preview is the entire pitch; no editor goes fullscreen.
- **The map viewport survives mode switches.** Changing mode must not move, zoom or reload the map —
  otherwise comparing a style change against a pipeline change is impossible. The map's _size_ does
  change between modes (Explore is widest), so the visible extent shifts; centre and zoom must not.
- **The job bar expands into a log.** E7 promises progress, cancellation _and_ a log, and a conversion
  that fails at minute 40 has to be able to say why. Clicking the bar opens a drawer listing running
  and recent jobs with their output; it is never modal, it survives mode switches, and a failed job
  stays until dismissed rather than vanishing.

**The cost estimate (C6) appears where a run is committed** — in the inspector of a node that is
about to be executed, and again beside Publish's export button. Not on a screen of its own: an
estimate the user has to go looking for is an estimate they will not see.

**One `Map` instance spans all four modes.** Modes reconfigure panels around it rather than
creating their own, so switching mode costs no WebGL context and no reload.

- **Undo is global and crosses modes** ([Q11](decisions.md) → G6). One stack, or the unified stack
  decided for stage 2 is a fiction.
- **Jobs are never modal.** E7 runs for hours. A modal progress dialog makes Studio single-tasking.
- **The command strip is persistent, not a dialog.** G2 is an architectural constraint; a menu item
  nobody clicks teaches nobody. Under the map, it teaches continuously.
- **Nothing lives only in the webview** ([Q16](decisions.md)). Viewport, selected node, active mode
  and scroll position are restorable from the core, so a crashed window reloads without losing work.
- **Maps that are not visible are destroyed, not hidden.** WebGL allows ~16 contexts per process and
  evicts the oldest silently. Release 1 needs only one map per project, so this is a habit to
  establish rather than a present constraint — B5 is the first feature that adds a second.

## Layout by stage

### Stage 1 — the landing screen

Studio has to show something when it opens with no project. Per [Q13](decisions.md) this is a
**launcher, not a wizard**: it disappears once a project is open, and everything on it is also
reachable from inside the workbench. It starts small and gains cards as clusters land — import cards
in stage 3, "start a style" in stage 4.

It is **what an empty window shows**, not a separate launcher window. Opening a project fills that
window; ⌘N opens another empty one — one window per project ([Q16](decisions.md)).

```text
┌───────────────────────────────────────────────────────────┐
│  VersaTiles Studio                                        │
│                                                           │
│  ┌───────────────────┐  ┌───────────────────┐             │
│  │ Open a tile       │  │ Open a remote     │             │
│  │ container      A1 │  │ URL            A2 │             │
│  └───────────────────┘  └───────────────────┘             │
│                                                           │
│  Recent                                             (A7)  │
│  · osm.versatiles          · berlin-hillshade/            │
│  · places.mbtiles          · MyProject/                   │
└───────────────────────────────────────────────────────────┘
```

### Stage 1 — the shell, which is Explore mode

Explore is for _looking_, so it carries no sources strip and no editor pane — the map takes the full
width and the inspector reports on what is under the cursor or selected.

```text
┌───────────────────────────────────────────────────────────┐
│ ≡  MyProject                                    assets ⚙  │
├─────────────────────────────────────────┬─────────────────┤
│                                         │ INSPECTOR       │
│                  MAP                    │ format, zooms   │
│            grid overlay (A5)            │ TileJSON (A6)   │
│            feature popup (A8)           │ bookmarks (A7)  │
├─────────────────────────────────────────┴─────────────────┤
│ $ versatiles probe osm.versatiles -d              [copy]  │
└───────────────────────────────────────────────────────────┘
```

### Stage 2 — Pipeline mode

The mode bar appears. The editor pane takes the lower half and **tabs between Graph and VPL**
([Q15](decisions.md)); the map keeps the top, because preview is what the mode is for.

```text
┌───────────────────────────────────────────────────────────┐
│ Explore │ Pipeline │                             assets ⚙ │
├────────────┬─────────────────────────────┬────────────────┤
│ SOURCES    │      MAP — previews ●       │ INSPECTOR      │
│ • places   │                             │ parameters of  │
│  (inputs)  ├─────────────────────────────┤ the selected   │
│            │ [ Graph ] [ VPL ⚠ ]         │ node, generated│
│            │  ┌────┐   ┌────┐   ┌───┐    │ from field_meta│
│            │  │geo ├──►│flt ├──►│ ● │    │ (C2)           │
│            │  └────┘   └────┘   └───┘    │                │
├────────────┴─────────────────────────────┴────────────────┤
│ Jobs ▸ idle          $ versatiles convert pipeline.vpl …  │
└───────────────────────────────────────────────────────────┘
```

Tabs, not a split — one pane is usable on a 13-inch laptop, which a split is not. But side by side
was proposed for a reason (seeing that the graph and the file agree), so the tabs owe that back:

- **Selection survives the switch.** Select a node, switch to VPL, land on its span — and back.
- **The Graph tab never shows a stale graph.** If the text does not parse, the graph shows the parse
  failure rather than the last good render.
- **The VPL tab carries an error badge** (the `⚠` above) when parsing or validation fails, so someone
  working in the graph knows the text is broken without switching.
- **Switching is free** — no reparse, no lost cursor or scroll. Both tabs are views over the same
  lossless syntax tree ([Q11](decisions.md)).

### Stage 3 — import cards

The landing screen gains import cards, and "+ Add source" opens the same set. Each card's result
**is** a pipeline — the same one the user could have typed — so there is no second UI to keep in
sync, and the escape hatch is the pipeline itself.

**There is no wizard surface.** A card opens the native file dialog, then inserts a node into the
pipeline, selects it, and hands over: the generated parameter form (C2) is the configuration UI, the
live preview (C3) is the preview, and inline errors (C4) are the validation. E1's "map columns,
choose layer name, zoom range, simplification, with a preview before the full build" is a filled-in
form beside a live map, not a sequence of dialog steps. Building a bespoke flow would mean a second
place where pipelines are authored, which is exactly what [Q11](decisions.md) argues against.

**Import needs no mode of its own, and no split by data type.** Importing is building, and building
is Pipeline mode. Splitting raster from vector would break mixed pipelines — `from_stacked_raster`
and `from_merged_vector` are first-class operations, and a hillshade under vector OSM data is one
pipeline — while adding nothing the generated form does not already handle. VPL makes no such split
either, so a mode that did would misrepresent the model.

```text
┌───────────────────────────────────────────────────────────┐
│  Add a source                                             │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐    │
│  │ Open a tile   │ │ Points from   │ │ Shapes from   │    │
│  │ container     │ │ a CSV     E2  │ │ GeoJSON   E1  │    │
│  └───────────────┘ └───────────────┘ └───────────────┘    │
│  ┌───────────────┐ ┌───────────────┐                      │
│  │ Raster / DEM  │ │ Remote URL    │   … then lands in    │
│  │ via GDAL  E3  │ │           A2  │     Pipeline mode    │
│  └───────────────┘ └───────────────┘                      │
└───────────────────────────────────────────────────────────┘
```

### Stage 4 — Style mode

The editor pane becomes a layer tree, the inspector becomes paint properties. No sources strip — you
are styling the project's output, not choosing inputs.

```text
┌───────────────────────────────────────────────────────────┐
│ Explore │ Pipeline │ Style │ Publish             assets ⚙ │
├─────────────────────────────────────────┬─────────────────┤
│                  MAP                    │ PAINT           │
│                                         │ colour, width,  │
├─────────────────────────────────────────┤ opacity, zoom   │
│ LAYER TREE (D3)                         │ stops,          │
│  ▸ water   ▸ roads   ▸ buildings        │ expressions     │
│  ▸ labels  ▸ landuse                    │                 │
├─────────────────────────────────────────┴─────────────────┤
│ Jobs ▸ …                    $ versatiles serve project/   │
└───────────────────────────────────────────────────────────┘
```

### Stage 5 — Publish mode

The map becomes an **input device**: F2's crop is a rectangle you drag on it. Nothing here is
selection-driven, so the inspector collapses rather than sitting empty.

```text
┌───────────────────────────────────────────────────────────┐
│ Explore │ Pipeline │ Style │ Publish             assets ⚙ │
├───────────────────────────────────────────────────────────┤
│              MAP — drag a rectangle to crop         (F2)  │
│            ┌ ─ ─ ─ ─ ─ ─ ─ ┐                              │
│            │   bbox        │                              │
│            └ ─ ─ ─ ─ ─ ─ ─ ┘                              │
├───────────────────────────────────────────────────────────┤
│ EXPORT  .versatiles ▾   zoom 0–14   ~2.3 GB   [ Export ]  │
│ SERVE   http://192.168.1.5:8080     [QR]            (F1)  │
├───────────────────────────────────────────────────────────┤
│ Jobs ▸ …            $ versatiles convert --bbox … --max-zoom 14 │
└───────────────────────────────────────────────────────────┘
```

## Modes and panels

Four modes. Only four things are actually constant — **mode bar, map, job bar, command strip**. That
is the whole shell; everything else is earned per mode.

| Panel             | Explore                                 | Pipeline                   | Style                   | Publish                 |
| ----------------- | --------------------------------------- | -------------------------- | ----------------------- | ----------------------- |
| **Mode bar**      | ✓                                       | ✓                          | ✓                       | ✓                       |
| **Sources**       | —                                       | **inputs to the pipeline** | —                       | —                       |
| **Map**           | the subject                             | previews the node (C3)     | live style feedback     | crop rectangle (F2)     |
| **Editor pane**   | —                                       | Graph / VPL tabs (C1, C4)  | layer tree (D3)         | export + serve (F1, F2) |
| **Inspector**     | metadata, TileJSON (A6), bookmarks (A7) | node parameters (C2)       | paint, expressions (D3) | — collapses             |
| **Job bar**       | ✓ — expands to a per-job log (E7)       | ✓                          | ✓                       | ✓                       |
| **Command strip** | ✓                                       | ✓                          | ✓                       | ✓                       |

**The sources strip belongs to Pipeline alone.** Sources are inputs to the thing being built, and
only Pipeline is building. Explore looks at the result, Style styles the result, Publish ships the
result — none of them needs a list of inputs. This supersedes the earlier reading in
[Q14](decisions.md), where the strip was shared and meant two different things depending on mode.

**Explore is the widest mode**: no sources, no editor pane, just map and inspector. Its identity is
reading rather than working, and the layout should say so.

**The inspector only ever shows properties of the current selection**, never global settings —
otherwise it becomes the junk drawer where every new feature lands. Global settings live in the asset
manager or project settings. Where nothing is selectable, as in Publish, it collapses rather than
showing an empty panel.

## State that must survive a mode switch

Naming this early, because it is the part that is expensive to retrofit:

- Map viewport — centre, zoom, bearing, pitch
- The selected source
- The pipeline's "look here" node (C3), so returning to Pipeline resumes where you were
- The global undo stack (G6)
- Running jobs and their logs
- Unsaved edits in every mode, not just the visible one

## Settled, and what is still loose

[Q13](decisions.md) settles the workbench and the landing screen, [Q14](decisions.md) keeps Explore
and Pipeline separate, and [Q15](decisions.md) makes the pipeline pane tabbed. Nothing about the
shell is open.

Removing the sources strip from three of the four modes settled most of what was loose: Explore's
missing editor pane is now deliberate rather than an oversight, Style and Publish no longer have an
undefined panel, and Publish's empty inspector collapses. Publish also turns out to earn its slot —
F2's crop is a direct-manipulation gesture on the map, not a button.

The multi-source layer stack (A3) had nowhere left to live, so [Q17](decisions.md) drops it.
Comparing two containers is two windows side by side, which [Q16](decisions.md) gives for free.

**Release 1 has no comparison view at all.** C3 is not one — it renders the selected node's output on
the map so intermediate results are visible, which is one map showing one thing. B5 (container diff)
is the first feature needing two, and it is post-1.0, so a swipe or split control can be designed
then rather than now.

One thing remains:

- **Where project settings live**, since the inspector is reserved for selection properties.
