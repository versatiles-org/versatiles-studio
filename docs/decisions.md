# Decisions

Why the shape of Studio is what it is, newest first.

**What earns an entry.** A choice someone could reasonably have made differently, and would otherwise
re-open. If there was no alternative it is not a decision; if the code makes it obvious it need not be
said twice; if it is a bug, a fix or a detail of how something works, it belongs beside the code. Most
of what happens in a day fails all three, and that is normal.

**What an entry holds.** The decision as a claim, the alternative that lost and why, and what it
amends or supersedes. Three or four sentences. Not dates - git has those, and the `Q` numbers already
run in order. Not mechanism, not measurements that only justify an implementation, not the history of
how it was arrived at.

A `Q` number is never reassigned. Evidence for upstream claims lives in the
[Ecosystem Inventory](ecosystem.md).

---

## Open questions

None. New questions get a `Q` number here, and move to **Decided** once settled.

---

## Decided

### Q61 - A rebuild that would change nothing is skipped

An edit that leaves the effective pipeline alone - a comment, a reformat, a rename - rebuilt the graph,
re-probed it and remounted it. **What that cost was not mainly the build**: mounting bumps a revision
the tile URL carries, so MapLibre refetched every tile it was already showing.

**Keyed on the pipeline, not the document**, which is what catches the cases worth catching - and on
the mount and the project directory too, since a rename moves the first and "save as" moves what
relative paths mean ([Q55]). **The check is inside the job, not in front of it**: `Lane::Latest`
supersedes what the lane was running, and skipping the submit would leave a build of the previous
pipeline to finish and mount something nobody asked for.

The cost is that a source changed on disk is no longer picked up by editing something unrelated. It
was never picked up without an edit either, so this narrows an accident rather than removing a feature

- but an explicit reload is the honest answer, and there is not one yet.

### Q60 - Parse failures name their construct

