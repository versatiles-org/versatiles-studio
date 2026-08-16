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

| Stage | Ships                    | UI that appears                                                   |
| ----- | ------------------------ | ----------------------------------------------------------------- |
| 1     | Cluster A                | Landing screen; the shell: map, sources, inspector, command strip |
| 2     | Node graph, VPL, preview | Mode bar appears; Pipeline mode tabs graph and text               |
| 3     | Import wizards           | Import cards join the landing screen and "add source"             |
| 4     | Style editing            | Style mode joins the bar                                          |
| 5     | Packaging                | Publish mode joins the bar                                        |

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
  otherwise comparing a style change against a pipeline change is impossible.
- **Undo is global and crosses modes** ([Q11](decisions.md) → G6). One stack, or the unified stack
  decided for stage 2 is a fiction.
- **Jobs are never modal.** E7 runs for hours. A modal progress dialog makes Studio single-tasking.
- **The command strip is persistent, not a dialog.** G2 is an architectural constraint; a menu item
  nobody clicks teaches nobody. Under the map, it teaches continuously.
- **Nothing lives only in the webview** ([Q16](decisions.md)). Viewport, selected node, active mode
  and scroll position are restorable from the core, so a crashed window reloads without losing work.
- **Maps that are not visible are destroyed, not hidden.** WebGL allows ~16 contexts per process and
  evicts the oldest silently, so comparison views must release their `Map` instances.

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

### Stage 1 — the shell

No modes yet. Cluster A needs exactly four regions, and they are the ones every later stage keeps.

```text
┌───────────────────────────────────────────────────────────┐
│ ≡  MyProject                                    assets ⚙  │
├────────────┬─────────────────────────────┬────────────────┤
│ SOURCES    │                             │ INSPECTOR      │
│ • osm.vt   │           MAP               │ format, zooms  │
│   places   │      grid overlay (A5)      │ TileJSON (A6)  │
│ + add …    │      feature popup (A8)     │ bookmarks (A7) │
├────────────┴─────────────────────────────┴────────────────┤
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

The landing screen gains import cards, and "+ Add source" opens the same set. Each card runs a short
flow whose result **is** a pipeline — the same one the user could have typed — so there is no second
UI to keep in sync, and the escape hatch is the pipeline itself.

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

### Stages 4 and 5 — Style and Publish

Style mode swaps the editor pane for a layer tree and the inspector for paint properties. The map
and sources do not move, so a style change can be judged against the same viewport as the pipeline
change that preceded it.

```text
┌───────────────────────────────────────────────────────────┐
│ Explore │ Pipeline │ Style │ Publish             assets ⚙ │
├────────────┬─────────────────────────────┬────────────────┤
│ SOURCES    │           MAP               │ PAINT          │
│            │                             │ colour, width, │
│            ├─────────────────────────────┤ opacity, zoom  │
│            │ LAYER TREE (D3)             │ stops          │
│            │  ▸ water        ▸ roads     │ expression     │
│            │  ▸ buildings    ▸ labels    │ editor         │
├────────────┴─────────────────────────────┴────────────────┤
│ Jobs ▸ …                    $ versatiles serve project/   │
└───────────────────────────────────────────────────────────┘
```

## Panel inventory

| Panel             | Constant?    | Carries                                                       |
| ----------------- | ------------ | ------------------------------------------------------------- |
| **Mode bar**      | from stage 2 | Explore · Pipeline · Style · Publish; asset manager (G7)      |
| **Sources**       | always       | A1, A2, A3 layer stack, A7 recents and bookmarks              |
| **Map**           | always       | The render target; A5 grid, A8 popups, C3 preview             |
| **Editor pane**   | per mode     | Graph + VPL (C1, C4) · layer tree (D3) · export options       |
| **Inspector**     | always       | Selection-driven: A6 metadata · C2 parameter forms · D3 paint |
| **Job bar**       | always       | E7 progress, cancellation, log                                |
| **Command strip** | always       | G2 — the CLI equivalent of the last action, copyable          |

The inspector is the one at risk of becoming a junk drawer. Rule: it only ever shows properties of
**the current selection**, never global settings. Global settings belong in the asset manager or
project settings.

## State that must survive a mode switch

Naming this early, because it is the part that is expensive to retrofit:

- Map viewport — centre, zoom, bearing, pitch
- Selected source, and the layer stack's visibility and opacity
- The pipeline's "look here" node (C3), so returning to Pipeline resumes where you were
- The global undo stack (G6)
- Running jobs and their logs
- Unsaved edits in every mode, not just the visible one

## Settled, and what is still loose

[Q13](decisions.md) settles the workbench and the landing screen, [Q14](decisions.md) keeps Explore
and Pipeline separate, and [Q15](decisions.md) makes the pipeline pane tabbed. Nothing about the
shell is open.

What still needs working out, at the level of panels rather than layout:

- **What the Sources panel looks like in each mode**, given Q14 makes it mean two things. The risk is
  that switching modes looks like a bug rather than a change of affordance.
- **What Publish mode actually contains.** F1 and F2 are in release 1; F3–F7 are not, so the mode may
  be thin enough to question whether it earns a slot in the bar at stage 5.
- **Where project settings live**, since the inspector is reserved for selection properties.
