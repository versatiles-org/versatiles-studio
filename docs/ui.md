# UI Concept

> Reasoning lives in the [decision log](decisions.md); this document is what it looks like.

## The shape

**One map surface, not four modes** ([Q22](decisions.md)). The left pane shows the chain from data to
pixels as collapsible sections, the map sits in the middle, and the right pane shows what the
pipeline and the opened container turn out to be. Parameters are not there: since
[Q32](decisions.md) every node carries its own arguments in the chain.

Studio is a workbench, not a wizard ([Q13](decisions.md)) — so the P1 risk from `audiences.md` is
accepted rather than designed around.

**There is one surface, and no modes** ([Q39](decisions.md)). [Q22](decisions.md) kept a mode bar to
separate map work from non-map tools, with the asset manager (G7) as the second occupant that made it
worth having; making that an errand-shaped **dialog** took the occupant away, and a one-item bar is
chrome that does nothing. An application bar took its place for two releases and then went the same
way: what is about Studio or the project belongs in the **native menu**, which is where a person
looks for it and the only place that gets accelerators and platform conventions for free
([Q47](decisions.md)).

**A window is a project** ([Q48](decisions.md)). ⌘N opens the launcher, which is a window of its own;
picking something there opens a project window and closes the launcher.

**It still grows one stage at a time.** Sections are added, not rebuilt:

| Stage | What appears                                                                |
| ----- | --------------------------------------------------------------------------- |
| S1    | The surface, sections collapsed: map, inspector, status bar                 |
| S2    | Left pane opens — Pipeline section, Graph / VPL tabs                        |
| S3    | Import cards on the landing screen and "add source"                         |
| S4    | Style pane — layer tree and its own export                                  |
| S5    | Crop, estimate and serve join the panes that own them ([Q31](decisions.md)) |
| S6    | The style pane says what it is looking at, and draws every kind of tileset  |
| S7    | The launcher becomes a window; the in-window chrome goes to the menu        |

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
- **The cost estimate (C6) is asked for, where the run is committed** ([Q42](decisions.md)). It runs
  the real pipeline for up to two seconds and is not cached, so the export dialog offers it rather
  than spending that on every opening — and the answer replaces the button directly above the control
  that commits. This is the one place it appears; the crop section shows what will be written, not
  what it will cost, and is folded away until wanted ([Q43](decisions.md)).
