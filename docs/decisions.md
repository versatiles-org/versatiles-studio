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

### Q51 - A layer override applies on whatever basis the style was arrived at

**Decided 2026-08-26.** The layer tree is shown for every vector source, but only a preset style
applied the overrides it wrote: `renderStyle` ran them, and `deriveStyle` - which is handed layers
and sources, and never sees a recipe - could not. So on a
derived or fallback style (S6.2) the eye closed, the recipe recorded it, the project saved it, and the map did not change.
Colour, filter and zoom range were equally inert; visibility was just the one anyone would notice.

The alternative was to gate the tree to preset styles, which is the smaller change and the wrong
one: a container that no preset can draw is exactly the case where a per-layer control is worth
most. So the overrides moved to the choke point instead - `styleFor` applies them to whichever
style it picked, before `composeStyle` prefixes any ids. Raster and hillshade are untouched: they
draw one layer, and switching that off is the source's eye
([Q49](#q49---an-eye-means-this-runs-at-both-scales-the-pin-is-retired)), not a tree with one row.

### Q50 - Sources and Pipeline are two panes, and the sources list is where a stack is arranged

**Decided 2026-08-26.** The pane titled "Sources" held four groups - the graphs, the chain, the crop
and the actions - scrolled, and was named after one of them. They are two objects at different
levels: a list of graphs is the project, a chain is one document. That is
[Q31](#q31---panes-are-a-list-and-each-one-owns-what-it-emits)'s document-versus-selection line, so
they split along it. **Sources** keeps the list and `＋ new graph…`; **Pipeline** takes the tabs, the
chain, the crop and the actions, since each pane owns what it emits.

**This is not the sources pane [Q14](#q14---explore-and-pipeline-stay-separate-modes---superseded-by-q22)
and [Q22](#q22---one-map-surface-not-four-modes-the-mode-bar-separates-map-work-from-non-map-tools)
refused**, and the log reads as if it were. What they rejected was a list of `from_*` read nodes
beside a graph that already draws them. A list of _graphs_ is not that list, and graphs did not exist
until [Q32](#q32---a-project-holds-several-named-graphs-and-every-node-is-a-form).

**The draw order moves into that list, rather than being a second one.** The style pane kept its own
list of the same sources with ↑/↓ beside them - which was the layers panel, split across two panes,
one half holding the eyes and the other the order. Now the row order _is_ the draw order. It also
fixes what the copy got wrong: it listed only sources that had **built**, so a graph that would not
build vanished from the one control that could move it.

**A pane split out of another arrives beside it.** `reconcile_panes` appends a pane a stored layout
has never heard of, which is right for something new and wrong here - it would put the list of
graphs below the style pane, in a build where reordering panes by hand deliberately does not exist.
A stored layout naming `pipeline` gains `sources` immediately above it, on the same side.

**What this costs.** Four panes in the left sidebar is four headers of chrome, and the default order
matters more than before because [Q31](#q31---panes-are-a-list-and-each-one-owns-what-it-emits)
deferred dragging them. **The style pane is still overloaded** - six sections after losing the draw
order - and splitting it is the open question. Not as "Style and Layers": Q49 made the sources list
the layers panel, and a second pane called Layers would put two meanings of the word one level apart
on the same screen.

_Amends [Q22](#q22---one-map-surface-not-four-modes-the-mode-bar-separates-map-work-from-non-map-tools)'s
three sections and [Q31](#q31---panes-are-a-list-and-each-one-owns-what-it-emits)'s pane list._

### Q49 - An eye means "this runs", at both scales; the pin is retired

**Decided 2026-08-26.** One meaning at both scales: an eye says its row is processed. A graph's says
it is built, mounted, drawn and named in `style.json`; a node's says that operation is in the
pipeline that runs.

**A bypass, not a cut.** Node eyes are independent, so switching one off drops that node and the
rest carry on. The pin could not express `from_stacked [ a, b ]` without `b` - it darkened `a`, the
composite and everything after - which is what decided this. Two eyes cannot be switched off: the
node a graph starts with, which _is_ the graph's own eye, and a composite's last source.

**Amends [Q32](#q32---a-project-holds-several-named-graphs-and-every-node-is-a-form)**, whose pin
this replaces. It also fixed what the pin took with it: saving while a node was pinned wrote a
`style.json` naming that one source.

### Q48 - A window is a project, and the launcher is a window of its own

**Decided 2026-08-25.** The landing screen was a full-screen overlay shown whenever a window had no
graphs ([Q13](#q13---studio-is-a-workbench-new-projects-start-from-a-landing-screen)). A launcher
inside a project window makes the window two things, so "new project" comes to mean "empty this
window out", and a second project cannot be started without abandoning the first.

**This is what finally makes [Q16](#q16---one-application-instance-one-window-per-project) true.**
Every piece of project state was one application-wide `Mutex`, so ⌘N opened a second window onto the
same project, sharing an undo stack and a viewport. The core now holds a project per window, keyed
by the window's label; around forty commands gain the window they were called from.

### Q47 - The verbs about the project live in a native menu, and ⌘S saves the project

**Decided 2026-08-25.** Five controls sat in the top-right corner - a menu bar drawn by hand, in the
one corner of the window where a menu is not. Native menus get the accelerators, conventions and
keyboard navigation for free, and S0.1 had listed them as outstanding since the shell was built.

**The menu says which; the window says what.** `menu.rs` emits `studio://menu` with an item id and
stops there, so every action stays beside the state it touches - the shape `studio://opened`
established. `New Window` and `Show Problem Log` answer themselves in the shell, since no window is
involved in either.

### Q46 - An overlay on the map is one helper with one test, not three copies of a pattern

**Decided 2026-08-24.** `TileGrid`, `TileActivity` and `CropOverlay` each hand-rolled the same
lifecycle - a GeoJSON source, its layers, putting both back after a restyle, taking them away on
teardown - and each had a different subset of it right. It is now `lib/map/overlay.ts`, with
`lib/map/source-layers.ts` beside it.

**What none of them had:** a source and its layers ensured _separately_. Guarding the whole overlay
on its source meant `addSource` succeeding and a later `addLayer` throwing left it half-drawn for
the life of the style, silently, because every later call returned early on the source it had just
added. Anything still missing once the map is `idle` now says so with the error that stopped it.

**`isStyleLoaded()` is not the guard it looks like.** `Style.loaded()` is false while _any_ tile is in flight, which with a background basemap is most of the time. `TileActivity` - the overlay _about_ tiles in flight - was gated on it. `addSource` throws only when there is no style at all, so the helper tries and lets the events bring it round.

### Q45 - The feature popup answers for Studio's tiles only, and stays inside the map

**Decided 2026-08-23.** `queryRenderedFeatures` with no filter queries every layer, so a click
returned the background's OSM roads and labels. A8 is "what is in _your_ tile"; the background is
scenery. The query is restricted to the layers on the graph's mount - **matched by source**, which
is the one thing true of Studio's tiles however they are drawn, since a graph's name is its mount
and its style source at once.

**The layer list is worked out once per style, not once per mouse move.** Calling `getStyle()` from
`mousemove` serialises every layer and source the style has, which broke crop drawing outright:
listeners run in one ordered loop, and the rectangle's own handler never got a usable turn. A
listener registered ahead of others is not free to be slow or to throw - which is also why the popup
stands down entirely while a crop is being drawn.

### Q44 - A crop being dragged is drawn as a rectangle; the dim is for a crop that exists

**Decided 2026-08-23.** Dimming everything outside the crop is the right picture for a crop that
exists - a crop is not a rectangle on the world, it is the part of the world that survives. It is
the wrong picture for one being dragged: starting a small box turns the whole map dark, which reads
as the map breaking, and hides what you are aiming at.

So the draft is its own overlay, dashed where the real one is solid, and only ever one of the two is
on screen. **A drag released off the map is abandoned** by a window-level listener, since MapLibre's
`mouseup` fires only over the canvas.

### Q43 - The crop folds away, and the Pipeline pane's three actions are centred and full size

**Decided 2026-08-23.** Most graphs are exported whole, so a zoom row, four bbox fields, three
buttons and an estimate sat under every chain for a decision nobody had made. Closed, it is one row -
but **a crop that is set says so while it is closed**, because a graph narrowed to one city and
exported as one city, with nothing on screen to say why, is the serious failure. Folding may hide
the controls; it may not hide the state.

**The fold is local**, unlike a pane's: a disclosure inside a pane is a gesture to restore, not work
([Q35](#q35---a-graphs-name-is-chosen-once-and-the-core-remembers-work-rather-than-cursors)), and
local is what makes "closed by default" true on every launch rather than only on a fresh install.

### Q42 - The estimate is asked for, in the one place that still shows it

**Decided 2026-08-23. Corrected 2026-08-24.** The estimate runs the real pipeline over a stratified
sample under a two-second budget (S3.7) and is not cached. Where that buys a feedback loop it is
worth paying unasked; in the export dialog there is no loop, because the crop is settled and the
dialog covers the pane that would change it. So the dialog offers **Estimate size and time**, and
the answer replaces the button directly above the control that commits.

**What this costs:** someone can export without knowing what it will cost - a real loosening of C6.

### Q41 - What a graph produces is reported where it is about to matter: the export dialog

**Decided 2026-08-23.** The Produces pane held format, zoom, extent and the layers with their
counts. It moves into `ExportDialog` and the pane is removed. "Choose a file" is the last moment to
notice that the layer you meant is missing or named after the wrong file - the same kind of noticing
that already made the dialog restate the crop.

**The numbers had to change subject to be correct.** The pane read `preview.last`, which followed
the pin, so with a node pinned it described _that node's_ output while an export always writes the
graph. The dialog asks for the graph's own preview by name when it opens.

### Q40 - C7 is dropped: four artefacts that never composed into one story

**Decided 2026-08-23.** S5.5's "Run this elsewhere" dialog generated four files from the project. It
is removed, with `deploy.rs` and the `deployment` command.

**It was sorted by file format, and people arrive with a verb.** Two tabs built tiles, two served
them, and the two halves contradicted each other: the workflow built containers and uploaded them,
the Dockerfile ignored containers and served the `.vpl` live. No path through the dialog built tiles
and then served the built thing - the one route most people want. Two of the four were not
alternatives at all; the Dockerfile's first instruction copied the tab beside it.

_Drops [C7](features.md)._

### Q39 - The asset manager is a dialog, and with it the mode bar goes

**Decided 2026-08-23.** Built as a mode, it was one in name only: `AssetManager` rendered inside the
map region while everything layered over that region kept rendering, so the font list came up with
map buttons floating on top of it. A mode replaces a surface; this never replaced one.

**It is an errand.** You leave the map to fetch something you will bring straight back, and you want
the window as you left it. Closing the dialog stops nothing - an install is a job, and the list
catches up when it lands.

**So the modes go**, since [Q22](#q22---one-map-surface-not-four-modes-the-mode-bar-separates-map-work-from-non-map-tools)
itself said a one-item bar "would be chrome that switches between nothing and itself". The bar
survives as an application bar, not a mode bar. Q22's actual finding - that non-map tools do not
divide the map work - outlives the control it chose to express it with.

_Amends [Q22](#q22---one-map-surface-not-four-modes-the-mode-bar-separates-map-work-from-non-map-tools)._

### Q38 - Views are named camera positions, they live on the map, and the inspector holds neither them nor a way in

**Decided 2026-08-23.** Three S1-era surfaces in the right pane outlived the decisions that gave
them a home.

**The inspector had its own way in** - an "Open a tile container…" button and a URL form, from when
opening a container was all Studio did. [Q32](#q32---a-project-holds-several-named-graphs-and-every-node-is-a-form)
made opening a file mean creating a graph, and the pipeline pane had already merged "+ Add source"
into "＋ new graph…"; this was the other half of that merge, never done.

**A7's bookmarks are named camera positions, and they moved to the map.** They store a camera and
jump to it, which is the same act as the coordinate box and nothing to do with what a container
turns out to be - the coupling gave it away: the save button was disabled whenever there was no map.

### Q37 - D3's expression editor edits filters, because that is where the expressions are

**Decided 2026-08-23.** [S4.5](history.md) left "editing colour expressions" as its
remaining half. Scoping it found the premise wrong: across the six presets' 1,503 layers there are
1,825 colour paint properties and **not one is an expression**, while 1,475 of those layers carry a
filter and **every one is**. `deriveStyle` writes plain colours too, and there is no style import -
so a colour expression cannot occur by any path, and an editor for it would have had nothing to open.

Filters are the other half of the same D3 sentence and the one never built.

**Text, not a builder.** The vocabulary is narrow enough that a row-per-clause editor would cover
most filters and then refuse the rest, and an editor that cannot open what it is pointed at is worse
than one showing the value as it is. **Validated by `featureFilter`**, the function MapLibre itself
calls, so what the editor accepts is exactly what the map will draw.

### Q36 - The core owns the style's recipe, not the style

**Decided 2026-08-21.** The core stores what the style is made from - preset, options, and sparse
per-layer overrides - not the rendered MapLibre style. A few hundred bytes; the style is rendered
from it in the webview, where the generator is.

**Because the output does not fit the stack it would have to live on.** `history.rs` keeps
whole-text snapshots on the grounds that "a pipeline is a few hundred bytes". True of a pipeline,
false of a style: `colorful` is 125 kB across 324 layers, so 200 snapshots is 25 MB of undo history
for one session.

### Q35 - A graph's name is chosen once, and the core remembers work rather than cursors

**Dated 2026-08-18.** **Saving to a new filename does not rename the graph.** Q32 made the name the
identity in three places at once; read as an invariant running both ways, saving `basemap` to
`hillshade.vpl` would move the server mount and rewrite the style's source name as a side effect of
picking a filename. The strength of Q32's claim is what makes that unacceptable, so the binding runs
one way: the name supplies the default filename, never the reverse.

**The name is chosen when the graph is created, from whatever was opened** - the other half of the
same decision, since a filename cannot correct it later. `berlin.mbtiles` makes a graph called
`berlin`. The rule lives in the core so the two ways in cannot disagree, and `add_graph` takes the
**source** rather than a name, since a caller passing a path produced `users-me-data-berlin-mbtiles`.

### Q34 - Studio carries a pinned `proj-sys` fork until the `libsqlite3-sys` conflict resolves upstream

**Dated 2026-08-17.** `gdal-src` → `proj-sys` wants `libsqlite3-sys >=0.28, <0.36`;
`versatiles_container` → `rusqlite` wants `^0.38`. `libsqlite3-sys` declares `links = "sqlite3"`, so
cargo permits exactly one copy, the ranges are disjoint, and the dependency is not optional in
either chain - no combination of features resolves it.

**The fix is upstream, and both routes were asked for:**
[versatiles-rs#226](https://github.com/versatiles-org/versatiles-rs/issues/226) to loosen the
requirement, and [georust/proj#261](https://github.com/georust/proj/pull/261) to widen the ceiling -
a one-line change, since `proj-sys` has no API surface at all.

Studio carries that patch meanwhile, pinned to a commit rather than a branch so a rebase cannot
change what it builds, with the exit condition beside it: **remove it as soon as either lands.** It
is the only thing in the tree depending on a repository we control rather than a published crate.

### Q33 - The node form explains itself without symbols to learn

**Dated 2026-08-18.** **Parameter help sits beside the sidebar, over the map.** Measured before
deciding: 127 parameters, median 95 characters, p90 262, max 481. In a 280px sidebar that is three
lines typically and seven at the p90, overlaying the form being filled in; at 26rem beside it, one
and a half. One fixed-position element at application level, positioned from the trigger's measured
rect, since the sidebar scrolls and clips.

**Hover to peek, click to pin**, because scanning a form and copying an example out of it are
different needs. Only the pinned state has a close control - a peek that needs dismissing is not a
peek. The trigger is the `?`, not the row, or sweeping down a form would flash a popover per
argument. The summary line comes from `field_meta` rather than the prose: `whole number 0-30 ·
required` is frequently the whole answer and the part the prose buries.

### Q32 - A project holds several named graphs, and every node is a form

**Dated 2026-08-18.** [Wireframe](https://claude.ai/code/artifact/69159dd5-bfb3-4619-bbee-eb5a5c15497a).
Supersedes [Q25](#q25---the-vpl-editor-is-a-textarea-with-a-highlight-overlay-over-one-document-per-window)'s
"one pipeline document per window"; amended by
[Q33](#q33---the-node-form-explains-itself-without-symbols-to-learn) and
[Q49](#q49---an-eye-means-this-runs-at-both-scales-the-pin-is-retired).

**Q25 answered a different question.** It offered several sources as `from_stacked [ a, b ]`, which
merges inputs into **one** tile source. A map style needs the opposite: MapLibre's `sources` is a map
of independently addressable sources, and a real style is vector tiles plus hillshade plus terrain,
each named separately. `from_stacked` stays; it answers a different question.

**A graph is a named VPL document producing one named tile source.** The name is the identity in
three places at once - the server mount, the `style.json` source and the `.vpl` filename - which is
what makes [Q6](#q6---a-project-is-a-directory-of-real-files-with-a-yaml-manifest)'s project directory
read properly. **Renaming rewrites style references**, as one operation that either completes or does
not; forbidding renames once a style points at a graph is worse, since that is when you most want to.

### Q31 - Panes are a list, and each one owns what it emits

**Dated 2026-08-18.** **The axis is document versus selection**: left is the structure of what you
are building, right is the thing currently selected. Two alternatives lost against the full feature
inventory - _left = tile data, right = style_ leaves every analysis feature homeless and re-creates
modes as columns; _left = interaction, right = information_ has a home for everything but does not
survive contact, since A6 edits TileJSON and B3 has a repair button.

**Each pane owns what it emits.** The Export section is dissolved: "export tiles" belongs to the
Pipeline pane and "export style" (D8) to the Style pane. That closes a real gap - Q22 named one
Export section, [ui.md](ui.md) defined it as tiles-only, and D8 therefore had no declared home.

**Amended by [Q32](#q32---a-project-holds-several-named-graphs-and-every-node-is-a-form):** the
Parameters pane is removed, since a node carrying its own arguments makes it a second view of the
same thing - which moves the axis closer to _what you are building_ versus _what it turns out to be_,
nearly the split rejected above.

### Q30 - A CSV import reads the header and fills in what it can

**Dated 2026-08-17.** [Q29](#q29---the-import-form-learns-the-data-by-probing-what-the-pipeline-produces)
teaches the form by probing what the pipeline produces, which cannot work here: `from_csv` will not
build until `lon_column` and `lat_column` are set, so there is no output to look at. This is the one
import where the question has to be asked of the input, so the header is read at import time and the
answer written into the node.

**Not `x` and `y`.** They are coordinates often enough to be tempting, and projected metres or a grid
index often enough that a guess would sometimes produce a map of somewhere that does not exist. A
guess here fills in a _required_ field, so a wrong one is worse than none.

### Q29 - The import form learns the data by probing what the pipeline produces

**Dated 2026-08-17.** `from_geo` takes lists of property names, and the person filling them in has no
way to know those names without opening the file in something else first. That was E1's "map
columns", and it was the part of an import that sent you elsewhere.

**Probed from the output, not parsed from the input.** `analysis::probe_layers` decodes one tile of
the built preview and reports its layers and property keys, so one implementation serves every
format - a GeoJSON, a shapefile and a CSV all arrive as vector tiles - including formats Studio has
never heard of.

### Q28 - One import catalogue, in the core, derived from the operation registry

**Dated 2026-08-17.** The list of what Studio can open was in four places and already wrong: the file
dialog named four extensions, the drop handler repeated them, Save named `.vpl` a third time, and
none knew about `from_geo` - which the binary had all along.

**The catalogue answers to the binary.** `import::kinds()` consults the operation registry and drops
any kind whose read operation is absent, so a card cannot offer something that fails on the first
click. Not hypothetical: [E3](features.md)'s GDAL path is a build-time decision
([Q19](#q19---gdal-is-statically-bundled-with-a-deliberately-narrow-driver-set)), and its card
appeared with no UI change the moment GDAL linked.

### Q27 - The job runner has two lanes, and the preview runs in one of them

**Dated 2026-08-17.** A conversion and a preview want opposite things. **`queued`** runs one job at a
time in submission order, because conversions compete for the same disk and cores and two at once
finish later than the same two in sequence. **`latest`** cancels whatever the lane was running: a
preview of a pipeline that has since been edited is a machine warming up over a stale question. One
FIFO serving both would make a preview wait behind a forty-minute export.

**This moved a decision out of the webview.** `refreshPreview` held a token and discarded replies
that arrived out of order - the work still ran to completion. Now the runner cancels it, and because
_which preview is current_ is a fact the runner owns, the command reports `superseded` rather than
the caller inferring it.

### Q26 - The IPC types are generated, and the generated file is committed

**Dated 2026-08-17.** [Q3](#q3---three-planes-ipc-for-control-http-for-data-channels-for-events)
deferred `tauri-specta` for being pre-1.0. The risk that avoided turned out smaller than the one it
accepted: `svelte-check` flags a _use_ of a missing field, not a missing field, so 19 interfaces and
26 wrappers were kept in step by hand and drift failed nothing until somebody read it.

**The generated file is committed, and a test fails when it is stale** - the same shape as
`cargo fmt --check`. That is what makes a pre-1.0 generator acceptable: if `specta` breaks, the
checked-in bindings keep working and only regeneration needs fixing.

Specta refuses to emit any 64-bit integer to avoid precision loss, so every `usize` and `f64` that
crosses carries an explicit representation. **It found things:** `JobEvent.fraction` was typed
`number` by hand and is `number | null` in truth, because `serde_json` writes `null` for `NaN`.

### Q25 - The VPL editor is a textarea with a highlight overlay, over one document per window

**Dated 2026-08-17.** ~~One pipeline document per window~~ - superseded 2026-08-18 by
[Q32](#q32---a-project-holds-several-named-graphs-and-every-node-is-a-form): a project holds several
named graphs. What survives is what the editor is built from.

**Not CodeMirror**, for three reasons. The hard part is already done - a highlighter needs to know
where every token is, and [Q23](#q23---the-vpl-syntax-tree-is-written-from-scratch-and-pinned-to-upstream-by-a-differential-test)'s
parser returns exactly that, so a second tokeniser would mean two definitions of the grammar in one
application. Undo belongs to the document rather than the editor, since G6 wants one stack covering
text _and_ structured edits. And the documents are short: a pipeline is a handful of nodes.

### Q24 - G2 is dropped. The bottom bar shows status and progress

**Dated 2026-08-17.** G2 promised that every GUI action displays its CLI equivalent. Most of Studio's
actions have none and never will - collapsing a pane, selecting a node, panning the map. In practice
one action wrote to the strip and every later action left that line sitting there, describing
something done minutes ago.

**The need behind it is real and met better elsewhere.** G2 was for reproducibility, and
[G1](features.md) delivers that properly: a directory of real `.vpl` and `style.json` files the CLI
already consumes. A whole project the CLI can run beats a copyable one-liner, and does not have to
be maintained action by action.

### Q23 - The VPL syntax tree is written from scratch, and pinned to upstream by a differential test

**Superseded in practice, 2026-08-17: upstream built it.** `versatiles_pipeline` 4.8.0 ships a
`CstFile` - a lossless tree with spans, trivia, structural edits and a serialiser - so Studio's own
parser is gone: `parse.rs`, `print.rs` and `differential.rs` deleted, around 700 lines removed for
250 added, and the thing that needed a differential test no longer exists. What stayed is what
upstream has no reason to carry: `validate.rs`, `tokens()` for highlighting, and `node_at`.

The reasoning is kept because it is why the tree has the shape it does. **The text is the document:**
spans point into the original rather than replacing it, so parse-then-print is the identity and a
structured edit is a splice at a span. Comments and layout survive because they are never
re-rendered - a property of the data structure, not of a formatter behaving well.

**Two upstream behaviours were reproduced rather than corrected**, since diverging quietly is worse
than either: a repeated key concatenates (`a=1 a=2` means `[1, 2]`), and VPL could not express an
empty string. The second was a UI constraint until 4.8.0 lifted it - clearing a field still removes
the parameter, but that is now a decision about the interface rather than a limit of the syntax.

### Q22 - One map surface, not four modes. The mode bar separates map work from non-map tools

Explore, Pipeline, Style and Publish are merged into a **single surface**.

**Why.** The four modes asserted a separation the work does not have. Tighten a filter, look at how
it renders, adjust a colour, notice a missing layer, go back to the filter - every one of those was a
mode switch. **Explore was never a mode**: it is map-plus-inspector with no left pane, which is this
surface with the sections collapsed. "I am not editing right now" is a pane state, not an activity.
**Publish was not one either** - an action surface plus a temporary map tool for the crop rectangle.

**Supersedes [Q14](#q14---explore-and-pipeline-stay-separate-modes---superseded-by-q22)** entirely.
**Amended by [Q31](#q31---panes-are-a-list-and-each-one-owns-what-it-emits)** (the sections become a
list of panes, the Export section dissolves), by
[Q32](#q32---a-project-holds-several-named-graphs-and-every-node-is-a-form) (parameters move into the
node) and by [Q39](#q39---the-asset-manager-is-a-dialog-and-with-it-the-mode-bar-goes) (the mode bar
is retired, having been left with one mode - the state this entry itself called chrome that switches
between nothing and itself).

### Q21 - Recents and bookmarks are application state in JSON files, not project state

A7 said view bookmarks are "stored in the project". They are not: both they and the recent-sources
list live beside the application's data, in `app_data_dir()`, as JSON - `recents.json` disposable,
`views.json` precious, `layout.json` added later by Q31.

**Why not SQLite**, even though `rusqlite` is already linked: its advantages are concurrency, partial
updates and queries over large sets, and none apply - one writer, a dozen recents, nothing to query.
What it would add is a schema and migrations, for state whose shape changes often. A JSON file the
user can read, grep and back up also honours "nothing only exists inside Studio" in a way an opaque
database does not.

**Amended 2026-08-23 by [Q38](#q38---views-are-named-camera-positions-they-live-on-the-map-and-the-inspector-holds-neither-them-nor-a-way-in):**
bookmarks are now views, and the file is read under its old name where an install predates the
rename. Only the words changed.

### Q20 - GDAL is raster-only in release 1; GeoPackage is not supported

`from_gdal` has only `raster` and `dem` submodules. Vector reading is `from_geo`, which needs no GDAL
at all, and **there is no GeoPackage path anywhere** - E3's claim to the contrary was wrong, and the
catalogue is corrected.

**Accepted for release 1**, since GDAL covers M3's "image data" half. GeoPackage users convert with
`ogr2ogr` first - which is precisely the toolchain step `vision.md` says P2 will not get through, and
the sharpest instance of that tension in the release. **Revisit** by teaching `from_geo` to read
GeoPackage directly: it is SQLite, so that needs no new native dependency.

### Q19 - GDAL is statically bundled, with a deliberately narrow driver set

E3 is required for M3, so GDAL cannot be optional and cannot be a system dependency. `gdal-src`
compiles it from source during `cargo build` and produces static libraries.

**The obvious blocker turns out to be solved.** PROJ normally needs `proj.db` on disk at runtime,
which would defeat a self-contained binary; RFC-8's `EMBED_RESOURCE_FILES` defaults to ON for static
builds. Verified rather than assumed - a transform succeeds with `PROJ_DATA` unset and no `proj.db`
present.

**Why not the alternatives.** Dynamic linking against a system GDAL costs ~70 Homebrew formulae, and
"install GDAL first" is exactly the toolchain P1 and P2 will never get through. Feature-detecting and
greying out E3 fails M3, which requires it.

### Q18 - Studio's Svelte components are written from scratch

`@versatiles/svelte` is a **reference to read, not a package to import**. Studio's shell has
requirements no other consumer has - one `Map` owned by the core, panes that reconfigure, a graph
pane that edits text through a syntax tree - and the coupling would run both ways, with Studio's
needs distorting a library other projects depend on.

### Q17 - A3, the multi-source layer stack, is dropped

No stacking several containers in one view with opacity, swipe and split. Dropped, not deferred:
[Q14](#q14---explore-and-pipeline-stay-separate-modes---superseded-by-q22) removed the sources strip
that would have held it, and [Q16](#q16---one-application-instance-one-window-per-project) mostly
replaces it - comparing two containers is two windows side by side. Not a swipe, but free and the
platform convention.

**Release 1 therefore has no comparison view at all.** B5 (container diff) is the first feature
needing two, and it is post-1.0, so a swipe control can be designed then.

### Q16 - One application instance, one window per project

Not tabs, not separate application instances. Tabs share one WebGL budget and one crash blast
radius; separate instances fragment the job queue and the asset writer, and cost a second core.

**Tauri already gives us the isolation** - every webview is a separate OS process, and the core can
restart one that goes invalid. So a window per project buys isolation we would otherwise engineer.
**The server does not need duplicating:** `add_tile_source` works on a running server, so each graph
and each preview is a named mount rather than a server of its own.

**Nothing may live only in the webview**, so a crash is recoverable by reloading that one window.
Promoted to an architectural principle - and narrowed by
[Q35](#q35---a-graphs-name-is-chosen-once-and-the-core-remembers-work-rather-than-cursors), which
draws the line at _work you would have to redo by hand_ rather than at every piece of UI state.

**Made true by [Q48](#q48---a-window-is-a-project-and-the-launcher-is-a-window-of-its-own)**, which
built the per-window project the heading describes, gave each project its own job list, and made the
launcher a window rather than what an empty project window shows.

### Q13 - Studio is a workbench. New projects start from a landing screen

The workbench-versus-P1 tension resolves for the workbench: no simplified mode, and P1 is expected to
cope. **The P1 risk is accepted, not overlooked** - `audiences.md` warns that "a rough edge a
developer shrugs off will stop a journalist entirely", the mitigation is polish and good defaults,
and if P1 adoption stalls this is the first decision to revisit.

_[Q48](#q48---a-window-is-a-project-and-the-launcher-is-a-window-of-its-own) made it a window of its
own. Everything else stands._

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

M4 means node graph **plus** text editor, not text editor alone. The catalogue assumed C1 was cheap
because "the parser exists" - it parses, but cannot write back: no serialiser, properties in a
`BTreeMap` that reorders them, comments discarded.

So the graph edits text through **span-based edits over a lossless syntax tree**, not by reparsing
and printing. Regenerating from the AST would reformat the user's file and delete their comments on
every interaction - the exact "GUI and file disagree" bug the source-of-truth principle exists to
prevent. Built upstream in the end, see
[Q23](#q23---the-vpl-syntax-tree-is-written-from-scratch-and-pinned-to-upstream-by-a-differential-test).

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

Ship `v0.x` from stage 1; reserve the announcement for when all four milestones are in. **Releasing
early is house style** - every versatiles repository that ships started small.

**But the framing matters.** If the first public build is a viewer, Studio gets categorised as "a
tile viewer", and first categorisations stick. So: GitHub releases only, an "under development"
banner stating what works, an early audience of P3 and ourselves, and 1.0 with the announcement
together. **Why not stay silent entirely:** the macOS Gatekeeper path cannot be tested by reading our
own instructions, and malformed containers in the wild cannot be manufactured.

### Q6 - A project is a directory of real files with a YAML manifest

`project.yaml` beside real `.vpl` and `style.json` files. **Reference, do not embed** - the ecosystem
already chose this: `versatiles serve` resolves relative paths against the config directory, so a
Studio pipeline runs unchanged under `versatiles convert` and a Studio style loads unchanged in
MapLibre. Embedding a text DSL in JSON would mean escaped newlines and unreadable diffs.

### Q3 - Three planes: IPC for control, HTTP for data, Channels for events

Control (open a container, start a job) over Tauri IPC; data (tiles, glyphs, sprites) over the
embedded HTTP server; events (progress, warnings) over Tauri Channels.

**Forced, not stylistic.** Tauri serialises command returns as JSON and its own docs warn this is
slow for large payloads, so tile bytes must not travel over IPC.

**Studio's own tiles take a detour through the webview.** They still travel over HTTP; what changed
is who queues them. MapLibre fetches through a `studio://` protocol holding a queue bounded at the
browser's own per-origin limit, because neither end could otherwise answer the question S2.16 needed:
MapLibre reports a tile as loading the moment it _issues_ a fetch, and a counter inside the tile
source would only see the handful the browser let through. With the queue in the middle, "rendering"
means the server has it and "queued" means nobody has started. Only Studio's own tiles - queueing a
background map's would report someone else's network as this pipeline being slow.

### Q10 - Release 1 ships Linux packages and a Homebrew cask; signing comes later

**Amended 2026-08-23: Windows x86_64 is built, and unsigned.** What costs money and lead time is the
_certificate_, not the build, so Windows ships on the same terms macOS already does: an installer the
platform warns about, and instructions for getting past the warning.

**arm64 was attempted and dropped the same day.** `gdal-sys` ships prebuilt bindings for four
targets, `aarch64 + windows` is not among them, and it generates none unless `bindgen` is on - which
a bundled build cannot use. The upstream fix is one line, but applying it here means a second pinned
fork on top of [Q34](#q34---studio-carries-a-pinned-proj-sys-fork-until-the-libsqlite3-sys-conflict-resolves-upstream)'s,
and Windows on ARM runs the x64 build under emulation.

### Q2 - Scope of release 1 is set by the funding milestones

Analysis audience or creation audience first? Moot - the four milestones are funded, spanning
clusters A, D, E and C, and **cluster B is not in scope**. Four independent sources agree: of 76
showcase projects 24 are tagged `journalism` and at least 21 come from news organisations; the
documentation backlog is almost entirely creation workflows; `@versatiles/style` sees an order of
magnitude more downloads than anything else; and by share of features building on existing machinery,
the funded clusters are mid-range rather than cheap.

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
