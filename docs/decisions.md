# Decisions

What was decided and why, newest first. Each entry keeps the decision, the trade-off that is not
obvious from the code, and the entries it amends - the mechanism itself is documented beside the
code that implements it. Evidence for upstream claims lives in the [Ecosystem Inventory](ecosystem.md).

---

## Open questions

None. New questions get a `Q` number here, and move to **Decided** once settled.

---

## Decided

All dated 2026-08-16 unless an entry says otherwise.

### Q60 - A parse failure is reported with the construct it happened in

**Decided 2026-08-27.** Upstream reports the innermost failure and the stack of constructs separately,
and Studio kept only the first: `filename=/data/berlin.mbtiles` said `unexpected character`, useful for
nothing. With the innermost frame it says the value needs quoting - the commonest mistake in the
language. **The innermost only**, since every stack ends `parsing node`, `parsing pipeline`. Failures
inside no construct are left as they were
([versatiles-rs#258](https://github.com/versatiles-org/versatiles-rs/issues/258)).

### Q59 - The status bar says the cause; the chain goes where a chain belongs

**Decided 2026-08-27.** The core's errors arrive as `anyhow` context stacks joined with `": "` - a
failed build is 250 characters across seven layers, and a bar fitting eighty showed the layers _every_
failure has in common while cutting off the part that differs.

It now shows the last layer; the whole of it is the bar's `title` and the panel's detail. **Three
layers, not two**: `no such file: /home/anna/berlin.mbtiles` is one sentence naming a thing.

### Q58 - A popup covers rather than displaces, and there is one place that works out where

**Decided 2026-08-27.** `＋ new graph…` revealed its two doors in flow, so opening it pushed the pane
below down and the choices moved while you read them. `Menu` is the generic answer - a trigger, a
fixed-position list, every way out, and arrows that walk only choosable rows. A choice may lead to
another list without closing, which is what `'keep'` says.

**`popup.ts` is the shared part.** `Help`, `Picker` and the map's dropdown each measured a trigger and
worked out a rectangle; the fourth copy is where that stops, and arithmetic can be tested where a
rendered popup cannot.

### Q57 - A colour parameter gets a swatch beside its field, not instead of it

**Decided 2026-08-26.** Two operations spell a colour two ways - `RRGGBB[AA]` with no `#`, or
`[r, g, b]` - so `Control::Color` carries which, and one component owns the translation. **Beside, not
instead**: a native colour input has no alpha, so the field stays, and picking keeps an alpha already
there rather than silently making it opaque. An empty field gets a hatched swatch, because one
defaulting to black would say the parameter is set to black.

### Q56 - A field with a short list of answers offers the list

**Decided 2026-08-26.** `tile_size` is a `u32` by type and "`256` or `512`" by meaning: as a number box
it accepts 400, and the operation refuses that only when the pipeline builds. A documented set on a
plain number is the second spelling of "few answers", after a Rust enum. **An unset field is not the
first option**: a `<select>` shows its first entry when nothing matches, so a parameter nobody had set
displayed as `256`.

### Q55 - A saved `.vpl` names its inputs relative to itself, when it can do so without `../`

**Decided 2026-08-26.** Relative below the destination, absolute for anything that would need `../`,
because a path that climbs out is fragile in both directions. This also fixed "save as", which wrote the
text unchanged while `project.dir` - what a relative path _means_ - moved with it. **Not canonicalised**:
resolving symlinks would rewrite a path someone chose into one they have never seen.

### Q54 - An empty project keeps its panes

**Decided 2026-08-26.** A window with no graphs hid both sidebars and every map control. The intent was
[Q48](#q48---a-window-is-a-project-and-the-launcher-is-a-window-of-its-own)'s - quiet, not a launcher -
but it took the way in with it: `＋ new graph…` lives in the Sources pane, which was hidden for exactly
as long as there were no sources. The cost is three empty states nobody had drawn.

### Q53 - A bbox field borrows the map's rectangle

**Decided 2026-08-26.** Four bare numbers in a form are four chances to put a digit in the wrong place,
with nothing to check them against until the pipeline runs over the wrong part of the world. The map
already draws rectangles, so a bbox field shows its own on focus and can be filled in from a drag. Which
fields these are comes from `semantics.rs`, tabulated since it was written and never read.

### Q52 - The map's own controls are one stack down the top left

**Decided 2026-08-26.** Three corners made the map's controls read as three unrelated things, each
having to know where the others were not. One column now, placed by its container. **Left, not right**,
where MapLibre puts its own controls and the attribution; **top, not bottom**, which the status bar
owns. The cost is that they sit over the north-west corner of an extract.

### Q51 - A layer override applies on whatever basis the style was arrived at

**Decided 2026-08-26.** The layer tree is offered for every vector source, so an override made there has
to reach the style however that style was arrived at - not only through the preset path. Gating the tree
to preset styles instead is smaller and wrong: a container no preset can draw is where a per-layer
control is worth most. The tree is also shown **one source, not the stack**, since the composed stack
renames ids as soon as a second thing draws.

### Q50 - Sources and Pipeline are two panes, and the sources list is where a stack is arranged

**Decided 2026-08-26.** One pane held four groups at two levels: a list of graphs is the project, a chain
is one document - [Q31](#q31---panes-are-a-list-and-each-one-owns-what-it-emits)'s
document-versus-selection line. **This is not the sources pane
[Q22](#q22---one-map-surface-not-four-modes-the-mode-bar-separates-map-work-from-non-map-tools)
refused**, which was a list of `from_*` read nodes beside a graph that already draws them.

**The draw order moves into that list.** The style pane's copy listed only sources that had built, so a
graph that would not build vanished from the one control that could move it.

### Q49 - An eye means "this runs", at both scales; the pin is retired

**Decided 2026-08-26.** One meaning at both scales: an eye says its row is processed. **A bypass, not a
cut** - node eyes are independent, so switching one off drops that node and the rest carry on. The pin
could not express `from_stacked [ a, b ]` without `b`, which is what decided this. Two eyes cannot be
switched off: the node a graph starts with, and a composite's last source.

**Amends [Q32](#q32---a-project-holds-several-named-graphs-and-every-node-is-a-form).**

### Q48 - A window is a project, and the launcher is a window of its own

**Decided 2026-08-25.** A launcher inside a project window makes the window two things, so "new
project" comes to mean "empty this window out", and a second project cannot be started without
abandoning the first.

**This is what finally makes [Q16](#q16---one-application-instance-one-window-per-project) true.**
Every piece of project state was one application-wide `Mutex`, so ⌘N opened a second window onto the
same project, sharing an undo stack and a viewport. The core now holds a project per window.

### Q47 - The verbs about the project live in a native menu, and ⌘S saves the project

**Decided 2026-08-25.** Five controls sat in the top-right corner - a menu bar drawn by hand, in the one
corner of the window where a menu is not. Native menus get the accelerators and keyboard navigation for
free. **The menu says which; the window says what**: `menu.rs` emits an item id and stops there.

### Q46 - An overlay on the map is one helper with one test, not three copies of a pattern

**Decided 2026-08-24.** `TileGrid`, `TileActivity` and `CropOverlay` each hand-rolled the same lifecycle
and each had a different subset of it right. **What none of them had:** a source and its layers ensured
_separately_ - guarding the whole overlay on its source left it half-drawn for the life of the style,
silently, when `addSource` succeeded and a later `addLayer` threw.

### Q45 - The feature popup answers for Studio's tiles only, and stays inside the map

**Decided 2026-08-23.** `queryRenderedFeatures` with no filter queries every layer, so a click returned
the background's OSM roads. A8 is "what is in _your_ tile"; the background is scenery. The query is
restricted **by source**, the one thing true of Studio's tiles however they are drawn.

**The layer list is worked out once per style, not once per mouse move**, because `getStyle()` from
`mousemove` broke crop drawing outright.

### Q44 - A crop being dragged is drawn as a rectangle; the dim is for a crop that exists

**Decided 2026-08-23.** Dimming everything outside the crop is the right picture for a crop that exists

- a crop is not a rectangle on the world, it is the part of the world that survives. It is the wrong
  picture for one being dragged: starting a small box turns the whole map dark, which reads as the map
  breaking. So the draft is its own overlay, dashed, and only ever one of the two is on screen.

### Q43 - The crop folds away, and the Pipeline pane's three actions are centred and full size

**Decided 2026-08-23.** Most graphs are exported whole, so a zoom row, four bbox fields and an estimate
sat under every chain for a decision nobody had made. Closed, it is one row - but **a crop that is set
says so while it is closed**, because a graph narrowed to one city and exported as one city, with
nothing on screen to say why, is the serious failure.

### Q42 - The estimate is asked for, in the one place that still shows it

**Decided 2026-08-23. Corrected 2026-08-24.** The estimate runs the real pipeline over a stratified
sample (S3.7) and is not cached. Where that buys a feedback loop it is worth paying unasked; in the
export dialog there is none, because the crop is settled. **What this costs:** someone can export
without knowing what it will cost - a real loosening of C6.

### Q41 - What a graph produces is reported where it is about to matter: the export dialog

**Decided 2026-08-23.** The Produces pane moves into `ExportDialog` and is removed: "choose a file" is
the last moment to notice that the layer you meant is missing. **The numbers had to change subject to
be correct** - the pane read `preview.last`, which followed the pin, so with a node pinned it described
_that node's_ output while an export always writes the graph.

### Q40 - C7 is dropped: four artefacts that never composed into one story

**Decided 2026-08-23.** S5.5's "Run this elsewhere" dialog generated four files from the project. **It
was sorted by file format, and people arrive with a verb**: two tabs built tiles, two served them, and
no path through the dialog built tiles and then served the built thing.

_Drops [C7](features.md)._

### Q39 - The asset manager is a dialog, and with it the mode bar goes

**Decided 2026-08-23.** Built as a mode it was one in name only: it rendered inside the map region
while everything layered over that region kept rendering. A mode replaces a surface; this never
replaced one. **It is an errand** - you leave the map to fetch something and want the window as you
left it.

**So the modes go**, since [Q22](#q22---one-map-surface-not-four-modes-the-mode-bar-separates-map-work-from-non-map-tools)
itself said a one-item bar "would be chrome that switches between nothing and itself".

### Q38 - Views are named camera positions, they live on the map, and the inspector holds neither them nor a way in

**Decided 2026-08-23.** The inspector had its own way in, from when opening a container was all Studio
did. **A7's bookmarks are named camera positions, and they moved to the map**: they store a camera and
jump to it, which is the same act as the coordinate box. The coupling gave it away - the save button was
disabled whenever there was no map.

### Q37 - D3's expression editor edits filters, because that is where the expressions are

**Decided 2026-08-23.** Scoping [S4.5](history.md)'s remaining half found its premise wrong: across the
six presets' 1,503 layers there are 1,825 colour paint properties and **not one is an expression**,
while 1,475 layers carry a filter and **every one is**.

**Text, not a builder**, because a row-per-clause editor would cover most filters and refuse the rest -
and one that cannot open what it is pointed at is worse than one showing the value as it is.

### Q36 - The core owns the style's recipe, not the style

**Decided 2026-08-21.** The core stores what the style is made from - preset, options and sparse
per-layer overrides - not the rendered MapLibre style, **because the output does not fit the stack it
would have to live on.** `history.rs` keeps whole-text snapshots on the grounds that "a pipeline is a
few hundred bytes"; `colorful` is 125 kB across 324 layers.

### Q35 - A graph's name is chosen once, and the core remembers work rather than cursors

**Dated 2026-08-18.** **Saving to a new filename does not rename the graph.** Read as an invariant
running both ways, Q32's name-is-identity would make saving `basemap` to `hillshade.vpl` move the
server mount and rewrite the style's source name as a side effect of picking a filename. So the binding
runs one way, and the name is chosen when the graph is created from whatever was opened.

### Q34 - Studio carries a pinned `proj-sys` fork until the `libsqlite3-sys` conflict resolves upstream

**Dated 2026-08-17.** `gdal-src` → `proj-sys` wants `libsqlite3-sys >=0.28, <0.36`;
`versatiles_container` → `rusqlite` wants `^0.38`. `libsqlite3-sys` declares `links = "sqlite3"`, so
cargo permits exactly one copy, and the ranges are disjoint.

The fix is upstream and both routes were asked for
([versatiles-rs#226](https://github.com/versatiles-org/versatiles-rs/issues/226),
[georust/proj#261](https://github.com/georust/proj/pull/261)). Studio carries the patch meanwhile,
pinned to a commit so a rebase cannot change what it builds, with the exit condition beside it:
**remove it as soon as either lands.**

### Q33 - The node form explains itself without symbols to learn

**Dated 2026-08-18.** **Parameter help sits beside the sidebar, over the map.** Measured before
deciding: 127 parameters, median 95 characters, p90 262 - three lines in a 280px sidebar and seven at
the p90, overlaying the form being filled in. **Hover to peek, click to pin**, and the trigger is the
`?` rather than the row, or sweeping down a form would flash a popover per argument.

### Q32 - A project holds several named graphs, and every node is a form

**Dated 2026-08-18.** Supersedes
[Q25](#q25---the-vpl-editor-is-a-textarea-with-a-highlight-overlay-over-one-document-per-window)'s "one
pipeline document per window"; amended by
[Q33](#q33---the-node-form-explains-itself-without-symbols-to-learn) and
[Q49](#q49---an-eye-means-this-runs-at-both-scales-the-pin-is-retired).

**Q25 answered a different question.** It offered several sources as `from_stacked [ a, b ]`, which
merges inputs into **one** source; a map style needs the opposite. **A graph is a named VPL document
producing one named tile source**, and that name is the identity in three places at once - the server
mount, the `style.json` source and the `.vpl` filename.

### Q31 - Panes are a list, and each one owns what it emits

**Dated 2026-08-18.** **The axis is document versus selection**: left is the structure of what you are
building, right is the thing currently selected. Two alternatives lost against the feature inventory -
_tile data / style_ leaves every analysis feature homeless, and _interaction / information_ does not
survive contact, since A6 edits TileJSON. **Each pane owns what it emits**, which dissolves the Export
section.

### Q30 - A CSV import reads the header and fills in what it can

**Dated 2026-08-17.** [Q29](#q29---the-import-form-learns-the-data-by-probing-what-the-pipeline-produces)
probes what the pipeline produces, which cannot work here: `from_csv` will not build until
`lon_column` and `lat_column` are set. **Not `x` and `y`** - projected metres or a grid index often
enough that a guess would sometimes produce a map of somewhere that does not exist, in a _required_
field.

### Q29 - The import form learns the data by probing what the pipeline produces

**Dated 2026-08-17.** `from_geo` takes lists of property names, and nobody can know those names without
opening the file in something else first - E1's "map columns", and the part of an import that sent you
elsewhere. **Probed from the output, not parsed from the input**, so one implementation serves every
format, including ones Studio has never heard of.

### Q28 - One import catalogue, in the core, derived from the operation registry

**Dated 2026-08-17.** The list of what Studio can open was in four places and already wrong, and none of
them knew about `from_geo` - which the binary had all along. **The catalogue answers to the binary**,
dropping any kind whose read operation is absent, so a card cannot offer something that fails on the
first click.

### Q27 - The job runner has two lanes, and the preview runs in one of them

**Dated 2026-08-17.** **`queued`** runs one job at a time, because conversions compete for the same disk
and cores and two at once finish later than the same two in sequence. **`latest`** cancels whatever the
lane was running: a preview of a pipeline that has since been edited is a machine warming up over a
stale question. One FIFO serving both would make a preview wait behind a forty-minute export.

### Q26 - The IPC types are generated, and the generated file is committed

**Dated 2026-08-17.** [Q3](#q3---three-planes-ipc-for-control-http-for-data-channels-for-events)
deferred `tauri-specta` for being pre-1.0. The risk that avoided turned out smaller than the one it
accepted: `svelte-check` flags a _use_ of a missing field, not a missing field, so drift failed nothing
until somebody read it. **The generated file is committed, and a test fails when it is stale** - which
is what makes a pre-1.0 generator acceptable.

### Q25 - The VPL editor is a textarea with a highlight overlay, over one document per window

**Dated 2026-08-17.** ~~One pipeline document per window~~ - superseded 2026-08-18 by
[Q32](#q32---a-project-holds-several-named-graphs-and-every-node-is-a-form). What survives is what the
editor is built from.

**Not CodeMirror.** The hard part is already done - a highlighter needs to know where every token is,
and [Q23](#q23---the-vpl-syntax-tree-is-written-from-scratch-and-pinned-to-upstream-by-a-differential-test)'s
parser returns exactly that, so a second tokeniser would mean two definitions of the grammar. Undo
belongs to the document rather than the editor, since G6 wants one stack covering text _and_
structured edits.

### Q24 - G2 is dropped. The bottom bar shows status and progress

**Dated 2026-08-17.** G2 promised that every GUI action displays its CLI equivalent. Most of Studio's
actions have none and never will - collapsing a pane, selecting a node, panning the map. The need
behind it was reproducibility, and [G1](features.md) delivers that properly: a directory of real `.vpl`
and `style.json` files the CLI already consumes, which beats a copyable one-liner and does not have to
be maintained action by action.

### Q23 - The VPL syntax tree is written from scratch, and pinned to upstream by a differential test

**Superseded in practice, 2026-08-17: upstream built it.** `versatiles_pipeline` 4.8.0 ships a lossless
`CstFile`, so Studio's own parser is gone - 700 lines removed for 250 added.

The reasoning is kept because it is why the tree has the shape it does. **The text is the document:**
spans point into the original, so parse-then-print is the identity, and comments survive because they
are never re-rendered - a property of the data structure, not of a formatter behaving well.

### Q22 - One map surface, not four modes. The mode bar separates map work from non-map tools

Explore, Pipeline, Style and Publish are merged into a **single surface**. The four modes asserted a
separation the work does not have: tighten a filter, look at how it renders, adjust a colour - every one
was a mode switch.

**Supersedes [Q14](#q14---explore-and-pipeline-stay-separate-modes---superseded-by-q22)**; amended by
[Q31](#q31---panes-are-a-list-and-each-one-owns-what-it-emits),
[Q32](#q32---a-project-holds-several-named-graphs-and-every-node-is-a-form) and
[Q39](#q39---the-asset-manager-is-a-dialog-and-with-it-the-mode-bar-goes).

### Q21 - Recents and bookmarks are application state in JSON files, not project state

A7 said view bookmarks are "stored in the project". They are not: both they and the recent-sources list
live beside the application's data, as JSON.

**Why not SQLite**, even though `rusqlite` is already linked: its advantages are concurrency, partial
updates and queries over large sets, and none apply. What it would add is a schema and migrations, for
state whose shape changes often.

**Amended 2026-08-23 by [Q38](#q38---views-are-named-camera-positions-they-live-on-the-map-and-the-inspector-holds-neither-them-nor-a-way-in):**
bookmarks are now views.

### Q20 - GDAL is raster-only in release 1; GeoPackage is not supported

Vector reading is `from_geo`, which needs no GDAL at all, and **there is no GeoPackage path anywhere** -
E3's claim to the contrary was wrong. GeoPackage users convert with `ogr2ogr` first, precisely the
toolchain step `vision.md` says P2 will not get through, and the sharpest instance of that tension in
the release. **Revisit** by teaching `from_geo` to read it directly: it is SQLite.

### Q19 - GDAL is statically bundled, with a deliberately narrow driver set

E3 is required for M3, so GDAL cannot be optional and cannot be a system dependency. **The obvious
blocker turns out to be solved**: PROJ normally needs `proj.db` at runtime, and RFC-8's
`EMBED_RESOURCE_FILES` defaults to ON for static builds - verified rather than assumed. Dynamic linking
against a system GDAL costs ~70 Homebrew formulae, which is exactly the toolchain step P1 and P2 will
never get through.

### Q18 - Studio's Svelte components are written from scratch

`@versatiles/svelte` is a **reference to read, not a package to import**. Studio's shell has
requirements no other consumer has - one `Map` owned by the core, panes that reconfigure, a graph
pane that edits text through a syntax tree - and the coupling would run both ways, with Studio's
needs distorting a library other projects depend on.

### Q17 - A3, the multi-source layer stack, is dropped

No stacking several containers in one view with opacity, swipe and split. Dropped, not deferred:
[Q14](#q14---explore-and-pipeline-stay-separate-modes---superseded-by-q22) removed the sources strip
that would have held it, and [Q16](#q16---one-application-instance-one-window-per-project) mostly
replaces it - comparing two containers is two windows side by side. **Release 1 therefore has no
comparison view at all.**

### Q16 - One application instance, one window per project

Not tabs, not separate application instances. Tabs share one WebGL budget and one crash blast radius;
separate instances fragment the job queue and the asset writer. **Tauri already gives us the
isolation** - every webview is a separate OS process.

**Nothing may live only in the webview.** Narrowed by
[Q35](#q35---a-graphs-name-is-chosen-once-and-the-core-remembers-work-rather-than-cursors) to _work you
would have to redo by hand_, and made true by
[Q48](#q48---a-window-is-a-project-and-the-launcher-is-a-window-of-its-own).

### Q13 - Studio is a workbench. New projects start from a landing screen

The workbench-versus-P1 tension resolves for the workbench: no simplified mode, and P1 is expected to
cope. **The P1 risk is accepted, not overlooked** - `audiences.md` warns that "a rough edge a developer
shrugs off will stop a journalist entirely", and if P1 adoption stalls this is the first decision to
revisit.

_[Q48](#q48---a-window-is-a-project-and-the-launcher-is-a-window-of-its-own) made it a window of its
own._

### Q14 - Explore and Pipeline stay separate modes - **superseded by [Q22](#q22---one-map-surface-not-four-modes-the-mode-bar-separates-map-work-from-non-map-tools)**

> Kept for the record, trimmed to what outlived it.

**What survives: there is no sources pane at all.** Settled here after two revisions - shared across
modes, then Pipeline-only, then neither - because the `from_*` read nodes at the head of the pipeline
**are** the sources, so a separate list duplicates them. Q22 had to re-establish this when a first
draft reintroduced a Sources section.

### Q15 - The pipeline pane tabs between graph and text

One pane, two tabs: **Graph** and **VPL**, not side by side, which also settles the small-screen
question. Side-by-side existed so a user could see graph and file agree, so the tabs owe that back:
the Graph tab never shows a stale graph, the VPL tab carries an error badge when parsing fails, and
switching is free because both are views over one syntax tree.

### Q11 - The node graph (C1) is in release 1, and needs a lossless VPL syntax tree

M4 means node graph **plus** text editor. The catalogue assumed C1 was cheap because "the parser
exists" - it parses, but cannot write back: no serialiser, properties in a `BTreeMap` that reorders
them, comments discarded. So the graph edits text through **span-based edits over a lossless syntax
tree**: regenerating from the AST would reformat the file and delete the comments on every interaction.

### Q4 - Analysis statistics live in memory, keyed by container identity

No sidecar files, no results in the project file. Scanning is three costs, and only the third needed
solving: metadata and zoom range are free from the block index, tile sizes are index-only, and tile
_contents_ are expensive but bounded by sampling. The first two are too cheap to persist; the third
samples by default, with a full scan as an explicit cancellable job.

### Q7 - No `planetiler` orchestration. E5 is dropped

Closed as **no**, permanently rather than deferred. Java 21+, 0.5× the PBF size in RAM, 5-10× on
disk, ~1 GB of downloads before the first run. Detecting an existing JVM makes the feature invisible
to the audience that needs it; bundling one adds 50-190 MB to ship, sign and update; Docker is absent
in the public administrations this targets.

### Q12 - Cluster B stays out of release 1, but is cheaper than the catalogue says

The algorithm for B2's per-layer byte breakdown exists and is proven - but **it is not reachable as a
library**: `mod tools;` is declared in `versatiles/src/main.rs`, so `layer_stats()` is binary-only.
Studio either reimplements it over the public `versatiles_geometry`, or asks upstream to move it.

So B1, B2 and B3 are mostly **visualisation over existing numbers** rather than analysis, which
strengthens the case for taking them first after release 1.

### Q8 - Release early under v0.x, aimed at the tile audience

Ship `v0.x` from stage 1; reserve the announcement for when all four milestones are in. **But the
framing matters**: if the first public build is a viewer, Studio gets categorised as "a tile viewer",
and first categorisations stick. **Why not stay silent entirely:** the macOS Gatekeeper path cannot be
tested by reading our own instructions.

### Q6 - A project is a directory of real files with a YAML manifest

`project.yaml` beside real `.vpl` and `style.json` files. **Reference, do not embed** - the ecosystem
already chose this: `versatiles serve` resolves relative paths against the config directory, so a
Studio pipeline runs unchanged under `versatiles convert` and a Studio style loads unchanged in
MapLibre. Embedding a text DSL in JSON would mean escaped newlines and unreadable diffs.

### Q3 - Three planes: IPC for control, HTTP for data, Channels for events

Control over Tauri IPC; data (tiles, glyphs, sprites) over the embedded HTTP server; events over Tauri
Channels. **Forced, not stylistic**: Tauri serialises command returns as JSON, and its own docs warn
this is slow for large payloads.

**Studio's own tiles take a detour through the webview**, fetched through a `studio://` protocol holding
a bounded queue - because MapLibre reports a tile as loading the moment it _issues_ a fetch, so only a
queue in the middle can tell "the server has it" from "nobody has started".

### Q10 - Release 1 ships Linux packages and a Homebrew cask; signing comes later

**Amended 2026-08-23: Windows x86_64 is built, and unsigned.** What costs money and lead time is the
_certificate_, not the build.

**arm64 was attempted and dropped the same day.** `gdal-sys` ships prebuilt bindings for four targets,
`aarch64 + windows` is not among them, and it generates none unless `bindgen` is on - which a bundled
build cannot use. Windows on ARM runs the x64 build under emulation.

### Q2 - Scope of release 1 is set by the funding milestones

Analysis audience or creation audience first? Moot - the four milestones are funded, spanning clusters
A, D, E and C, and **cluster B is not in scope**. Four independent sources agree: of 76 showcase
projects 24 are tagged `journalism`; the documentation backlog is almost entirely creation workflows;
`@versatiles/style` sees an order of magnitude more downloads than anything else.

### Q9 - Fonts and sprites are fetched per family, and never unpacked

Three tiers: **bundled** (sprites plus Latin-only Noto Sans, 1.9 MB, in the installer), **on demand**
(one family, 1-45 MB), and **everything** (107 MB, an explicit action for offline use).

**Works offline from first launch** - no 109 MB wall before the user has seen a map, and the
empty-glyph-tile trick renders non-Latin text blank rather than erroring. **Per-family beats
all-or-nothing:** picking Roboto downloads 3 MB. **Archives are served, never unpacked**, so each
asset stays atomic to verify and delete.

### Q1 - VersaTiles Studio is a native Tauri v2 application

Not a subcommand serving a browser UI. Native file dialogs, drag & drop, file type associations and
being findable as an application outweigh the alternative.

**Tauri v2**, not v1: the multi-window model of
[Q16](#q16---one-application-instance-one-window-per-project), the Channels of
[Q3](#q3---three-planes-ipc-for-control-http-for-data-channels-for-events) and `tauri-specta` all
depend on it.

**In exchange:** signing and notarisation costs, building auto-update ourselves, no path for running
Studio on the remote server holding a very large file, and no UI reuse inside
`versatiles-frontend-dev`.

### Q5 - No Node runtime is shipped

Every JavaScript library Studio needs runs in the browser, so all of it is bundled into the webview
at build time. Node stays a build-time dependency.

**Consequence:** SVG export (F6) is bounded by what the webview can render. Headless or batch image
export has no path here - acceptable, since it is not a v1 goal.

### Build on the existing `versatiles-studio` repository

The previous contents were a Tauri 1 + Svelte 4 template with no substantive code. Removed; the
history remains in git.

### Planning documents in English

Consistent with every other repository in versatiles-org, and readable by potential contributors.
Working discussions continue in German.