- **Nothing durable lives only in the webview** ([Q16](decisions.md)). The map camera, the graphs
  and their text, and the pane layout all come back from the core, so a reloaded window is looking
  where it was. **Scroll position** deliberately stays in the webview
  ([Q35](decisions.md#q35--a-graphs-name-is-chosen-once-and-the-core-remembers-work-rather-than-cursors)):
  both cost a gesture to restore, not work.

## Panes and sections

Three regions, always present — **left pane, map, right pane** — over the status and job bar. What is
about Studio or the project is in the native menu above all of them, not in the window
([Q47](decisions.md)).

| Region         | Holds                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Left pane**  | The chain, as collapsible sections: **Pipeline · Style · Export**                                                                                                        |
| **Map**        | The subject, the preview, an input device for the crop rectangle (F2), and the controls that move the camera — coordinate jump and named views (A7, [Q38](decisions.md)) |
| **Right pane** | What things turn out to be — the pipeline's output, and an opened container's own metadata. Not parameters ([Q32](decisions.md))                                         |

**The left pane is the chain from data to pixels.** Sources feed the pipeline, the pipeline produces
tiles, the style renders them, export writes them out — steps that used to be a mode switch apart,
which is the point of merging the modes.

**The bar along the bottom says what is happening** ([Q24](decisions.md)): a failure, a running job
with its speed and what is left of it, or — when neither needs the row — how many tiles the map is
still waiting for, split into **queued** and **rendering** (S2.16). Those tiles are also shaded on
the map itself, labelled with which of the two they are, so a slow operation can be seen where it is
slow rather than only counted. Neither appears until the wait has lasted long enough to be worth
mentioning; a pipeline that keeps up says nothing at all.

**Panes, not fixed sections** ([Q31](decisions.md)). Each sidebar renders a list of panes — id,
title, foldable — so an analysis surface is a list entry rather than an argument about which section
it belongs to. Reordering them by hand is deferred until there are enough to be worth rearranging.

**Each pane owns what it emits.** There is no Export pane: tiles are exported from Pipeline, the
style from Style. "Export" named a shared destination that turned out not to be one — which is how
D8 came to have no home at all under [Q22](decisions.md).

| Pane          | Contains                                                                                                                                                                                 | Arrives |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **Pipeline**  | A list of graphs, then the selected graph's chain with Graph / VPL tabs ([Q15](decisions.md)), C1 and C4. Each graph saves, renames and exports on its own ([Q32](decisions.md))         | S2      |
| **Style**     | Preset and the adjustments over it (D1) today; the layer tree (D3) and its own export (D8) follow. The core owns the **recipe** it is rendered from, not the style ([Q36](decisions.md)) | S4      |
| **Inspector** | An opened container's own metadata and TileJSON (A6). Nothing else — no way in, and no named views ([Q38](decisions.md))                                                                 | S1      |

There is **no Parameters pane**: every node carries its own arguments in the chain ([Q32](decisions.md)). A parameter's documentation opens beside the sidebar rather than inside the node, and required parameters are shown empty rather than marked with a symbol ([Q33](decisions.md)).

**A graph is a named VPL document producing one named tile source** ([Q32](decisions.md#q32--a-project-holds-several-named-graphs-and-every-node-is-a-form)), and that one name is
the server mount, the `style.json` source and the `.vpl` filename at once. Every graph is served, so
that from S4 a style can name them all; **one node, in one graph, may be pinned** to override the
map — the debugging view C3 describes.

**Double-clicking a file opens it.** Studio owns `.versatiles`, `.mbtiles`, `.pmtiles` and `.vpl`,
declared as exported UTIs so the types belong to it rather than being borrowed. The two platforms
deliver the path differently and [Architecture](architecture.md) says how; either way a file that
arrived before there was a window is not lost.

**A `.vpl` file is a way in, like a container is** (C9). The landing screen, the file dialog, drag &
drop and the recents list all take one — a pipeline the CLI wrote has to open here, or the two tools
cannot hand work to each other. What opens is the Pipeline section, with the map previewing the
pipeline's output rather than a container's tiles.

**Saving a pipeline lives in the Pipeline section**, because that is its scope: it writes the
pipeline as the `.vpl` the CLI already reads. Saving a _project_ — the manifest, the style and the
pipelines as a directory (G1) — is a different command with a different scope, and lives in the File
menu with ⌘S on it ([Q47](decisions.md)). One writes a file, the other a folder; they are not two
spellings of one thing, and the shortcut names the one people mean.

**Paths inside a `.vpl` file resolve against that file**, the way `versatiles convert` resolves them:
`from_container filename="berlin.mbtiles"` means the one beside it. Opening a pipeline therefore
moves what every later relative path means, which is why the containers it names are found at all.

**The map's own controls sit together**, bottom right: the background picker, the z/x/y grid (A5)
and Reset view, which returns the camera to the extent of what is open. What belongs there is
anything about _looking_ at the result; what the result **is** belongs in the left pane.

**The background map is off by default and generated, not fetched.** Studio draws what a pipeline
produces, which on its own floats over nothing — a background gives it something to sit on.
`@versatiles/style` builds the style locally so its **tiles** come from `tiles.versatiles.org` while
its **sprites and glyphs come from Studio's own server**, which already has them ([Q9](decisions.md));
a hosted style JSON would have brought its own asset URLs and put every font and icon on the network
too. Choosing one is the user asking for remote data, explicitly — G5 promises Studio works with no
network once its assets are installed, and off is the default that keeps that true.

**A format the map cannot draw says so.** Only `mvt` and the image formats can be rendered;
`bin` — which is what a container reports when its format could not be determined — along with
`json`, `geojson`, `topojson` and `svg` cannot. Those are named in the status bar rather than left as
a blank map.

**The map shows what the pipeline produces, not the file that feeds it** (C3). Pinning a node runs
the pipeline **up to and including it** and mounts the result, so tightening a filter changes the
tiles rather than a number in a form. A node inside a `[ … ]` block previews that block's own chain,
which is the reason to pin one. With nothing pinned the map draws every graph the project serves.
The chain says which half of itself is running: the part feeding the pin wears the accent, the rest
a separator's colour. Containers are inputs; the map never shows one directly.

**Undo is one stack for the whole document** (G6). The text editor, the parameter forms and the
graph all change the same pipeline, so ⌘Z means the same thing wherever the focus is — a form change
can be undone from the text tab. A run of typing collapses into one step; a form or graph change is
always its own, because someone who changes a value and presses ⌘Z means _that_ value.

**The graph is a vertical tree, not a canvas.** Every VPL node takes one input and produces one
output; the only branching is a composite's `[ … ]` block, drawn as its sources indented above it.
A free-floating node canvas would suggest connections the language cannot express, and would need
more width than the pane has.

**Selecting a node selects it in both views** ([Q15](decisions.md)) — click one in the graph and the
text lands on it; move the caret and the graph follows. **The graph never shows a stale render**:
while the text does not parse there is no tree to draw, and the last good one would be a picture of
something no longer on screen.

**The forms are generated, never written per operation.** Each parameter's control comes from
`field_meta` — an enum becomes a menu of its own variants, an integer carries the range of its type
so a zoom level cannot be set to 300, a `Vec<String>` takes a list, a `[f64;4]` takes four numbers.
Upstream's own documentation is the help text, and every parameter an operation accepts but the node
has not set is offered, so knowing what an operation takes does not mean reading its documentation
elsewhere. Required ones appear empty rather than starred ([Q33](decisions.md#q33--the-node-form-explains-itself-without-symbols-to-learn)).
An operation added upstream gets a working form with no change here.

**A node is a form, not a line of VPL.** Its parameters get one labelled field each, because the
values are routinely longer than the pane is wide — a path can easily run past 250 characters — and a
single VPL string forces a choice between wrapping, which breaks the syntax across lines, and
scrolling, which hides the parameter names. One field per parameter keeps the key visible and lets
the value scroll inside its own box. **Nothing in the pane may set its own width**: every level of
the layout pins `min-width: 0`, or one long path widens the column and pushes the map off the edge.
**Both pane edges are draggable**, within the range `store::Layout` enforces, and both widths
survive a restart. The panes share no structure beyond that — one holds collapsible sections, the
other an inspector — so what is shared is the resizer, not a wrapper around both.

**Clearing a field removes the parameter.** VPL has been able to express an empty value since
4.8.0 ([Q23](decisions.md)), so this is a decision about what a blank field means — for a filename or
a layer name, nothing — rather than the limitation it started as.

**The right pane shows what things turn out to be**, not what you set — since [Q32](decisions.md#q32--a-project-holds-several-named-graphs-and-every-node-is-a-form)
the parameters live in the node. What is left is the pipeline's output and an opened container's own
format, real zoom range and TileJSON (A6). It never shows global settings, or it becomes the junk
drawer where every new feature lands. [Q38](decisions.md) is that rule being enforced twice over: the
opener and the named views both left, and what remains needs no map and no file dialog.

**A control that moves the camera lives on the map** ([Q38](decisions.md)), a corner each: named
views (A7) top-left, where the list has room to open downward; the jump-to-coordinate box (A5)
bottom-left; and the controls for _looking_ at the result rather than moving through it —
background, grid, reset — bottom-right.

## Layouts

### Launcher — a window of its own

A launcher, not a wizard: everything on it is reachable from inside the workbench, and nothing on it
gates anything. It opens when Studio starts with nothing to open and when ⌘N asks for a project, and
it closes the moment something is opened from it
([Q48](decisions.md#q48--a-window-is-a-project-and-the-launcher-is-a-window-of-its-own),
[S7.5](scope-release-3.md)).

It was an overlay inside a project window until [S7.9](scope-release-3.md), which made a window two
different things depending on whether it happened to hold any graphs. A project window between
documents now says one quiet line — where the way in is — rather than becoming a launcher.

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

Nothing is open yet, so there is nothing to show in the chain. Collapse every section later and you
are back here — which is what used to be a whole Explore mode, and was never an activity so much as
"I am not editing right now".

```text
┌───────────────────────────────────────────────────────────┐
│ ≡  MyProject                                              │
├─────────────────────────────────────────┬─────────────────┤
│ [Views ▾] (A7)                          │ INSPECTOR       │
│                  MAP                    │ format, zooms   │
│            grid overlay (A5)            │ TileJSON (A6)   │
│            feature popup (A8)           │                 │
│ [z/x/y jump] (A5)         [grid][reset] │                 │
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
│  [Graph] [VPL ⚠]  │   MAP — selected     │ what the node  │
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

Tabs, not a split — one pane is usable on a 13-inch laptop. Side by side existed to show that graph
and file agree, so the tabs owe that back; [Q15](decisions.md#q15--the-pipeline-pane-tabs-between-graph-and-text)
lists the four debts and this is where they are paid.

### S4 onward — Style joins the chain

Nothing moves. More panes appear below the ones already there, and the asset manager opens as a
dialog over them ([Q39](decisions.md)). Export is not among them: it belongs to the pane whose output
it writes ([Q31](decisions.md)), and to the graph that produced it ([Q32](decisions.md)). Opening,
saving and fonts are in the menu rather than in a strip along the top ([Q47](decisions.md)).

```text
┌───────────────────────────────────────────────────────────┐
│ ≡  MyProject                                              │
├───────────────────┬──────────────────────┬────────────────┤
│ ▾ PIPELINE        │        MAP           │ ▾ INSPECTOR    │
│   ◉ basemap    •  │   live style over    │ format, zooms  │
│   ◌ hillshade     │   every mounted      │ TileJSON (A6)  │
│   ◌ places        │   graph              │                │
│   ＋ new graph…    │                      │                │
│  ─────────────    │  ┌ ─ ─ ─ ┐           │                │
│   Graph │ VPL     │  │ pinned│      (C3) │                │
│   from_geo  ⌄.geo │  └ ─ ─ ─ ┘           │                │
│   ◉ vector_filter │                      │                │
│     filter  ? …   │                      │                │
│     ＋ parameter…  │                      │                │
│   ╰ ＋ operation…  │                      │                │
│   [Save][Export]  │                      │                │
│ ▾ STYLE      (D3) │                      │                │
│   ▸ water · roads │                      │                │
│   [Export style]  │                      │                │
├───────────────────┴──────────────────────┴────────────────┤
│ Jobs (1) ▸        Writing basemap.versatiles — 47%  Cancel │
└───────────────────────────────────────────────────────────┘
```

The full drawing, including the export modal, is the
[wireframe](https://claude.ai/code/artifact/69159dd5-bfb3-4619-bbee-eb5a5c15497a).

Export keeps the map as an **input device**: F2's crop is a rectangle dragged on it, not a coordinate
form. That is a map tool, not a mode — the same way a selection tool would be.

## Import has no surface of its own

A card opens the native file dialog, **creates a graph** and selects it. The generated form is the
node itself (C2), the live preview (C3) is the preview, inline errors (C4) are the validation. Under
[Q32](decisions.md) "+ Add source" finally means what it says: before, it replaced the whole
pipeline. E1's "map columns, layer name, zoom range, simplification, with a preview" is a filled-in
form beside a live map, not a dialog sequence — a bespoke flow would be a second place where
pipelines are authored.

**No mode of its own, and no split by data type.** Importing is building, and building is Pipeline.
Splitting raster from vector would break mixed pipelines — `from_stacked_raster` and
`from_merged_vector` are first-class, and a hillshade under vector OSM is one pipeline — while adding
nothing the generated form does not handle. VPL makes no such split either.

## State the core must own

Not because of mode switches — there are none — but because a window can crash or reload
([Q16](decisions.md)). **Per window, because a window is a project** ([Q48](decisions.md)):

Map camera · the graphs and their text · the sources they read · which panes are open and how wide ·
the undo stack · the jobs that project has run · unsaved edits.

**What it deliberately does not own: cursors.** Scroll position stays in the webview
([Q35](decisions.md#q35--a-graphs-name-is-chosen-once-and-the-core-remembers-work-rather-than-cursors)).
The test is not durable versus volatile but _what you would have to redo by hand_ — recovering a
camera means panning until it looks right again, while a scroll is one flick. A committed parameter
value is already in the core, so the gap costs a gesture, not work.

## Settled elsewhere

**Project settings open as a dialog from the menu**, beside the asset manager — which
[Q39](decisions.md) made a dialog too, for the same reason. They are edited rarely and are not a
selection, so a modal is honest — and it keeps the right pane's rule intact rather than carving an
exception into it.

A3 was dropped ([Q17](decisions.md)), so **release 1 has no
comparison view at all** — C3 shows one node's output on one map. B5 is the first feature needing
two, and it is post-1.0.