Upstream reports the innermost failure and the stack of constructs separately, and Studio kept only the
first: `filename=/data/berlin.mbtiles` said `unexpected character`, useful for nothing. With the
innermost frame it says the value needs quoting. **The innermost only**, since every stack ends `parsing
node`, `parsing pipeline`
([versatiles-rs#258](https://github.com/versatiles-org/versatiles-rs/issues/258)).

### Q59 - The status bar says the cause

The core's errors arrive as `anyhow` context stacks joined with `": "`, so a bar fitting eighty
characters showed the layers every failure has in common and cut off the one that differs. It shows the
last layer now, with the whole of it in the `title`. **Three layers, not two**: `no such file: /path` is
one sentence naming a thing.

### Q58 - A popup covers, never displaces

Revealing choices in flow pushed the pane below them down, so they moved while you read them. `Menu` is
the generic answer, and a choice may lead to another list without closing. **`popup.ts` is the shared
part**: `Help`, `Picker` and the map's dropdown each worked out a rectangle from a measured trigger, and
the fourth copy is where that stops.

### Q57 - Colour fields get a swatch

The third (see Q53). Two operations spell a colour two ways - `RRGGBB[AA]` or `[r, g, b]` - so the
control carries which. **Beside the field, not instead of it**: a native colour input has no alpha, and
picking keeps an alpha already there rather than silently making it opaque.

### Q56 - A short set of answers is a list

The second role read out of the table (see Q53). `tile_size` is a `u32` by type and "`256` or `512`" by
meaning, so a number box accepts 400 and the operation refuses it only when the pipeline builds. **An
unset field is not the first option**: a `<select>` shows its first entry when nothing matches.

### Q55 - A saved `.vpl` names inputs relative to itself

Relative below the destination, absolute for anything that would need `../`,
because a path that climbs out is fragile in both directions. This also fixed "save as", which wrote the
text unchanged while `project.dir` - what a relative path _means_ - moved with it. **Not canonicalised**:
resolving symlinks would rewrite a path someone chose into one they have never seen.

### Q54 - An empty project keeps its panes

A window with no graphs hid both sidebars and every map control. The intent was
[Q48](#q48---a-window-is-a-project)'s - quiet, not a launcher -
but it took the way in with it: `＋ new graph…` lives in the Sources pane, which was hidden for exactly
as long as there were no sources. The cost is three empty states nobody had drawn.

### Q53 - A bbox field borrows the map's rectangle

Four bare numbers in a form are four chances to put a digit in the wrong place, with nothing to check
them against until the pipeline runs over the wrong part of the world - so a bbox field shows its
rectangle on the map and can be filled in from a drag. **A field's control comes from `semantics.rs`**,
which had tabulated every role and was read by nothing; Q56 and Q57 are the same decision for two more.

### Q52 - The map's controls are one stack, top left

Three corners made the map's controls read as three unrelated things, each
having to know where the others were not. One column now, placed by its container. **Left, not right**,
where MapLibre puts its own controls and the attribution; **top, not bottom**, which the status bar
owns. The cost is that they sit over the north-west corner of an extract.

### Q51 - An override applies on every basis

The layer tree is offered for every vector source, so an override made there has to reach the style
however that style was arrived at - not only through the preset path. Gating the tree to preset styles
instead is smaller and wrong: a container no preset can draw is where a per-layer control is worth
most.

### Q50 - Sources and Pipeline are two panes

One pane held four groups at two levels: a list of graphs is the project, a chain is one document -
[Q31](#q31---panes-are-a-list-each-owning-its-output)'s document-versus-selection line. **This is not
the sources pane [Q22](#q22---one-map-surface-not-four-modes) refused**, which was a list of `from_*`
read nodes beside a graph that already draws them. The draw order moves into that list rather than being
a second one.

### Q49 - An eye means "this runs"

One meaning at both scales: an eye says its row is processed. **A bypass, not a cut** - node eyes are
independent, so switching one off drops that node and the rest carry on. The pin could not express
`from_stacked [ a, b ]` without `b`, which is what decided it. **Amends
[Q32](#q32---a-project-holds-several-named-graphs).**

### Q48 - A window is a project

A launcher inside a project window makes the window two things, so "new project" comes to mean "empty
this window out". **This is what finally makes
[Q16](#q16---one-instance-one-window-per-project) true**: every piece of project state was one
application-wide `Mutex`, so ⌘N opened a second window onto the same project, sharing an undo stack and
a viewport.

### Q47 - Project verbs live in a native menu

Five controls sat in the top-right corner - a menu bar drawn by hand, in the one
corner of the window where a menu is not. Native menus get the accelerators and keyboard navigation for
free. **The menu says which; the window says what**: `menu.rs` emits an item id and stops there.

### Q46 - One overlay helper, not three copies

`TileGrid`, `TileActivity` and `CropOverlay` each hand-rolled the same lifecycle and each had a
different subset of it right. **What none of them had:** a source and its layers ensured _separately_ -
guarding the whole overlay on its source left it half-drawn for the life of the style, silently.

### Q45 - The feature popup answers for Studio's tiles

`queryRenderedFeatures` with no filter queries every layer, so a click returned the background's OSM
roads. A8 is "what is in _your_ tile"; the background is scenery, so the query is restricted **by
source** - the one thing true of Studio's tiles however they are drawn.

### Q44 - A dragged crop is a rectangle

Dimming everything outside the crop is the right picture for a crop that exists: a crop is not a
rectangle on the world, it is the part of the world that survives. It is the wrong picture for one being
dragged, where starting a small box turns the whole map dark. So the draft is its own overlay.

### Q43 - The crop folds away

Most graphs are exported whole, so a zoom row, four bbox fields and an estimate sat under every chain
for a decision nobody had made. **A crop that is set says so while it is closed**, because a graph
narrowed to one city and exported as one city, with nothing to say why, is the serious failure.

### Q42 - The estimate is asked for

The estimate runs the real pipeline over a stratified
sample (S3.7) and is not cached. Where that buys a feedback loop it is worth paying unasked; in the
export dialog there is none, because the crop is settled. **What this costs:** someone can export
without knowing what it will cost - a real loosening of C6.

### Q41 - What a graph produces belongs in the export dialog

The Produces pane moves into `ExportDialog` and is removed: "choose a file" is
the last moment to notice that the layer you meant is missing. **The numbers had to change subject to
be correct** - the pane read `preview.last`, which followed the pin, so with a node pinned it described
_that node's_ output while an export always writes the graph.

### Q40 - C7 is dropped

S5.5's "Run this elsewhere" dialog generated four files from the project. **It
was sorted by file format, and people arrive with a verb**: two tabs built tiles, two served them, and
no path through the dialog built tiles and then served the built thing.

_Drops [C7](features.md)._

### Q39 - The asset manager is a dialog

Built as a mode it was one in name only: it rendered inside the map region while everything layered over
that region kept rendering. A mode replaces a surface; this never replaced one. **So the modes go**,
since [Q22](#q22---one-map-surface-not-four-modes) itself called a one-item bar "chrome that switches
between nothing and itself".

### Q38 - Views are camera positions, on the map

The inspector had its own way in, from when opening a container was all Studio did. **A7's bookmarks are
named camera positions, and they moved to the map**: they store a camera and jump to it, the same act as
the coordinate box. The coupling gave it away - the save button was disabled whenever there was no map.

### Q37 - D3's expression editor edits filters

Scoping [S4.5](history.md)'s remaining half found its premise wrong: across the six presets' 1,503
layers there are 1,825 colour paint properties and **not one is an expression**, while 1,475 layers
carry a filter and **every one is**. **Text, not a builder**, because a row-per-clause editor would
cover most filters and refuse the rest.

### Q36 - The core owns the recipe

The core stores what the style is made from - preset, options and sparse
per-layer overrides - not the rendered MapLibre style, **because the output does not fit the stack it
would have to live on.** `history.rs` keeps whole-text snapshots on the grounds that "a pipeline is a
few hundred bytes"; `colorful` is 125 kB across 324 layers.

### Q35 - A graph's name is chosen once

**Saving to a new filename does not rename the graph.** Read as an invariant running both ways, Q32's
name-is-identity would make saving `basemap` to `hillshade.vpl` move the server mount and rewrite the
style's source name as a side effect of picking a filename. The binding runs one way.

### Q34 - A pinned `proj-sys` fork, until upstream lands

`gdal-src` → `proj-sys` wants `libsqlite3-sys >=0.28, <0.36`; `versatiles_container` → `rusqlite` wants
`^0.38`, and `links = "sqlite3"` permits exactly one copy. The fix is upstream and both routes were
asked for ([versatiles-rs#226](https://github.com/versatiles-org/versatiles-rs/issues/226),
[georust/proj#261](https://github.com/georust/proj/pull/261)); Studio carries the patch meanwhile,
pinned to a commit, with the exit condition beside it: **remove it as soon as either lands.**

### Q33 - The node form explains itself

**Parameter help sits beside the sidebar, over the map.** Measured before deciding: 127 parameters,
median 95 characters, p90 262 - three lines in a 280px sidebar and seven at the p90, over the form being
filled in. **Hover to peek, click to pin**, with the `?` as the trigger rather than the row.

### Q32 - A project holds several named graphs

Supersedes [Q25](#q25---the-vpl-editor-is-a-textarea)'s "one pipeline document per window"; amended by
[Q33](#q33---the-node-form-explains-itself) and [Q49](#q49---an-eye-means-this-runs). **Q25 answered a
different question**: `from_stacked [ a, b ]` merges inputs into **one** source, where a map style needs
the opposite. **A graph is a named VPL document producing one named tile source**, and that name is its
identity in three places at once.

### Q31 - Panes are a list, each owning its output

**The axis is document versus selection**: left is the structure of what you are building, right is the
thing currently selected. Two alternatives lost against the feature inventory - _tile data / style_
leaves every analysis feature homeless, and _interaction / information_ does not survive contact, since
A6 edits TileJSON. **Each pane owns what it emits**, which dissolves the Export section.

### Q30 - A CSV import reads the header

[Q29](#q29---the-import-form-probes-the-output)
probes what the pipeline produces, which cannot work here: `from_csv` will not build until
`lon_column` and `lat_column` are set. **Not `x` and `y`** - projected metres or a grid index often
enough that a guess would sometimes produce a map of somewhere that does not exist, in a _required_
field.

### Q29 - The import form probes the output

`from_geo` takes lists of property names, and nobody can know those names without
opening the file in something else first - E1's "map columns", and the part of an import that sent you
elsewhere. **Probed from the output, not parsed from the input**, so one implementation serves every
format, including ones Studio has never heard of.

### Q28 - One import catalogue, from the registry

The list of what Studio can open was in four places and already wrong, and none of
them knew about `from_geo` - which the binary had all along. **The catalogue answers to the binary**,
dropping any kind whose read operation is absent, so a card cannot offer something that fails on the
first click.

### Q27 - The job runner has two lanes

**`queued`** runs one job at a time, because conversions compete for the same disk and cores and two at
once finish later than the same two in sequence. **`latest`** cancels what the lane was running: a
preview of a pipeline since edited is a machine warming up over a stale question.

### Q26 - The IPC types are generated, and committed

[Q3](#q3---three-planes-ipc-http-channels)
deferred `tauri-specta` for being pre-1.0. The risk that avoided turned out smaller than the one it
accepted: `svelte-check` flags a _use_ of a missing field, not a missing field, so drift failed nothing
until somebody read it. **The generated file is committed, and a test fails when it is stale** - which
is what makes a pre-1.0 generator acceptable.

### Q25 - The VPL editor is a textarea

~~One pipeline document per window~~ - superseded by
[Q32](#q32---a-project-holds-several-named-graphs). What survives is what the editor is built from.

**Not CodeMirror.** A highlighter needs to know where every token is and
[Q23](#q23---the-vpl-syntax-tree-is-lossless)'s parser returns exactly that, so a second tokeniser would
mean two definitions of the grammar. Undo belongs to the document, since G6 wants one stack over text
_and_ structured edits.

### Q24 - G2 is dropped

G2 promised that every GUI action displays its CLI equivalent. Most of Studio's actions have none and
never will - collapsing a pane, selecting a node, panning the map. The need behind it was
reproducibility, and [G1](features.md) delivers that properly: a directory of real files the CLI already
consumes, which does not have to be maintained action by action.

### Q23 - The VPL syntax tree is lossless

**Superseded in practice: upstream built it**, so Studio's own parser is gone. The reasoning is kept
because it is why the tree has the shape it does: **the text is the document**, spans point into the
original, and comments survive because they are never re-rendered - a property of the data structure,
not of a formatter behaving well.

### Q22 - One map surface, not four modes

Explore, Pipeline, Style and Publish are merged into a **single surface**. The four modes asserted a
separation the work does not have: tighten a filter, look at how it renders, adjust a colour - every one
was a mode switch.

**Supersedes [Q14](#q14---explore-and-pipeline-stay-separate-modes---superseded-by-q22)**; amended by
[Q31](#q31---panes-are-a-list-each-owning-its-output),
[Q32](#q32---a-project-holds-several-named-graphs) and
[Q39](#q39---the-asset-manager-is-a-dialog).

### Q21 - Recents and views are application state

A7 said view bookmarks are "stored in the project". They are not: both they and the recent-sources list
live beside the application's data, as JSON. **Why not SQLite**, even though `rusqlite` is already
linked: concurrency, partial updates and queries over large sets are its advantages, and none apply.
**Amended by [Q38](#q38---views-are-camera-positions-on-the-map).**

### Q20 - GDAL is raster-only in release 1

Vector reading is `from_geo`, which needs no GDAL at all, and **there is no GeoPackage path anywhere** -
E3's claim to the contrary was wrong. Users convert with `ogr2ogr` first, precisely the toolchain step
`vision.md` says P2 will not get through. **Revisit** by teaching `from_geo` to read it directly: it is
SQLite.

### Q19 - GDAL is statically bundled

E3 is required for M3, so GDAL cannot be optional and cannot be a system dependency. **The obvious
blocker turns out to be solved**: PROJ normally needs `proj.db` at runtime, and RFC-8's
`EMBED_RESOURCE_FILES` defaults to ON for static builds - verified rather than assumed. Dynamic linking
costs ~70 Homebrew formulae.

### Q18 - Svelte components are written from scratch

`@versatiles/svelte` is a **reference to read, not a package to import**. Studio's shell has
requirements no other consumer has - one `Map` owned by the core, panes that reconfigure, a graph
pane that edits text through a syntax tree - and the coupling would run both ways, with Studio's
needs distorting a library other projects depend on.

### Q17 - A3, the layer stack, is dropped

No stacking several containers in one view with opacity, swipe and split. Dropped, not deferred:
[Q14](#q14---explore-and-pipeline-stay-separate-modes---superseded-by-q22) removed the sources strip
that would have held it, and [Q16](#q16---one-instance-one-window-per-project) mostly
replaces it - comparing two containers is two windows side by side. **Release 1 therefore has no
comparison view at all.**

### Q16 - One instance, one window per project

Not tabs, not separate application instances. Tabs share one WebGL budget and one crash blast radius;
separate instances fragment the job queue and the asset writer, and **Tauri already gives us the
isolation** - every webview is a separate OS process. **Nothing may live only in the webview**, narrowed
by [Q35](#q35---a-graphs-name-is-chosen-once) to _work you would have to redo by hand_.

### Q13 - Studio is a workbench

The workbench-versus-P1 tension resolves for the workbench: no simplified mode, and P1 is expected to
cope. **The P1 risk is accepted, not overlooked** - `audiences.md` warns that "a rough edge a developer
shrugs off will stop a journalist entirely", and if P1 adoption stalls this is the first decision to
revisit.

_[Q48](#q48---a-window-is-a-project) made it a window of its
own._

### Q14 - Explore and Pipeline stay separate modes - **superseded by [Q22](#q22---one-map-surface-not-four-modes)**

> Kept for the record, trimmed to what outlived it.

**What survives: there is no sources pane at all.** Settled here after two revisions, because the
`from_*` read nodes at the head of the pipeline **are** the sources, so a separate list duplicates
them.

### Q15 - The pipeline pane tabs graph and text

One pane, two tabs, not side by side - which also settles the small-screen question. Side-by-side
existed so a user could see graph and file agree, so the tabs owe that back: the Graph tab never shows a
stale graph, the VPL tab carries an error badge, and switching is free because both are views over one
syntax tree.

### Q11 - The node graph is in release 1

M4 means node graph **plus** text editor. The catalogue assumed C1 was cheap because "the parser
exists" - it parses, but cannot write back. So the graph edits text through **span-based edits over a
lossless syntax tree**: regenerating from the AST would reformat the file and delete the comments on
every interaction.

### Q4 - Analysis statistics live in memory

No sidecar files, no results in the project file. Scanning is three costs and only the third needed
solving: metadata and zoom range are free from the block index, tile sizes are index-only, and tile
_contents_ are expensive but bounded by sampling. The third samples by default, with a full scan as an
explicit cancellable job.

### Q7 - No `planetiler`; E5 is dropped

Closed as **no**, permanently rather than deferred. Java 21+, 0.5× the PBF size in RAM, 5-10× on
disk, ~1 GB of downloads before the first run. Detecting an existing JVM makes the feature invisible
to the audience that needs it; bundling one adds 50-190 MB to ship, sign and update; Docker is absent
in the public administrations this targets.

### Q12 - Cluster B stays out of release 1

The algorithm for B2's per-layer byte breakdown exists and is proven, but **it is not reachable as a
library**: `mod tools;` is declared in `main.rs`, so `layer_stats()` is binary-only. B1, B2 and B3 are
mostly **visualisation over existing numbers**, which strengthens the case for taking them first after
release 1.

### Q8 - Release early under v0.x

Ship `v0.x` from stage 1; reserve the announcement for when all four milestones are in. **But the
framing matters**: if the first public build is a viewer, Studio gets categorised as "a tile viewer",
and first categorisations stick. **Why not stay silent entirely:** the macOS Gatekeeper path cannot be
tested by reading our own instructions.

### Q6 - A project is a directory of real files

`project.yaml` beside real `.vpl` and `style.json` files. **Reference, do not embed** - the ecosystem
already chose this: `versatiles serve` resolves relative paths against the config directory, so a
Studio pipeline runs unchanged under `versatiles convert` and a Studio style loads unchanged in
MapLibre. Embedding a text DSL in JSON would mean escaped newlines and unreadable diffs.

### Q3 - Three planes: IPC, HTTP, Channels

Control over Tauri IPC; data over the embedded HTTP server; events over Tauri Channels. **Forced, not
stylistic**: Tauri serialises command returns as JSON, which is slow for large payloads. **Studio's own
tiles take a detour through the webview**, through a `studio://` protocol holding a bounded queue,
because MapLibre reports a tile as loading the moment it _issues_ a fetch.

### Q10 - Release 1 ships unsigned

**Amended: Windows x86_64 is built, and unsigned.** What costs money and lead time is the
_certificate_, not the build. **arm64 was attempted and dropped the same day**: `gdal-sys` ships
prebuilt bindings for four targets, `aarch64 + windows` is not among them, and it generates none unless
`bindgen` is on - which a bundled build cannot use.

### Q2 - Release 1 scope follows the milestones

Analysis audience or creation audience first? Moot - the four milestones are funded, spanning clusters
A, D, E and C, and **cluster B is not in scope**. Four independent sources agree: of 76 showcase
projects 24 are tagged `journalism`; the documentation backlog is almost entirely creation workflows;
`@versatiles/style` sees an order of magnitude more downloads than anything else.

### Q9 - Fonts and sprites are fetched per family

Three tiers: **bundled** (sprites plus Latin-only Noto Sans, 1.9 MB), **on demand** (one family), and
**everything** (107 MB, for offline use). Works offline from first launch, with no 109 MB wall before
anyone has seen a map. **Archives are served, never unpacked**, so each asset stays atomic to verify and
delete.

### Q1 - Studio is a native Tauri v2 application

Not a subcommand serving a browser UI: native file dialogs, drag & drop, file type associations and
being findable as an application outweigh the alternative. **v2, not v1**, because
[Q16](#q16---one-instance-one-window-per-project)'s windows,
[Q3](#q3---three-planes-ipc-http-channels)'s Channels and `tauri-specta` depend on it. **In exchange:**
signing and notarisation costs, and building auto-update ourselves.

### Q5 - No Node runtime is shipped

Every JavaScript library Studio needs runs in the browser, so all of it is bundled into the webview
at build time. Node stays a build-time dependency.

**Consequence:** SVG export (F6) is bounded by what the webview can render. Headless or batch image
export has no path here - acceptable, since it is not a v1 goal.
