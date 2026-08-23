# Decisions

Questions still open, then decisions taken. When a question is answered it moves down with a date
and a rationale. Evidence for the upstream claims below lives in the
[Ecosystem Inventory](ecosystem.md); this file records what we decided and why.

---

## Open questions

None. New questions get a `Q` number here, and move to **Decided** once settled.

---

## Decided

All dated 2026-08-16 unless an entry says otherwise.

### Q44 — A crop being dragged is drawn as a rectangle; the dim is for a crop that exists

**Decided 2026-08-23.** `CropOverlay` draws a crop by dimming everything outside it — one polygon
with a hole, so the fill and the edge can never disagree. That is the right picture for a crop that
exists: a crop is not a rectangle on the world, it is the part of the world that survives.

**It is the wrong picture for a rectangle being dragged.** Starting a small box turned the whole map
dark and grew a hole in it, which reads as the map breaking rather than as a rectangle being drawn —
and the thing you most need to see while aiming is the map you are aiming at.

So the draft is its own overlay: a lightly filled box in the crop's colour with a **dashed** outline,
solid being reserved for the crop that exists, so the difference needs no legend. Only one of the two
is ever on screen — while a rectangle is in flight, the crop it will replace is not the subject, and
two overlapping treatments is one too many to aim through.

**A drag released off the map is abandoned.** MapLibre's `mouseup` fires only over the canvas, so a
drag ending on a pane or outside the window never finished. That was invisible before and is not any
more — the draft rectangle would sit there until the next click — so a window-level listener clears
it. It runs after the canvas event has bubbled, which means an ordinary release has already been
handled and it has nothing to do.

### Q43 — The crop folds away, and the Pipeline pane's three actions are centred and full size

**Decided 2026-08-23.** Two changes to the Pipeline pane, both about what it puts in front of you.

**The crop section is a disclosure, closed by default.** Most graphs are exported whole. For those,
a zoom row, four bbox fields, three buttons and an estimate sat under every chain, permanently, for a
decision nobody had made — the pane's own version of the junk drawer
[ui.md](ui.md) warns about for the right pane. Closed, it is one row.

**A crop that is set says so while it is closed.** The header carries a summary — `z4–12 · area` —
because the failure mode of hiding this is the serious one: a graph narrowed to one city, exported
as one city, with nothing on screen to say why. Folding may hide the controls; it may not hide the
state.

**The fold is local, unlike a pane's.** [Q16](#q16--one-application-instance-one-window-per-project)
keeps durable state in the core, and [Q31](#q31--panes-are-a-list-and-each-one-owns-what-it-emits)'s
pane folds are durable for that reason. This is a disclosure _inside_ a pane, in the class
[Q35](#q35--a-graphs-name-is-chosen-once-and-the-core-remembers-work-rather-than-cursors) put scroll
position in — a gesture to restore, not work. Local is also what makes "closed by default" true on
every launch rather than only on a fresh install.

**`Draw on map` moved into the body.** It was in the header, and a header that is now a disclosure
button cannot hold a second control inside it. It sits with `This view` and `Clear`, which is where
it belonged anyway: the three ways to set a crop, together.

**Save · Save as… · Export… are centred, full size, and Export is the primary one.** They were
right-aligned in the corner at `--text-xs` with a hairline of padding — the smallest type in the
application, on the three things the pane exists to do. They now take `.button`'s own padding
([styling.md](styling.md)), sit centred under a rule of their own, and `Export…` carries the accent,
because it is what the other two lead to.

_Amends nothing: [Q31](#q31--panes-are-a-list-and-each-one-owns-what-it-emits) says each pane owns
what it emits, and this is a pane deciding how loudly to say it._

### Q42 — The export dialog's estimate is asked for; the crop section's stays live

**Decided 2026-08-23.** The estimate runs the real pipeline over a stratified sample under a
two-second budget (S3.7) and is not cached — every call pays it again. Where that buys a feedback
loop it is worth paying unasked. Where it does not, it is a button.

**In the crop section it buys the loop, so nothing changes there.** Drag a rectangle over the city
you mean and watch four hours fall to twelve minutes: the number is the feedback, and one you had to
ask for after every drag would not be feedback at all. That is C6's "shown where a run is committed"
and S5.4's reason for putting the crop in the pane, and it stands.

**In the export dialog there is no loop.** The crop is settled — the dialog is a modal and covers
the pane that would change it, which is why [S5.2](scope-release-1.md) moved the crop out of here in
the first place. What is left is a single number, wanted before some exports and not others, charged
two seconds every time the dialog opens. So the dialog opens saying what it will write, and offers
**Estimate size and time**; the answer replaces the button in the same place, directly above the
control that commits.

**What this costs.** Someone can now export without knowing what it will cost. That is a real
loosening of C6, mitigated by where the number already is: the crop section has it, live, for as long
as the crop is being decided — the dialog is the second telling, not the first.

**The dialog does not reuse the pane's answer**, and so re-runs work that was just done. It could be
handed the live one, but then there would be nothing for a button to do — which is the thing being
asked for. The alternative worth weighing if this proves wasteful is the other direction entirely:
make the crop section's estimate on-demand too, and have one answer that both surfaces show. That
trades away the drag-and-watch loop above, so it is not a change to make quietly.

_Amends [ui.md](ui.md)'s "an estimate you must go looking for is one you will not see", which is now
true of the crop section and deliberately not of the dialog._

### Q41 — What a graph produces is reported where it is about to matter: the export dialog

**Decided 2026-08-23.** The Produces pane held format, zoom, extent, and the layers with their
feature counts and property keys. It moves into `ExportDialog`, and the pane is removed.

**The export dialog could not describe what it was writing.** It said what the crop narrows to, what
container formats are on offer, and what the run would cost — and nothing at all about the artefact.
"Choose a file" is the last moment to notice that the crop is not the one you meant, which is the
reason the crop is restated there; the layer you meant is missing, or named after the wrong file, is
the same kind of noticing and had nowhere to happen.

**A pane is a poor place for a fact consulted twice a session.** It cost permanent width in the
right sidebar for numbers most people look at when something seems wrong or when they are about to
commit. The second of those now has a home; the first is discussed below.

**The numbers had to change subject to be correct.** The pane read `preview.last`, which follows the
pin ([Q32]): with a node pinned it describes _that node's_ output, while an export always writes the
graph. Reusing it would have put a description of one artefact directly above the button that writes
a different one. The dialog asks for the graph's own preview by name when it opens — fetched on
opening, like the copy plan and the estimate, because it is a function of the graph as it stands.

**What this costs, and it is not nothing.** The pane's stated purpose was catching a silent import
failure _while you build_: a GeoJSON that produced no features, or a layer named after the wrong
file, looks exactly like success on the map at low zoom — empty. That check now happens only when
someone opens the export dialog, and nobody exports on every iteration. The bet is that an import
that produced nothing is noticed at the first export rather than after an hour of styling, and that
a permanently-open pane was an expensive way to catch it. **Revisit if it turns out people build for
a long time before exporting** — the answer then is a diagnostic on the node that produced nothing,
in the chain where the mistake is, rather than a pane restating the whole output.

_Amends [Q22](#q22--one-map-surface-not-four-modes-the-mode-bar-separates-map-work-from-non-map-tools)'s
"resulting metadata" half of the right pane: what is left there is A6's opened container. Under
[Q31](#q31--panes-are-a-list-and-each-one-owns-what-it-emits) the pane list is a list, so removing an
entry is removing an entry — `reconcile_panes` drops the id from a stored layout, and an old file
costs nothing._

### Q40 — C7 is dropped: four artefacts that never composed into one story

**Decided 2026-08-23.** S5.5 shipped "Run this elsewhere" — a dialog with four tabs, generated from
the project as it stands. It is removed, along with `deploy.rs` and the `deployment` command.

**It was sorted by file format, and people arrive with a verb.** Two of the tabs _build_ tiles: the
`versatiles convert` line, per graph, and a GitHub workflow that runs the same conversions on push.
Two of them _serve_ tiles: `serve.yaml`, and a Dockerfile that runs it. One title covered both, and
"run" could mean either of them.

**Two of the four were never alternatives.** The Dockerfile's first instruction was
`COPY serve.yaml`; it does not work without the contents of the tab beside it. The component's own
comment said the opposite — _"Tabs rather than four boxes: they are alternatives"_ — which is the
design being wrong in a sentence rather than in a screenshot.

**And the two halves contradicted each other.** The workflow built `*.versatiles` containers and
uploaded them. The Dockerfile ignored containers and served the `.vpl` pipelines live, which is why
it had to carry a warning that the source data must be reachable from inside the container. Follow
both and the tiles you built are not the tiles you serve. **No path through the dialog built tiles
and then served the built thing** — the one route most people actually want.

**Fixing it was possible; keeping it was not obviously worth it.** Regrouping by verb and making the
serve half a file _set_ would have answered the first two objections, and picking build-then-serve
would have answered the third. What that leaves is Studio maintaining a small deployment opinion —
one Dockerfile shape, one CI shape, one serving model — for every downstream someone might have. The
module's doc had already conceded the limit of what it could know: the workflow ships "no caching, no
deploy step: where the result goes is the one part of this nobody else can guess". A generated
artefact that stops one step short of the answer is a template, and a template is better maintained
where templates live.

**The need it served is G1's, and G1 already serves it.** A project is a directory of real files
([Q6](#q6--a-project-is-a-directory-of-real-files-with-a-yaml-manifest)) — `.vpl` documents that
`versatiles convert` runs unchanged, in a folder `versatiles serve` can be pointed at. Reproducibility
is the file layout, not a dialog that types the invocation for you. This is the same ground
[Q24](#q24--g2-is-dropped-the-bottom-bar-shows-status-and-progress) settled when it
dropped G2's command strip: reproducibility "is served properly by G1". C7 was the fragment of that
idea which survived, and it turns out to have survived on the same reasoning that removed the rest.

**What is lost, said plainly.** Someone putting a map on a server now writes their own
`versatiles serve` config and their own Dockerfile. That is a real cost, borne by the audience
`audiences.md` describes as needing reproducibility most. It is accepted because the generated
versions were not correct together, and four artefacts that disagree cost more than none.

_Drops [C7](features.md). Amends [Q31](#q31--panes-are-a-list-and-each-one-owns-what-it-emits),
which assigned "the CLI command (C7) to whichever pane produced the thing it reproduces" — there is
no such command to assign. Amends [Q6](#q6--a-project-is-a-directory-of-real-files-with-a-yaml-manifest)'s
note that Studio exports a serve config as a derived artefact; it no longer does._

### Q39 — The asset manager is a dialog, and with it the mode bar goes

**Decided 2026-08-23.** [Q22](#q22--one-map-surface-not-four-modes-the-mode-bar-separates-map-work-from-non-map-tools) kept
a mode bar to separate working with the map from tools that are not about the map at all, and named
the asset manager (G7) as the second occupant that made a bar worth having. Built, it was a mode in
name only: `AssetManager` rendered _inside_ the map region while everything layered over that region
— the coordinate box, the view list, the map controls — kept rendering too, so the font list came up
with map buttons floating on top of it. The bug is the design telling on itself. A mode replaces a
surface; this never replaced one, because it was never that kind of thing.

**It is an errand.** You leave the map to fetch something you will bring straight back to it, and
you want the window exactly as you left it when you return. That is what a dialog is, and Studio
already had the shell for it — `Modal`, over the top layer, with Escape and focus containment for
free. Closing it stops nothing: an install is a job, the status bar reports it, and the list catches
up when it lands.

**So the modes go.** Q22 said a one-item bar "would be chrome that switches between nothing and
itself", and that is exactly what removing Assets leaves. The **bar** survives, because it had
quietly become something else — open, save, save a copy, run elsewhere, the update notice — but it
is an application bar, not a mode bar, and `ModeBar` is now `AppBar`. `Layout.mode` went with the
tabs: a window is never restored onto a dialog, so there is no surface to remember. An old
`layout.json` keeps its `mode` key and is ignored, like any other key this struct has stopped having.

**D9 does not lose its home.** Q22 parked locally generated glyphs with the asset manager rather
than in a third mode; that is still where they go, and the asset manager is now a dialog. What Q22
was actually deciding — that non-map tools do not divide the map work — survives the bar it chose to
express it with.

**Download all, with the total on the button.** [Q9](#q9--fonts-and-sprites-are-fetched-per-family-and-never-unpacked)
puts the size on each row so that 48 MB is a decision made before it starts rather than during; a
button that fetches every missing family has to answer the same question, so it carries the sum of
what it would fetch and disables itself — rather than disappearing — once there is nothing left.

**Sizes are megabytes down the whole column.** `bytes` picks the unit that suits each number, which
is right in a sentence and wrong in a list: `900 kB` above `1.2 GB` cannot be compared at a glance.
One unit, right-aligned, tabular figures, and a track of its own so the column does not depend on
how wide each row's buttons are — which is what actually kept these from lining up, since each row
is its own grid.

_Amends [Q22](#q22--one-map-surface-not-four-modes-the-mode-bar-separates-map-work-from-non-map-tools):
the mode bar it kept is retired, its remaining reasoning intact._

### Q38 — Views are named camera positions, they live on the map, and the inspector holds neither them nor a way in

**Decided 2026-08-23.** Three S1-era surfaces in the right pane outlived the decisions that gave
them a home, and they go together because they fail the same test.

**The inspector had its own way in.** An "Open a tile container…" button and a remote-URL form, from
S1 when opening a container was all Studio did. [Q32](#q32--a-project-holds-several-named-graphs-and-every-node-is-a-form)
made a graph _a_ source, so opening a file means creating a graph — and `PipelinePane` had already
recorded the consequence when it merged "+ Add source" into "＋ new graph…": two doors to the same
room, one door kept, next to where graphs live. The inspector's copy was the other half of that
merge, never done. It called `pick()` with no filter, so despite its label it accepted CSVs and
`.vpl` documents too, while the landing screen had already dropped exactly this card for naming
extensions the drop handler and the file dialog each repeated in their own words.

**A7's bookmarks are named camera positions, and they moved.** What they store is `lng`/`lat`/`zoom`
/`bearing`/`pitch` and a name; clicking one jumps the map. That is the same act as A5's
jump-to-coordinate box, and nothing to do with what an opened container turns out to be.
`MapControls` already stated the rule this pane was breaking — what belongs on the map is _anything
about looking at the result_ — and the coupling gave it away: the save button was disabled whenever
there was no map. So it sits **top-left**, as one button that opens the list, rather than a form
held permanently open for an act that is occasional.

**A corner each, rather than a camera cluster.** The obvious move was to put it beside the
coordinate box, the other control that goes somewhere. It reads better apart: the view list is the
one thing here that is used constantly and opens a panel, so it gets the empty corner and room to
open downward, while the bottom edge stays with the controls that are typed into or toggled.

**They are called views, not bookmarks.** Everywhere else a bookmark points at a _document_; this
points at a position _inside_ one. The name invited the question "is this how I save a pipeline for
later?" — which is what a graph and the recents list are for, and recents already occupy the
"things I opened and want back" slot. Two names for that idea in one application is one too many.

**The `source` field went with the rename.** It was documented "so a bookmark can offer to reopen
it", nothing ever reopened it, it reached the UI only as a tooltip, and it was filled from
whichever container happened to be mounted last — arbitrary once more than one was open. A view is
a place, and a place does not belong to a file.

**The order is the user's.** `add` sorted alphabetically, which is defensible only while there is no
other order to destroy; a new view is now appended and `reorder` takes the whole list of names, so
the core has the last word on what an index meant and a reorder racing with a save from another
window cannot drop anybody. Re-saving a name replaces that view **where it already sits**: it is the
same view with the camera moved, not a new one.

**Jumping, not flying.** These get used to compare one place at two zooms or two angles, and an
animation between them is time spent watching the subject slide past. The list marks the view you
are on, so drifting off one is visible rather than guessed at.

**`bookmarks.json` became `views.json`, and the old file is read and left alone.** An install that
predates this comes back with its views; the next save writes the new name and the old file stays
behind as a backup rather than being deleted on the user's behalf — the one policy that loses
nothing if the rename was a mistake. This does not reopen [Q21](#q21--recents-and-bookmarks-are-application-state-in-json-files-not-project-state):
the file is renamed, its recovery policy is not.

_Amends A7 twice — Q21 already corrected where it is stored; this corrects what it is called and
where it appears. Amends [Q32](#q32--a-project-holds-several-named-graphs-and-every-node-is-a-form)'s
right-pane rule by enforcing it: what is left in the inspector needs no map and no file dialog._

### Q37 — D3's expression editor edits filters, because that is where the expressions are

**Decided 2026-08-23.** [S4.5](scope-release-1.md) delivered the layer tree and recorded its
remaining half as "a colour that is an _expression_ is shown as one and left alone; editing those is
what remains". Scoping that work found the premise wrong.

Generating all six presets and walking every node says: across 1,503 layers there are **1,825 colour
paint properties and not one of them is an expression**, while **1,475 of those layers carry a filter
and every one is**. `deriveStyle` ([S4.4](scope-release-1.md)) writes plain string colours too, and
there is no style _import_ — `StylePane` only ever saves. So a colour expression cannot occur in
Studio by any path, and the `ƒ` swatch marks a branch nothing reaches. An editor for it would have
had nothing to open and no way to be tested against real data.

Filters are the other half of the same D3 sentence — "filter / zoom / paint editing" — and were the
one of the three never built, though `LayerOverride.filter` was plumbed through the core from the
start and simply never sent.

**Text, not a builder.** The vocabulary the presets use is narrow — `get`, `==`, `all`, `!=`, `has`,
`!`, `in` and the comparisons — so a row-per-clause editor would cover most filters and then have to
refuse the rest. An editor that cannot open what it is pointed at is worse than one that shows the
value as it is: a filter is already JSON, and 318 of them round-trip through the formatter in a test.

**Validated by `featureFilter`**, the function MapLibre itself calls to turn a filter into a
predicate, so what the editor accepts is exactly what the map will draw rather than a second opinion
that can drift. It is lenient about shape — a bare string, `true` and `[]` all pass — so those are
refused before it is asked.

**Cost to accept:** someone who wants to change a colour that _is_ an expression still cannot, if a
style ever arrives with one. Nothing produces one today; if a style import lands, this is the item
that reopens.

### Q36 — The core owns the style's recipe, not the style

**Decided 2026-08-21.** A project has one `style.json` ([Q32](#q32--a-project-holds-several-named-graphs-and-every-node-is-a-form)),
and the core owns it — the same way it owns each graph's VPL, and for the same reason: [S4.7](scope-release-1.md)
requires style edits to land on the one undo stack, and that stack is in the core. What the core
stores is **not** the MapLibre style. It stores what the style is made from:

```text
preset      colorful | graybeard | neutrino | … | derived
options     the @versatiles/style RecolorOptions, colours, fonts, language
overrides   sparse, per layer: paint, filter, zoom range
```

A few hundred bytes. The style itself is rendered from it in the webview, where the generator is.

**Because the output does not fit the stack it would have to live on.** `history.rs` keeps whole-text
snapshots and says why: "a pipeline is a few hundred bytes, so a hundred of them costs less than a
single map tile." That is true of a pipeline and false of a style. Measured: `colorful` is **125 kB
across 324 layers**, so 200 snapshots is 25 MB of undo history for one session. Storing the recipe
keeps the mechanism that already works instead of adding a second one with different rules.

**It is also what D8 asks for.** "Export as `style.json`, as `@versatiles/style` code, or as a
bundle" — the code _is_ the recipe. A design that kept only the rendered style could emit the first
and never the second, and D8 would have needed a second source of truth to get it back.

**And it takes the generator out of the edit loop.** Dragging a colour sends one small patch rather
than 125 kB per frame; the webview re-renders locally at whatever rate the pointer moves, and one
undo entry is committed when it is released. That was the concern that opened this question, and the
recipe answers it without a special case.

**What we accept.** Anything not expressible as preset + options + per-layer overrides cannot be
edited — adding or reordering layers, most obviously. [D3](features.md) asks for filter, zoom and
paint editing, all of which are per-layer, so release 1 does not need it. A `style.json` written by
someone else has no recipe to import, which is why it is an output of a project rather than an input
to one ([Q6](#q6--a-project-is-a-directory-of-real-files-with-a-yaml-manifest) already lists it that
way).

**Rendered on save, not stored.** The webview hands the finished style to the core to write, the way
a preview hands over a built pipeline. `style.json` on disk stays a real MapLibre style the CLI can
consume; the recipe lives in `project.yaml` beside it.

### Q35 — A graph's name is chosen once, and the core remembers work rather than cursors

**Dated 2026-08-18.** Two things the pipeline-pane audit left open, and they turn out to share an
answer: what a name binds, and what a reload owes you.

**Saving to a new filename does not rename the graph.**
[Q32](#q32--a-project-holds-several-named-graphs-and-every-node-is-a-form) said the name is
the identity in three places at once — the server mount, the `style.json` source and the `.vpl`
filename. Read as an invariant that runs in both directions, saving `basemap` to `hillshade.vpl`
would have to rename the graph, and would therefore move the server mount and rewrite the style's
source name as a side effect of picking a filename in a file dialog. The strength of Q32's claim is
exactly what makes that unacceptable: the more the name binds, the worse it is to change it by
accident.

So the binding runs one way. **The name supplies the default filename; the filename never supplies
the name.** Renaming stays what Q32 made it — an explicit act in the graph list, one operation that
either completes or does not.

**The name is chosen when the graph is created, from whatever was opened.** That is the other half of
the same decision: if a filename cannot rename a graph later, the name has to be right at the start.
Every graph used to be created as the literal `graph`, so a third file opened became `graph-3` —
wrong in all three of the places above, and wrong in a way no later action corrects.
`berlin.mbtiles` now makes a graph called `berlin`.

The rule lives in the core, as `graphs::name_for_source`, because there are two ways in and they must
not disagree: opening `berlin.vpl` and opening `berlin.mbtiles` name the same graph. `add_graph`
therefore takes the **source** rather than a name — a caller that passed a whole path would have
produced `users-me-data-berlin-mbtiles`, and the type no longer lets it.

**The core remembers work, not cursors.** Scroll position is deliberately webview state, and
[ui.md](ui.md)'s list of what the core must own drops it.

The line is not "durable versus volatile" — it is _what you would have to redo by hand_. The map
camera is owned because getting back to where you were looking means panning and zooming until it
looks right again, and you cannot tell when you have got it exactly. Scroll position is one flick:
not work, a gesture, and a reload that costs a gesture has not lost anything.

Nothing is at risk in the gap: a parameter's value reaches the core when it is committed, not when
the field is left, so a reload cannot lose a typed value. What it costs is
that after a reload the form is shut and the node has to be picked again, which is the price of not
sending a message on every click.

**The invariant this narrows** is [Q16](#q16--one-application-instance-one-window-per-project)'s
"nothing lives only in the webview". That was always about a crashed window not losing work. Read as
"the core mirrors every piece of UI state" it would oblige us to round-trip a hover, and the useful
version is the one it was written to say.

### Q34 — Studio carries a pinned `proj-sys` fork until the `libsqlite3-sys` conflict resolves upstream

**Dated 2026-08-17.** Split out of [Q19](#q19--gdal-is-statically-bundled-with-a-deliberately-narrow-driver-set)
on 2026-08-18: bundling GDAL and carrying a patched dependency are two decisions with two different
exit conditions, and only one of them ever ends.

S0.11 measured GDAL in a scratch project, where it linked cleanly. Inside Studio's real dependency
graph the two halves do not resolve at all:

| Chain                                                                                | Wants           |
| ------------------------------------------------------------------------------------ | --------------- |
| `gdal-src` 0.3 → `proj-sys` 0.27 → `libsqlite3-sys`                                  | `>=0.28, <0.36` |
| `versatiles_container` 4.8 → `r2d2_sqlite` 0.35 → `rusqlite` 0.40 → `libsqlite3-sys` | `^0.38`         |

`libsqlite3-sys` declares `links = "sqlite3"`, so cargo permits exactly one copy in the graph, and
the two ranges are disjoint. The dependency is **not optional** in either chain — `proj-sys` requires
it unconditionally, and `r2d2_sqlite` is a plain dependency of `versatiles_container` with no feature
gating it — so no combination of features resolves this. It is not a version we can pick.

**The fix is upstream, in one of two places**, and both were asked for:
[versatiles-rs#226](https://github.com/versatiles-org/versatiles-rs/issues/226) to loosen the
`r2d2_sqlite` requirement, and [georust/proj#261](https://github.com/georust/proj/pull/261) to widen
the ceiling to any 0.x. The second is a one-line change, because `proj-sys` has no API surface on the
crate at all — an `extern crate` for linkage plus two build-script keys, emitted unchanged by
`libsqlite3-sys` 0.35 through 0.38.

**Studio carries that patch in the meantime**, pinned to a commit rather than a branch so a rebase
cannot silently change what it builds. `[patch.crates-io]` in the workspace manifest, with the exit
condition written beside it: **remove it as soon as either lands and reaches a release.** It is the
only thing in the tree depending on a repository we control rather than a published crate, which is
why it is worth being uncomfortable about.

**What it buys:** with the patch the graph resolves on `libsqlite3-sys` 0.38.2 and everything
[Q19](#q19--gdal-is-statically-bundled-with-a-deliberately-narrow-driver-set) promised holds — which
is why that decision needed no revisiting, only this one adding.

### Q33 — The node form explains itself without symbols to learn

**Dated 2026-08-18.** Two questions the form raised once a node became one
([Q32](#q32--a-project-holds-several-named-graphs-and-every-node-is-a-form)). One it left
open: Q32 put documentation behind a `?` without saying where the `?` opens _to_. The other it had
answered, and this reverses — Q32 said a required argument is **marked**, and the mark turned out to
be a symbol nobody could read.

**Parameter help sits beside the sidebar, over the map.** Measured before deciding: 127 parameters
across the operations, **median 95 characters, p90 262, max 481**. In a 280px sidebar that is three
lines typically and seven at the p90 — overlaying the form being filled in. Beside it at 26rem it is
one and a half, and four. The p90 case is what makes this necessary rather than nice.

The sidebar also scrolls and clips, so a box inside a node cannot escape it. **One fixed-position
element at application level**, positioned from the trigger's measured rect, sidesteps that without
portals or per-node listeners. It flips to the other side when the pane is on the right — sides are
data since [Q31](#q31--panes-are-a-list-and-each-one-owns-what-it-emits), so that is real — clamps
vertically, and closes on scroll rather than chasing a measurement that is a snapshot.

**Hover to peek, click to pin**, because reading and copying are different needs and one gesture
cannot serve both. Scanning a form wondering what `level_base` is wants no clicks and nothing to
dismiss; reading carefully, or copying an example out of the text, wants it to stay put and stay
selectable. Only the pinned state has a close control — a peek that needs dismissing is not a peek.
Focus does what hover does, so the keyboard gets the same thing free.

**The trigger is the `?`, not the row.** Hovering the row would flash a popover per argument while
sweeping down a form.

**The summary line comes from `field_meta`, not the prose** — `whole number 0–30 · required`,
`one of gzip, brotli, zstd, none · optional`. That is frequently the whole answer, and it is the part
the prose buries. Assembled where VPL is understood rather than in the popover, which stays generic:
the style editor will want the same component for entirely different content.

**Rejected:** the **Popover API**, which would give the top layer and light dismiss for free but needs
Safari 17+ and a recent WebKitGTK, and Linux versions vary; and **CSS anchor positioning**, which
would delete the arithmetic and is too new to depend on — worth revisiting later as a drop-in
simplification.

**Required parameters are shown, not starred.** A red asterisk marked a condition that already speaks
for itself: when one is missing, validation says `'from_csv' needs a 'lon_column' parameter` and the
node is marked faulted (C4). The asterisk was also red on _satisfied_ required fields, where nothing
is wrong.

So the star is gone and nothing replaced it. **Required parameters always appear in the form, empty,
with a `needs a value` placeholder** — hiding them in `＋ parameter…` made a form that concealed its
own required fields and sent people hunting. It costs almost nothing: of 29 operations, 18 have no
required parameter, 9 have one, and only 3 have more. And **no `×` on a required row**, set or unset,
because "you cannot remove this" is better said by not offering the control — the rule the head node's
missing `×` already teaches.

An empty required row lives in the pane and **not** in the document, the same rule as a pending
parameter, so it never writes `lon_column=''` — VPL that parses and then fails when the pipeline is
built.

### Q32 — A project holds several named graphs, and every node is a form

**Dated 2026-08-18.** Drawn before it was written:
[wireframe](https://claude.ai/code/artifact/69159dd5-bfb3-4619-bbee-eb5a5c15497a). Supersedes
[Q25](#q25--the-vpl-editor-is-a-textarea-with-a-highlight-overlay-over-one-document-per-window)'s "one pipeline document per window" and amends
[Q31](#q31--panes-are-a-list-and-each-one-owns-what-it-emits).

**Q25 answered a different question than the one that matters.** It did consider several sources and
said they return "as a composite node with two read nodes under it" — `from_stacked [ a, b ]`. But
that merges inputs into **one** tile source. A map style needs the opposite: MapLibre's `sources` is a
map of _independently addressable_ sources, and a real style is vector tiles **plus** hillshade
**plus** terrain, each with its own layers. That cannot be expressed as one merged source, because the
style has to name them separately. So [D3](features.md) and the whole of S4 need something S2 has no
way to produce. `from_stacked` stays — merging is a real operation — it just answers a different
question.

It also fixes something quietly wrong: **"+ Add source" replaces the entire pipeline.** The label has
never matched the behaviour. With graphs it means what it says.

**A graph is a named VPL document producing one named tile source.** The name is the identity in
three places at once — the server mount, the source name in `style.json`, and the `.vpl` filename —
which is what makes [Q6](#q6--a-project-is-a-directory-of-real-files-with-a-yaml-manifest)'s project directory read properly: `project.yaml` beside
_several_ `.vpl` files and one `style.json`, rather than a single `pipeline.vpl`.
**Clarified by [Q35](#q35--a-graphs-name-is-chosen-once-and-the-core-remembers-work-rather-than-cursors):**
the name supplies the filename, never the other way round — saving to a different file does not
rename anything.

**Renaming rewrites style references.** The alternative is forbidding a rename once the style points
at a graph, which is worse: the moment you most want to rename something is after you have used it.
It must be one operation that either completes or does not — a half-applied rename leaves a style
pointing at a source that no longer exists.

**Serving and previewing come apart.** They were the same thing only because there was one document:

- **Serving** — every graph is mounted, always. That is what the style draws.
- **Previewing** — one node, in one graph, _pinned_ to override the map. A debugging view.

Exactly one pin exists across the project; clicking another moves it, clicking the pinned one clears
it. The infrastructure was already there — [Q16](#q16--one-application-instance-one-window-per-project) built named mounts precisely so that
"each project and each previewed pipeline node is a named mount, not a server of its own".

**Layout: a list of graphs above the selected graph's chain, in one pane.** A pane per graph makes the
pane catalogue dynamic and turns four graphs into four folded boxes; tabs per graph collide with
[Q15](#q15--the-pipeline-pane-tabs-between-graph-and-text)'s Graph/VPL tabs, and two tab rows stacked is a bad row to be in. Master–detail
keeps one pane, keeps Q15 intact, and gives per-graph state — the dirty dot, the pin, the name — a
natural home. Renaming happens in that list, because the list is where graphs live.

**Every node is a form**, whether or not anything is pointing at it. Each shows one row per
argument — value editable, `×` removing it, `＋ parameter…` offering what the operation accepts but
has not set. **Amended by [Q33](#q33--the-node-form-explains-itself-without-symbols-to-learn):** a
required argument is shown empty rather than marked, and is the one row with no `×` — being
unremovable is how it says it is required.

**Only the selected node used to be a form**, which fitted six operations in the height four took.
That was worth having and is now spent: reading down a chain meant every node changing height as the
selection moved, and a list that reshuffles under the pointer is harder to read than a long one. The
pane scrolls, which is what it is for.

**So nothing is selectable.** A node is not a control — clicking one had nothing left to do once
every node showed its arguments, and a button that does nothing still says it does something. What
follows the pointer instead is _adding_: `＋ parameter…` and the row for an argument being typed
belong to the node being worked on.

**The accent marks what the map is drawing**, not what was clicked. Every node outline and every
connection between nodes is the same line at the same width; the part of the chain that feeds the
pin wears the accent and the rest wears a separator's colour, so the pane says which half of the
pipeline is actually running.

- **Two bugs came out of that change**, and they were one bug twice: `onSet` wrote to whichever node
  was selected, and field suggestions offered one file's columns for another file's node. Both were
  correct while a single node had a form, and both took the selection as an unnamed argument. Any
  state that reads "the selected node" is worth the same suspicion.
- **The head node has no `×`.** A chain must start with a `from_*` node, so the rule is expressed by
  the missing control rather than by an error afterwards.
- **`＋ operation…` sits on the rail, outside the node's border**, while `＋ parameter…` sits inside
  it. Inside acts on the node, outside acts on the chain — the difference is structural, so the two
  never have to be told apart by weight or colour, and the insertion point is drawn where an insertion
  goes. Every rail carries one.
- **Documentation is behind a `?`** on each argument, and on hover for a mouse. It overlays the rows
  below rather than displacing them: help that reflows what you were reading moves the target while
  you aim at it, and worst on a long chain.

**Export is a modal, per graph, and its bounding box is four number fields.** A form and a job rather
than a button, so it does not compete with the chain for height — and numeric bounds are what make a
modal legitimate, since nothing in it needs the map underneath. The estimate sits where the run is
committed ([C6](features.md)) and states the refusal threshold in the same breath, so
[S3.6](scope-release-1.md)'s guard is visible before it fires rather than after.

**No "export everything" yet.** That is closer to [G1](features.md): once `project.yaml` sits beside
real files, exporting everything is mostly "save the project, and render the tiles". Its shape depends
on a decision that lands at S5.1.

**What this costs, stated plainly.** The core's single `pipeline: Mutex<Option<Document>>` becomes a
set; the preview mount becomes one mount per graph plus a pin; `set_pipeline` and `pipeline` grow a
graph argument; and the history stack stays **global** rather than per graph, because
[G6](features.md) wants ⌘Z to undo the last thing you did, not the last thing you did _here_. It is
stage-sized work, not a step.

**Deferred deliberately:** reordering nodes within a chain, and adding a source _into_ a
`from_stacked` block — the graph still cannot build a composite pipeline, which is now the largest
remaining gap in the pane.

### Q31 — Panes are a list, and each one owns what it emits

**Dated 2026-08-18.** Two questions S3.6 could not answer without settling: where a "write tiles"
action lives, and whether [Q22](#q22--one-map-surface-not-four-modes-the-mode-bar-separates-map-work-from-non-map-tools)'s three fixed sections are the right container for what
is coming.

**The left/right axis stays, and it is worth naming properly.** Q22 describes the left pane as "the
chain" and the right as "parameters and resulting metadata", but the axis underneath is **document
versus selection**: left is the structure of what you are building, right is the thing currently
selected — both what it is and what you can set on it. That is why the generated parameter form sits
on the right without contradicting "the right pane is where you read things".

Two alternatives were considered and rejected against the full feature inventory:

- **Left = tile data, right = style.** It gets one thing right, recorded below. But it leaves every
  analysis feature homeless — A4, A6, B1–B5, B7 — and it re-creates the problem this decision merged
  away: building a pipeline leaves the right half idle, styling leaves the left half idle. Modes
  again, as columns rather than tabs.
- **Left = interaction, right = information.** It has a home for everything, which is its strength,
  but the line does not survive contact: A6 _edits_ TileJSON, B3 has a repair button, A4 is
  navigable. And it puts graph, VPL, forms, export, layer tree and style export in one column —
  precisely the overload Q22 already flagged as its own biggest risk.

Under document-versus-selection every analysis feature has an obvious home, because each is _about
the current selection_: B2 is about the pinned node's output, A4 about the selected tile, A6 about
the selected container.

**Each pane owns what it emits.** The Export section is dissolved. "Export tiles" belongs to the
Pipeline pane, "export style" (D8) to the Style pane, and the CLI command (C7) to whichever pane
produced the thing it reproduces. _C7 was dropped by
[Q40](#q40--c7-is-dropped-four-artefacts-that-never-composed-into-one-story), so the third clause has
nothing left to assign; the rule it is an instance of is untouched._ This closes a gap the alternatives exposed: Q22 named one Export
section, [ui.md](ui.md) defined it as tiles-only (F2), and **D8 therefore had no declared home at
all**. "Export" as a shared destination was a category that only looked like one.

**No "export everything" button yet.** That is closer to [G1](features.md) — once `project.yaml` sits
beside real `.vpl` and `style.json` files, exporting everything is mostly "save the project, and
render the tiles". Its shape depends on a decision that lands at S5.1, so it is revisited after G1
rather than guessed at before.

**Panes become a list; dragging them does not arrive yet.** The three fixed sections become a `Pane`
component — id, title, foldable — with each sidebar rendering a list of pane ids from persisted
layout.

The reason is arithmetic. The analysis cluster alone is eight more surfaces (A4, A6, B1, B2, B3, B4,
B5, B7), and "which of three fixed sections does the byte breakdown belong to" has no good answer,
while "it is a pane" does. Taking the list now makes those cheap, keeps persistence in a shape
reordering can use, and turns "where does this belong" into a data change rather than a refactor.

**The drag interaction is deliberately deferred.** It is a real feature — drop targets, drag
affordances, empty-sidebar states, position as well as collapse state per pane, and the hardest
surface in the application to test — and it is not in any milestone. It is also the one part that
does not pay for itself yet: a rearrangeable interface **converts a design question into a user
problem**, and the default arrangement still has to be right, because most people never move a panel.
Photoshop is the example in both directions. Revisit when the analysis panes land and there is
something worth rearranging.

**Amended 2026-08-18 by [Q32](#q32--a-project-holds-several-named-graphs-and-every-node-is-a-form),
on the axis and on one pane.**

_The Parameters pane is removed._ Once a node carries its own arguments, a right-hand Parameters
pane shows what the graph already shows.

_And the axis moves with it._ This decision called it **document versus selection** — left is what you
are building, right is the selected thing, both what it is and what you can set on it. Moving the
parameters into the graph moves the "what you can set" half leftward, so the axis is now closer to
**what you are building** versus **what it turns out to be**.

That is nearly the interaction/information split rejected above, and the honest record is that the
instinct behind it was closer than the rebuttal. What kept it from being right then is weaker now but
not gone: [A6](features.md) still _edits_ TileJSON on the right and B3 still has a repair button. Both
are edits to a _result_ rather than to the document, so the axis holds — but it holds as a refinement,
not as something this decision meant all along.

### Q30 — A CSV import reads the header and fills in what it can

**Dated 2026-08-17.** [Q29](#q29--the-import-form-learns-the-data-by-probing-what-the-pipeline-produces) taught the form its data by probing what the pipeline
_produces_. That cannot work for a CSV, and the reason shapes the whole of E2: `from_csv` will not
build until `lon_column` and `lat_column` are set, so there is no output to look at. This is the one
import where the question has to be asked of the input.

**So the header is read at import time, and the answer is written into the node.** A file whose
columns are called `longitude` and `latitude` becomes a pipeline that runs, with nothing to fill in.
That is the difference between E2 working and E2 being a form with two required fields and no clue
what goes in them — which is exactly what S3.2's import card had to warn about, and no longer does.

**Not `x` and `y`.** They are coordinates often enough to be tempting and projected metres, a grid
index, or something unrelated often enough that guessing would sometimes produce a map of somewhere
that does not exist. A guess here fills in a _required_ field, so a wrong one is worse than none: it
turns "Studio is asking me something" into "Studio is wrong and I have to work out why".

**The delimiter is sniffed and recorded only when it is not the default.** A spreadsheet exported in
a locale where the comma is the decimal separator is semicolon-delimited, and read as a comma file it
is one enormous column. VPL should say what is unusual about a file rather than restate the default
on every one.

**When the guess declines, the columns are still offered.** `suggest::for_node` reads the same header
and hands the form the real names, as a `datalist` — not a `select`, because those names are what a
header happens to say rather than the operation's domain, and a partial or wrong header has to stay
typeable. Suggestions at both ends of the pipeline, and the form does not care which end an answer
came from.

**One bug this surfaced.** The post-import branch asked the _kind_ whether anything was missing.
Every CSV needs those two fields, so a successfully-guessed one was told to fill in fields it already
had, and skipped the preview that would have shown it working. Completeness is the document's
answer — its diagnostics — not the kind's.

### Q29 — The import form learns the data by probing what the pipeline produces

**Dated 2026-08-17.** [ui.md](ui.md) had already settled that import has no surface of its own: a
card opens the dialog, inserts a node, selects it, and the generated form ([C2](features.md)) is the
configuration UI. S3.3 is what that costs to actually keep.

**One promise was not being kept.** The node was inserted and _not_ selected, so an import landed on
a form nobody had opened — the one thing to do next, one unmarked click away. It is selected now.

**The form could not offer what it does not know.** `from_geo` takes `properties_include` and
`properties_exclude`, lists of property names; the person filling them in has no way to know those
names without opening the file in something else first. That is E1's "map columns", and it was the
part of an import that sent you elsewhere.

**Probed from the output, not parsed from the input.** `analysis::probe_layers` decodes one tile of
the built preview and reports its layers and property keys. One implementation therefore serves every
format — a GeoJSON, a shapefile and a CSV all arrive as vector tiles — including a format Studio has
never heard of. Parsing each input format would have meant a reader per card, and a new one for every
format upstream adds.

**One tile, and it says so.** The probe reads the tile at the lowest zoom covering the middle of the
source's own bounds, which for the files an import produces holds everything. A property appearing
only in one corner of a planet extract will be missed — so the names are offered as **chips beside a
field that still accepts anything typed into it**, and the feature counts in the right pane are
labelled as the sampled tile's rather than presented as totals. A closed multi-select would have
turned a sample into a rule.

**A failed probe costs suggestions, never the import.** Raster output has no layers to decode; that
is the answer, not an error.

### Q28 — One import catalogue, in the core, derived from the operation registry

**Dated 2026-08-17.** S3.2 asked for import cards in two places. The question it forced was where
the list of what Studio can open lives.

**It was already in four places, and already wrong.** The file dialog named four extensions, the
drop handler filtered by the same four written out again, Save named `.vpl` a third time, and none of
them knew about `from_geo` — which the binary has had all along. Studio could read a GeoJSON and had
no way to say so.

**The catalogue answers to the binary.** `import::kinds()` consults the operation registry and drops
any kind whose read operation is absent, so a card cannot offer something that fails on the first
click. That is not hypothetical: [E3](features.md)'s GDAL raster path is a build-time decision
([Q19](#q19--gdal-is-statically-bundled-with-a-deliberately-narrow-driver-set)), and its card should appear when GDAL is linked and not before — without a
second flag in the webview to keep in step.

**The extensions are still hand-written**, because parsing prose to build a file dialog would break
the first time somebody rewrote a sentence. A test checks each against the operation's own
documentation instead. It earned itself immediately: it rejected `.tsv`, which nothing upstream ever
promised — `from_csv` splits on `,` unless told otherwise, so that card would have produced one
column with tabs in it.

**Picking a file is not always the whole import.** `from_csv` needs to be told which columns hold
the coordinates, and no amount of looking at a filename will say. Rather than hide that, the kind
carries what is still missing, the card says so before the dialog opens, and the generated form
([C2](features.md)) shows those fields as required and empty. Reading them from the file's own
header is the wizard at S3.4.

**What is verified:** a file of every offered kind — three container formats, GeoJSON, line-delimited
GeoJSON, a shapefile, a CSV — is matched to its card, turned into a read node, parsed, validated and
run, and produces tiles. Each of those steps can be right alone and wrong together; a card claiming
`.shp` while `from_geo` cannot open one would pass every other test.

_Exercised at S3.5: the raster card had been written while GDAL would not link, and appeared with no
UI change the moment it did ([Q19](#q19--gdal-is-statically-bundled-with-a-deliberately-narrow-driver-set))._

### Q27 — The job runner has two lanes, and the preview runs in one of them

**Dated 2026-08-17.** [S3.1](scope-release-1.md) asked for "the queue". There are two, because a
conversion and a preview want opposite things from a runner.

**`queued`** runs one job at a time in submission order. Conversions compete for the same disk and
the same cores, so two at once finish later than the same two in sequence — and report progress that
means nothing while they do it.

**`latest`** cancels whatever the lane was already running. A preview of a pipeline that has since
been edited is not a result anybody will look at; it is a machine still warming up over a stale
question. One FIFO serving both would make a preview wait behind a forty-minute export, which is the
opposite of what M4 promises.

**This moved a decision out of the webview.** `refreshPreview` used to hold a token and discard
replies that arrived out of order. The work still ran to completion — the token only decided which
answer to ignore. Now the runner cancels it, and because _which preview is current_ is a fact the
runner owns, the command can report `superseded` rather than the caller inferring it. A second
answer to that question in the webview could only ever disagree.

**Cancellation is two mechanisms, because neither covers everything.** The task is aborted, which
drops async work at its next await point — real cancellation for a preview, whose time goes into
opening files. A flag is also set, which is the only thing a `spawn_blocking` thread encoding tiles
can see. Work that does neither runs to completion while reported as cancelled; that is a property
of the work, and the runner cannot fix it by pretending otherwise.

**The runner announces every ending, not the job.** A job aborted mid-await never gets to say
anything, and a state machine where some endings come from the job and others from the runner has
two places to be wrong.

### Q26 — The IPC types are generated, and the generated file is committed

**Dated 2026-08-17.** [Q3](#q3--three-planes-ipc-for-control-http-for-data-channels-for-events) deferred `tauri-specta` because its line was `2.0.0-rc.x`.
It still is — `rc.25`, from May — but the risk that deferral was avoiding turned out to be smaller
than the one it accepted.

**`svelte-check` cannot catch this drift.** It flags a _use_ of a missing field, not a missing field.
Adding one in Rust and forgetting the TypeScript failed nothing until somebody read it, and 19
interfaces and 26 wrappers were being kept in step by hand.

**The generated file is committed, and a test fails when it is stale** — the same shape as
`cargo fmt --check`. That is what makes a pre-1.0 generator acceptable: if `specta` breaks, the
checked-in bindings keep working and only regeneration needs fixing. It is not on the build path.

**Three pre-1.0 crates, and eleven annotations.** `specta`, `specta-typescript` and `specta-serde` —
the serde handling is its own crate. Specta refuses to emit any 64-bit integer, `usize` included, to
avoid precision loss; its alternative is `bigint`, which would make span arithmetic in the webview
absurd. So every `usize` and `f64` that crosses carries an explicit representation, and the reason is
written where the first one is.

**It found things.** `JobEvent.fraction` was typed `number` by hand and is `number | null` in truth,
because `serde_json` writes `null` for `NaN`. `set_pipeline` took an `Option<String>` and matched on
it, so the generated type was `string | null` where the hand-written one had been a union — the Rust
side was the loose one, and is now an `EditKind` enum. And `Layout`'s `serde(default)`, which exists
so an older `layout.json` still loads, makes every field optional in the bindings: one struct serving
as both a file format and an IPC type.

### Q25 — The VPL editor is a textarea with a highlight overlay, over one document per window

**Dated 2026-08-17.** Two things S2.3 had to settle: what the editor edits, and what it is built from.

**One pipeline document per window.** ~~Superseded 2026-08-18 by
[Q32](#q32--a-project-holds-several-named-graphs-and-every-node-is-a-form): a project holds
several named graphs, each its own source with its own save and export. The composite-node answer
below solves _merging inputs into one source_, which is a different question from _a style with
several sources_.~~ [Q6](#q6--a-project-is-a-directory-of-real-files-with-a-yaml-manifest) already said a project holds a single `pipeline.vpl`, and the multi-source layer stack was dropped early on, so the window's pipeline is one
VPL document and the core owns it — nothing durable in the webview ([Q16](#q16--one-application-instance-one-window-per-project)). Opening a
container sets that document to the matching `from_container` read node. Showing several containers
at once returns when it can be _written down_: as a composite node with two read nodes under it,
added in the graph at S2.5. Until then the map keeps rendering opened containers directly; wiring it
to the pipeline's own output is C3, at S2.7.

**Not CodeMirror.** The professional reflex is a real editor component, and it was close. Three
things decided against it:

- **The hard part is already done.** A syntax highlighter needs to know where every token is, and
  [Q23](#q23--the-vpl-syntax-tree-is-written-from-scratch-and-pinned-to-upstream-by-a-differential-test)'s parser returns exactly that. Bolting a second, independent tokeniser onto the
  editor would mean two definitions of VPL's grammar in one application — the thing the differential
  test exists to prevent upstream, reintroduced internally.
- **Undo belongs to the document, not the editor.** G6 wants one stack covering text edits _and_
  structured edits from the graph and the forms ([Q11](#q11--the-node-graph-c1-is-in-release-1-and-needs-a-lossless-vpl-syntax-tree)). An editor with its own history
  would have to be talked out of it.
- **The documents are short.** A pipeline is a handful of nodes, not a source file. Nothing here
  needs folding, minimaps, or multi-cursor editing.

So: a transparent `<textarea>` over a `<pre>` that renders the same text, highlighted from the
parser's spans. The textarea keeps native selection, caret and IME behaviour — which is most of what
makes a hand-rolled editor go wrong — while every token colour and error underline comes from the
tree Studio already has.

**What we accept.** No autocomplete, no bracket matching, no multi-cursor. The overlay must match the
textarea's text metrics exactly, so both take their font and spacing from the same tokens and the
scroll positions are kept in sync; that is the one fragile part, and it is one function. If this ever
stops paying — long generated pipelines, or a demand for completion from `field_meta` — CodeMirror
slots in behind the same component boundary.

### Q24 — G2 is dropped. The bottom bar shows status and progress

**Dated 2026-08-17.** "Show me the command" — a persistent strip naming the CLI equivalent of the
last action — is removed, and the bottom bar becomes the job and status bar it was always going to
need.

**The promise could not be kept.** G2 said _every GUI action displays its CLI equivalent_. Most of
Studio's actions have no CLI equivalent and never will: collapsing a pane, selecting a node, panning
the map, editing a parameter, opening a bookmark. In practice one action wrote to the strip — opening
a container, as `versatiles probe … -d` — and every later action left that line sitting there,
describing something the user had done minutes ago. A bar that claims to say what you just did, and
mostly says what you did a while ago, teaches the wrong thing more reliably than no bar at all.

**The need behind it is real and is met better elsewhere.** What G2 was for was reproducibility —
getting from "I did this by hand" to "this runs in CI". [G1](features.md) delivers that properly: the
project is a **directory of real `.vpl` and `style.json` files that the CLI already consumes**. A
whole project the CLI can run beats a copyable one-liner, and it does not have to be maintained
action by action.

**The bottom bar had a better occupant waiting.** E7's job bar — progress, cancellation, an
expandable per-job log — was always going to live there, and conversions running for minutes to hours
make it the more valuable use of a permanent row. Rather than two strips competing for the bottom of
the window, there is one, and it says what the application is doing.

**What this costs.** Studio no longer teaches the CLI by example. That was a genuine virtue and it is
being given up deliberately, not by accident: the alternative was keeping a bar that was honest about
its intent and misleading about its content. The "show me the VPL" escape hatch survives, because it
was never G2's — it is [C7](features.md), served by [Q15](#q15--the-pipeline-pane-tabs-between-graph-and-text)'s Graph/VPL tabs, and showing
the VPL for a pipeline is something Studio can always do truthfully.

### Q23 — The VPL syntax tree is written from scratch, and pinned to upstream by a differential test

[Q11](#q11--the-node-graph-c1-is-in-release-1-and-needs-a-lossless-vpl-syntax-tree) committed to a lossless syntax tree without saying where it would come from.
Wrapping `versatiles_pipeline`'s parser was the hope. It is not possible: that parser is built from
nom combinators that discard as they go — `ws0` drops comments with `value((), …)`, properties land
in a `BTreeMap` that sorts the keys and merges repeats, and no offset is recorded anywhere. All
three are gone before it returns, so no wrapper can recover them. `studio-core::vpl` walks the
grammar again.

**The text is the document.** The tree holds byte spans into the original rather than replacing it,
so parse-then-print is the identity and a structured edit is a splice at a span. Comments and layout
outside the edit survive because they are never re-rendered — a property of the data structure, not
of a formatter behaving well. Two doors in, matching the two S2 surfaces: the text editor owns a
buffer and reparses as the user types (S2.3, S2.4), while the graph and forms hold a valid document
and change it through `replace`, which reparses and refuses anything that would not survive
(S2.5, S2.6).

**Reimplementing a grammar is only safe while it agrees with the original**, so `differential.rs`
runs ~70 inputs — valid and invalid — through both parsers and requires that they accept the same
ones, build the same tree, and that upstream can reparse whatever Studio prints. A Studio that
rejects VPL the CLI runs sends users to the terminal to discover they were right; one that accepts
VPL the CLI rejects lets them build a pipeline that only works inside Studio. Both are worse than
shipping no editor.

**Two upstream behaviours are reproduced rather than corrected.** Diverging quietly would be worse
than either. The test names them, so if upstream changes, Studio finds out.

- A repeated key concatenates: `a=1 a=2` means `[1, 2]`, not `2`. Nothing in the syntax suggests it.
- **VPL cannot express an empty string.** `''` fails on `is_not` and `""` fails on
  `escaped_transform`, and there is no third spelling — found by the differential test, which
  rejected an assumption to the contrary in the first draft.

**That second one was a UI constraint, and 4.8.0 lifted it.** While it held, a parameter could be
absent or non-empty but never blank, so clearing a field had to mean _remove the parameter_. Empty
values now parse; clearing still removes, because for a filename or a layer name a blank is not a
value anyone means — but it is a decision about the interface now, not a limit of the syntax.

**Offering it upstream still stands.** The tree is useful to `versatiles_pipeline` — a serialiser
and real error spans would benefit the CLI too — but Studio is not blocked on that conversation, and
the differential test is what makes living downstream safe in the meantime.

**Update, 2026-08-17: upstream built it.** Issues
[#216](https://github.com/versatiles-org/versatiles-rs/issues/216),
[#217](https://github.com/versatiles-org/versatiles-rs/issues/217) and
[#218](https://github.com/versatiles-org/versatiles-rs/issues/218) are all closed, and `v4.8.0` adds
a `CstFile` — a lossless concrete syntax tree with spans, leading trivia, `set_property`,
`remove_property`, `set_value`, a `Display` serialiser and `lower()` into the semantic tree — plus a
`VplParseError { span, message, context }` that is the struct #217 proposed. **Most of
`studio-core::vpl` becomes redundant**, including `differential.rs`, which exists only because there
were two parsers.

**Not yet, though: `v4.8.0` is a draft release and crates.io still serves 4.7.0**, so `cargo update`
does nothing. Studio was built against the tag to measure the cost: it compiles unchanged, 66 of 68
tests pass, and the two failures are both the empty string — which #218 made valid, so Studio is now
the stricter of the two. That is the whole delta.

**Done, same day.** Studio is on 4.8.0 and its parser is gone: `parse.rs`, `print.rs` and
`differential.rs` are deleted, `ast.rs` is now just the flat view the webview reads, and `Document`
wraps `CstFile`. **Around 700 lines removed for about 250 added**, and the thing that used to need a
differential test — a second implementation of someone else's grammar — no longer exists.

What stayed is what upstream has no reason to carry: `validate.rs` (S2.4, checking against operation
metadata), `tokens()` for highlighting, `node_at` for selection sync, and `read_node_for`.

Three things got better rather than merely equal. Highlighting reads the concrete tree's own
punctuation tokens instead of inferring them from the gaps between spans. Error positions come from
upstream's `VplParseError`, so Studio passes a position through rather than computing one. And the
empty string is expressible, so `quote_value` no longer has a `None` case to explain.

### Q22 — One map surface, not four modes. The mode bar separates map work from non-map tools

Explore, Pipeline, Style and Publish are merged into a **single surface**. The mode bar stays, but it
now means something different: it separates _working with the map_ from tools that are not about the
map at all — the asset manager (G7) today, glyph generation (D9) and whatever comes next.

```text
┌───────────────────┬──────────────────────┬────────────────┐
│ ▾ PIPELINE        │                      │ PARAMETERS     │
│   from_geo        │                      │ of whatever is │
│   vector_filter   │        MAP           │ selected, and  │
│   ● preview       │                      │ the metadata   │
│   + add source    │                      │ that results   │
│ ▾ STYLE           │                      │ from it        │
│   ▸ water · roads │                      │                │
│ ▸ EXPORT          │                      │                │
└───────────────────┴──────────────────────┴────────────────┘
```

_Drawn as decided. Two things moved since: the Export section dissolved into the panes that produce
its output ([Q31](#q31--panes-are-a-list-and-each-one-owns-what-it-emits)), and the parameters moved
out of the right pane into the node ([Q32](#q32--a-project-holds-several-named-graphs-and-every-node-is-a-form))._

**Why.** The four modes asserted a separation the work does not have. Tighten a filter, look at how
it renders, adjust a colour, notice a missing layer, go back to the filter — every one of those was a
mode switch. The pipeline produces tiles and the style renders them; they are sequential stages of
one artefact, and the left pane can show that chain whole.

**Explore was never a mode.** It was map-plus-inspector with no left pane — which is this surface
with the sections collapsed. "I am not editing right now" is a pane state, not an activity.

**Publish was not one either.** It is an action surface — export options and a serve toggle — plus a
temporary map tool for drawing the crop rectangle. A collapsible section and a map tool cover it.

**The build-order argument did not favour modes after all.** [Q14](#q14--explore-and-pipeline-stay-separate-modes--superseded-by-q22) rested partly on
modes growing monotonically: each stage adds one, rebuilding nothing. Sections grow the same way —
S1 ships with them collapsed, S2 adds Pipeline, S4 adds Style, S5 adds Export — while adding fewer
concepts. That argument was presented as more decisive than it was.

**Amended 2026-08-17, on three points this decision left loose.**

_There is no Sources section._ The first draft of this decision listed the left pane as **Sources ·
Pipeline · Style · Export**, which reintroduced exactly the duplication [Q14](#q14--explore-and-pipeline-stay-separate-modes--superseded-by-q22) had
removed — a list of `from_*` read nodes beside a graph that already draws them. Q14's reasoning was
never overturned and still holds: the read nodes at the head of the pipeline **are** the sources.
Three sections: **Pipeline · Style · Export**, with "+ Add source" adding a read node to the graph.
Keeping both would have meant either drawing the same nodes twice, or pulling read nodes out of the
graph — and then the graph is no longer a view onto the whole text, which [Q11](#q11--the-node-graph-c1-is-in-release-1-and-needs-a-lossless-vpl-syntax-tree) needs
it to be.

_The mode bar arrives at S4, not S2._ Its second occupant is the asset manager (G7), which lands in
S4.1. Introduced any earlier it is a one-item bar: chrome that switches between nothing and itself.
S2 adds the collapsible left pane alone.

_The first mode is called **Map**._ Not "Map mode" — the bar is already understood as modes, so the
word is redundant in the label. It reads against its siblings: **Map · Assets**, where the map is the
thing being made and assets are what it consumes. "Project" was rejected as colliding with the
project directory ([Q6](#q6--a-project-is-a-directory-of-real-files-with-a-yaml-manifest)), "Workbench" as naming the whole application
([Q13](#q13--studio-is-a-workbench-new-projects-start-from-a-landing-screen)) rather than one tab, and "Tiles" as excluding the style, which is in this mode
and is not tiles. Note the bar may well hold only these two for a long time: [Q9](#q9--fonts-and-sprites-are-fetched-per-family-and-never-unpacked) puts
locally generated assets through the same manifest and serving path as downloaded ones, so generating
glyphs (D9) and generating sprite sheets (D10) are both features _of_ the asset manager rather than
modes beside it.

**The right pane shows parameters _and_ resulting metadata.** ~~Superseded 2026-08-18 by
[Q32](#q32--a-project-holds-several-named-graphs-and-every-node-is-a-form)~~, which moved
the parameters into the node. The half that survived is A6: the merged surface has to put a
container's own metadata somewhere, and this is where.

**Two invariants become free rather than enforced.** "One `Map` across all modes" and "the viewport
survives a mode switch" stop being rules when there are no mode switches to survive.

**What we accept.** The left pane carries more: a pipeline chain, a layer tree, export options, and
[Q15](#q15--the-pipeline-pane-tabs-between-graph-and-text)'s Graph/VPL tabs inside the pipeline section. On the 13-inch laptop Q15 was
protecting, that is the real risk. **Sections must collapse independently and remember their state**
— that is load-bearing here, not polish. Node editing and layer reordering also behave differently,
so the sections must not imply they are the same kind of thing.

**Supersedes [Q14](#q14--explore-and-pipeline-stay-separate-modes--superseded-by-q22)** entirely, and the Publish-mode reasoning in
[Q17](#q17--a3-the-multi-source-layer-stack-is-dropped). [Q13](#q13--studio-is-a-workbench-new-projects-start-from-a-landing-screen)'s landing screen and [Q15](#q15--the-pipeline-pane-tabs-between-graph-and-text)'s Graph/VPL tabs
are unaffected.

**Amended by [Q31](#q31--panes-are-a-list-and-each-one-owns-what-it-emits).** The three fixed
sections become a list of panes, and the Export section is dissolved — each pane carries its own
export instead. The left/right axis this decision set is unchanged.

**Amended 2026-08-23 by [Q39](#q39--the-asset-manager-is-a-dialog-and-with-it-the-mode-bar-goes).**
The mode bar is retired: the asset manager became a dialog, which left it with one mode — the state
this decision itself called chrome that switches between nothing and itself. The merge of Explore,
Pipeline, Style and Publish into one surface is untouched, and so is the ruling that non-map tools
do not divide the map work; only the bar that expressed it is gone.

### Q21 — Recents and bookmarks are application state in JSON files, not project state

A7 said view bookmarks are "stored in the project". They are not. Both bookmarks and the
recent-sources list live **beside the application's data**, in `app_data_dir()`:

```text
recents.json     disposable, churns on every open
bookmarks.json   user-created, precious
layout.json      disposable — added later, by Q31's panes
```

**Why not SQLite**, even though it costs nothing — `rusqlite` is already linked via the mbtiles
reader. Its advantages are concurrency, partial updates and queries over large sets, and none apply:
[Q16](#q16--one-application-instance-one-window-per-project) guarantees a single application instance, so there is one writer; the data is a
dozen recents and some named views; there is nothing to query. What it would add is a schema and
migrations, for state whose shape will change often. A JSON file the user can read, grep, back up
and move also honours "nothing only exists inside Studio" in a way an opaque database does not.

**Separate files, because their recovery policies differ.** A corrupt `recents.json` resets
silently — losing a most-recently-used list costs nothing, and refusing to start over it costs
everything. A corrupt `bookmarks.json` is an **error**, surfaced and with the file left untouched:
silently replacing user-created data with an empty list is data loss wearing the costume of a clean
start. One file could not hold both policies.

That the split is by _policy_ and not by subject is what let a third file join without reopening
this: [Q31](#q31--panes-are-a-list-and-each-one-owns-what-it-emits)'s pane layout — later also the
map camera — is disposable, so `layout.json` follows `recents.json` and resets silently. A fourth
would only need arguing about if it wanted a policy neither of these has.

**Writes are atomic** — temp file, fsync, rename — which is the durability SQLite would have given
us, in about ten lines and with no schema.

**`app_data_dir()`, not `app_config_dir()`.** These are user data, not configuration. Invisible on
macOS, where both are Application Support; on Linux it is `~/.local/share` versus `~/.config`.

**What we give up.** Bookmarks no longer travel when a project folder is shared, which is the
portability [Q6](#q6--a-project-is-a-directory-of-real-files-with-a-yaml-manifest) and G1 argue for. Accepted: there is no project file until S5.1, and a
bookmark is a place worth returning to whether or not a project exists. If project-scoped bookmarks
are wanted later they can coexist — app-wide for containers opened outside any project, project-
scoped for those inside one.

**Revisit** if this store grows to hold [Q4](#q4--analysis-statistics-live-in-memory-keyed-by-container-identity)'s content-addressed analysis cache, or if
multiple application instances ever become possible. Either would make files the wrong choice.

**Amended 2026-08-23 by [Q38](#q38--views-are-named-camera-positions-they-live-on-the-map-and-the-inspector-holds-neither-them-nor-a-way-in).**
Bookmarks are now called **views** and `bookmarks.json` is `views.json`, read under its old name
where an install predates the rename. The split by recovery policy, the file format and the
directory are all unchanged — only the words are.

### Q20 — GDAL is raster-only in release 1; GeoPackage is not supported

Checking `from_gdal` found only `raster` and `dem` submodules, and the operation is
`from_gdal_raster`. Vector reading is `from_geo` — GeoJSON, NDJSON, Shapefile — which needs no GDAL
at all. **There is no GeoPackage path anywhere.**

E3 said "GDAL path for GeoPackage, GeoTIFF and the rest". That was wrong; the catalogue is corrected.

**Accepted for release 1.** GDAL covers raster, which is exactly M3's "image data" half, so the
milestone still lands. GeoPackage users convert with `ogr2ogr` first.

**What it costs, stated plainly.** `audiences.md` says P2 brings GeoPackages, and telling them to run
`ogr2ogr` is precisely the toolchain step `vision.md` says they will not get through. This is the
sharpest instance of that tension in the release, and it is accepted knowingly rather than missed.

**Revisit** if P2 asks: either a `from_gdal_vector` operation upstream, or teaching `from_geo` to
read GeoPackage directly — it is SQLite, so that needs no new native dependency and is the narrower,
cheaper fix. Prefer the second.

### Q19 — GDAL is statically bundled, with a deliberately narrow driver set

E3 is **required** for M3 — it is the "image data" half — so GDAL cannot be optional, and it cannot
be a system dependency. `gdal-src` compiles GDAL from source with CMake during `cargo build` and
produces static libraries, pulling in PROJ, GEOS (`geos-src`, `geos_static`), SQLite and curl.

**The obvious blocker turns out to be solved.** PROJ normally needs `proj.db` on disk at runtime,
which would defeat a self-contained binary. PROJ RFC-8 added `EMBED_RESOURCE_FILES`, and it
**defaults to ON for static builds** — `proj.db`, `proj.ini` and the ITRF files are embedded into
libproj. PROJ still probes the filesystem first and falls back to the embedded copy.

**Why not the alternatives.**

- _Dynamic linking against system GDAL_ — what versatiles-rs does today, and it costs ~70 Homebrew
  formulae. For a desktop app "install GDAL first" is exactly the toolchain `vision.md` says P1 and
  P2 will never get through.
- _Feature-detect and grey out E3_ — fails M3, which requires it.

**What we accept.**

- **Build time.** CMake compiling GDAL, PROJ, GEOS and SQLite on every clean build. Needs aggressive
  CI caching; note versatiles-rs already caches its _dynamic_ GDAL tree because installing it takes
  ~6 minutes.
- **Size.** The embedded `proj.db` alone is several MB, before GDAL. For scale, [Q9](#q9--fonts-and-sprites-are-fetched-per-family-and-never-unpacked)
  sized the whole bundled asset tier at ~2 MB — GDAL will dwarf the rest of the installer.
- **GEOS is LGPL 2.1**, and static linking would oblige us to let recipients relink against a
  modified GEOS — satisfiable for an MIT project, but a real compliance step rather than a
  formality. ~~Accepted.~~ It never applied: raster reading never calls GEOS, so the feature stays
  off and GEOS is never linked (see the findings below).
- **The fork.** versatiles-rs pins a git fork of georust/gdal for GDAL 3.13 pending PR #714. Studio
  carries the same pin until it lands.

**The driver list (S0.10), settled.** Raster only, per [Q20](#q20--gdal-is-raster-only-in-release-1-geopackage-is-not-supported):

| `gdal-src` feature | Gives                                                  |
| ------------------ | ------------------------------------------------------ |
| `driver_gtiff`     | GeoTIFF — **and COG**, which needs no separate feature |
| `driver_vrt`       | Free, and makes multi-file mosaics work                |
| `driver_png`       | Scanned maps                                           |
| `driver_jpeg`      | Orthophoto deliveries                                  |
| `driver_mem`       | In-memory rasters, needed by the pipeline              |

**JP2 is dropped.** `gdal-src` 0.3 exposes 118 driver features and none of them is OpenJPEG or
JPEG2000, so a statically bundled JP2 is not available at any price. Scientific formats — NetCDF,
HDF5, GRIB — are **out** by choice: they pull large native dependencies. Revisit either only with a
user asking.

**S0.11, measured (2026-08-16, Apple Silicon, release build, stripped, LTO).**

|                        |                                                                |
| ---------------------- | -------------------------------------------------------------- |
| **Binary**             | **18.3 MB**, GDAL fully static — no gdal, proj or geos dylib   |
| **Clean build**        | ~75 s with a warm cargo registry                               |
| **Registered drivers** | GTiff, COG, VRT, PNG, JPEG, MEM, GNMFile, GNMDatabase, OGR_VRT |

So GDAL costs ~18 MB. That dwarfs the 1.9 MB asset tier as predicted, but an installer in the
20–35 MB range is unremarkable for a desktop application. ~~**Q19 holds, comfortably.**~~ — see the
amendment below.

**Amended 2026-08-17 (S3.5): it links, but only over a dependency conflict the spike could not have
seen** — S0.11 measured GDAL in a scratch project, and inside Studio's real dependency graph the two
halves do not resolve at all. That is its own decision, with its own exit condition:
[Q34](#q34--studio-carries-a-pinned-proj-sys-fork-until-the-libsqlite3-sys-conflict-resolves-upstream).
What follows here is what linking GDAL proved about **this** decision.

**With the patch, everything the spike promised is true of the application.** Verified rather than
assumed: the graph resolves with `libsqlite3-sys` 0.38.2, `cargo build --workspace` takes 2m42s,
`otool -L` shows no gdal, proj, geos or sqlite dylib, the nine expected drivers register, and
`gradient.tif` reads through `from_gdal_raster` into PNG tiles with a degree bbox — which is the
assertion the embedded `proj.db` premise rests on, since a Web Mercator extent means a transform ran
with no database on disk.

**The raster import card needed no UI change** — written while GDAL was still blocked, it appeared
the moment a `Cargo.toml` change made `from_gdal_raster` exist, because the catalogue drops any kind
whose operation the build lacks ([Q28](#q28--one-import-catalogue-in-the-core-derived-from-the-operation-registry)).

**The card's extensions are checked against GDAL itself, not against prose.** Matching them to
`from_gdal_raster`'s documentation rejected `.tiff` — correctly by its own rule, and uselessly. The
card and the `gdal-src` feature list are two statements of one choice, so a test now asks GDAL's
driver metadata to keep them one. It bites both ways: dropping `driver_jpeg` for binary size while
the card still offers `.jpg` fails, as does claiming an extension nothing reads.

**`from_gdal_dem` arrived too**, unasked. E4 (S3.8, stretch) is a driver-set decision away rather
than a dependency away.

**Three findings that change the plan.**

- **GEOS is not needed**, which removes the LGPL obligation entirely — unless a future vector path
  pulls GEOS in.
- **PROJ's embedded resources work.** A coordinate transform succeeds with `PROJ_DATA` unset and no
  `proj.db` on disk, which is the premise this whole decision rests on. Verified, not assumed.
- **`gdal-sys` silently prefers a system GDAL.** With Homebrew's GDAL present, pkg-config wins and
  the build links dynamically against 3.13 — then fails for want of pre-built bindings. The build
  must block pkg-config discovery or it will differ between a developer's machine and CI. Wire this
  into the build config at S3.5, not into someone's shell.

  **Block it for GDAL alone.** The first version set `PKG_CONFIG_LIBDIR=/nonexistent`, which fails
  _every_ probe rather than gdal's. Nothing on macOS notices — the webview is WKWebView and no crate
  asks pkg-config anything — while on Linux Tauri finds glib, gtk and webkit through it, so both CI
  jobs died compiling `glib-sys`. `GDAL_NO_PKG_CONFIG=1` refuses exactly the one lookup, using the
  `pkg-config` crate's own per-package escape. The irony is the point: the mechanism written to stop
  the build differing between a laptop and CI was itself the thing that differed, and only CI could
  say so.

### Q18 — Studio's Svelte components are written from scratch

Studio does not depend on `@versatiles/svelte`. Its code is a **reference to read, not a package to
import**.

**Why.** Studio's shell has requirements no other consumer has: one `Map` instance owned by the Rust
core and restored from it ([Q16](#q16--one-application-instance-one-window-per-project)), panes that reconfigure per mode, a graph pane that
edits text through a syntax tree. Adapting a library built for embedding single maps in pages would
constrain all of that, and the coupling would run both ways — Studio's needs would start distorting a
library other projects depend on.

**What we accept.** The org already has `InputRow.svelte` byte-identical in three repositories and
Studio makes a fourth. That duplication is real, and it is not Studio's to fix.

**Three solved problems to copy deliberately rather than rediscover.** All are cheap to carry over
and expensive to hit blind:

- **MapLibre 6's worker cannot be bundled naively.** Since v6 the worker loads from a separate file
  via `import.meta.url`, which stops resolving once a bundler inlines `maplibre-gl.mjs`. The fix is a
  build step that bundles the worker into the app from the installed `maplibre-gl`, referenced with a
  plain `new URL(…, import.meta.url)` — a Vite-only `?worker&url` import breaks Vite's own dependency
  pre-bundling. It also requires pinning `maplibre-gl` exactly, so worker and main thread match. See
  `node-versatiles-svelte/scripts/bundle_worker.ts`.
- **`BBoxDrawer`** (227 lines) is drag-to-draw bbox selection on a MapLibre map — most of F2 (S5.4).
- **The styler's `defaultValue` / `isModified` input pattern**, which shows whether a value differs
  from its default. That matters more in Studio than anywhere else, because `VPLFieldMeta` carries no
  defaults at all.

### Q17 — A3, the multi-source layer stack, is dropped

No stacking several containers in one view with opacity, swipe and split. Dropped, not deferred.

[Q14](#q14--explore-and-pipeline-stay-separate-modes--superseded-by-q22) removed the sources strip from Explore, leaving A3 — a stretch item — with
nowhere to live. [Q16](#q16--one-application-instance-one-window-per-project) mostly replaces it: one window per project means comparing two
containers is two windows side by side. Not a swipe, but free and the platform convention.

**Release 1 therefore has no comparison view at all.** C3 is not one — it shows the pinned node's
output on one map. **B5 (container diff) is the first feature needing two, and it is post-1.0**, so a
swipe/split control can be designed then. Release 1 needs exactly one live `Map` per project.

**Given up:** two unrelated containers overlaid with opacity. P3 would have wanted it; if genuinely
missed it returns as a map control, not a panel.

### Q16 — One application instance, one window per project

Not tabs, not separate application instances.

|                    | App instance           | **Window**                       | Tab              |
| ------------------ | ---------------------- | -------------------------------- | ---------------- |
| Webview processes  | N                      | N                                | 1                |
| Rust cores         | N                      | **1**                            | 1                |
| WebGL budget       | 16 each                | **16 each**                      | 16 _total_       |
| Crash blast radius | 1 project              | **1 project**                    | **all projects** |
| Asset manager (G7) | N writers, needs locks | **single writer**                | single writer    |
| Job queue (E7)     | fragmented             | **unified**                      | unified          |
| macOS conventions  | wrong                  | **⌘N, Window menu, full screen** | non-native       |

**Tauri already gives us the isolation.** Every webview is a separate OS process and the docs name
fault isolation as the point, with the core able to restart one that goes invalid. So a window per
project buys isolation we would otherwise engineer, and a second application instance buys nothing
beyond it while costing a second core.

**WebGL is headroom, not a decider.** Chrome and WebKit allow ~16 contexts and silently discard the
oldest past that. The original argument assumed two or three maps per project; after
[Q17](#q17--a3-the-multi-source-layer-stack-is-dropped) it is one, so even ten projects sit under the cap. Separate budgets are worth
having for free, but the decision rests on isolation and the single core.

**The server does not need duplicating.** `add_tile_source` / `remove_tile_source` work on a running
server, and the config mounts many named sources at once.

**Consequences.**

- **One embedded server for the whole application**, mounts named per project and per preview node —
  correcting [Architecture](architecture.md).
- **Nothing may live only in the webview**, so a crash is recoverable by reloading that one window.
  Promoted to an architectural principle. MapLibre's own recovery is imperfect — context loss before
  style load throws (maplibre-gl-js #7022), events fire after `Map#remove` (#726) — which is why the
  reload path matters more than prevention.
- **Destroy `Map` instances that are not visible.** Not pressing at one map per project, but the
  ceiling discards the context you looked at _first_, so establish the habit before B5.
- **The landing screen is what an empty window shows** ([Q13](#q13--studio-is-a-workbench-new-projects-start-from-a-landing-screen)); ⌘N opens another.
- **Measured at S0.8 (2026-08-16, macOS, debug build, empty page).** The window model holds
  comfortably:

  | Process             | Count            | RSS              |
  | ------------------- | ---------------- | ---------------- |
  | `versatiles-studio` | 1                | 129.3 MB         |
  | `WebKit.WebContent` | **1 per window** | **28.3 MB each** |
  | `WebKit.GPU`        | 1, shared        | 28.4 MB          |
  | `WebKit.Networking` | 1, shared        | 18.3 MB          |

  **~28 MB per additional window**, on top of ~47 MB of shared WebKit overhead. Five projects cost
  ~140 MB of webviews — not the constraint the decision worried about. No fallback needed.

  Two caveats. This is a debug binary rendering an empty page; a real map adds per-window cost, so
  **re-measure at S1** once MapLibre is on screen (`STUDIO_WINDOWS=n` still exists for that). And
  the **GPU process is shared across windows**, which weakens the "fresh WebGL budget per window"
  claim above — one more reason to treat context count as headroom rather than a decider.

### Q13 — Studio is a workbench. New projects start from a landing screen

The workbench-versus-P1 tension resolves for the workbench: `vision.md` stands unamended, there is no
simplified mode, and P1 is expected to cope. New projects open on a **landing screen** — a launcher,
not a wizard.

- **The P1 risk is accepted, not overlooked.** `audiences.md` warns "a rough edge a developer shrugs
  off will stop a journalist entirely". The mitigation is polish and good defaults. If P1 adoption
  stalls, this is the first decision to revisit.
- **The landing screen exists from stage 1**, not stage 3 — Studio must show something when it opens
  with no project. It starts as open-a-container plus recents (A7) and gains cards as clusters land.
- **It never gates anything.** Everything on it is also reachable from inside the workbench. A
  launcher that becomes a required first step is a wizard by another name.

### Q14 — Explore and Pipeline stay separate modes — **superseded by [Q22](#q22--one-map-surface-not-four-modes-the-mode-bar-separates-map-work-from-non-map-tools)**

> Kept for the record, trimmed to what outlived it. The modes were merged — the separation this
> defended did not match how the work flows — but one argument made here was never overturned and is
> still load-bearing.

Different activities: Explore is consumption, Pipeline is production. Collapsing them saves a mode at
the cost of muddying both.

**What survives: there is no sources pane at all.** Settled here after two revisions — shared across
modes, then Pipeline-only, then neither — because the `from_*` read nodes at the head of the pipeline
**are** the sources, so the graph already shows them and a separate list duplicated them. "+ Add
source" adds a read node. [Q22](#q22--one-map-surface-not-four-modes-the-mode-bar-separates-map-work-from-non-map-tools)
had to re-establish this when a first draft reintroduced a Sources section.

Also from here: Explore keeps no left pane, which left A3 homeless and led
[Q17](#q17--a3-the-multi-source-layer-stack-is-dropped) to drop it.

### Q15 — The pipeline pane tabs between graph and text

One pane, two tabs: **Graph** and **VPL**, not side by side. This also settles the small-screen
question — the layout no longer needs ~1400 px, so no drawer is required.

Side-by-side existed so a user could see graph and file agree, so the tabs owe that back:

- **The Graph tab never shows a stale graph** — a parse failure is shown, not the last good render.
- **The VPL tab carries an error badge** when parsing or validation fails (C4).
- **Switching is free** — no reparse, no lost cursor or scroll; both are views over one syntax tree.

### Q11 — The node graph (C1) is in release 1, and needs a lossless VPL syntax tree

M4 means **node graph plus text editor**, not text editor alone. C1 becomes a deliverable
and stage 2 is planned around it.

The catalogue assumed C1 was cheap because "the parser exists". It parses, but it cannot write back:
no serialiser, `properties` is a `BTreeMap` so a round-trip reorders parameters alphabetically, and
`#` comments are discarded ([details](ecosystem.md#3-the-vpl-parser-only-runs-one-way)).

So the graph must edit the text through **span-based edits over a lossless syntax tree**, not by
reparsing and printing. Regenerating from the AST would reformat the user's file and delete their
comments on every interaction — the exact "GUI and file disagree" bug the source-of-truth principle
exists to prevent. This is the largest piece of new construction in release 1.

Build it upstream in `versatiles_pipeline` if possible: a lossless parse and a formatter help the
CLI too, and it keeps one grammar. Studio carrying it is the fallback; a second divergent VPL
grammar is not.

**Consequence — undo/redo (G6) moves into stage 2**, from post-release. Stage 2 already turns every
graph interaction into a small text edit, and that edit list is the command stack, so undo is cheap
now and expensive to retrofit. G6 covers pipeline _and_ style edits, so stage 2 delivers the stack
plus pipeline undo, and **stage 4 must put style edits on the same stack**.

### Q4 — Analysis statistics live in memory, keyed by container identity

No sidecar files, no results in the project file. Scanning is not one cost but three, and only the
third needed solving:

| Tier                                  | Cost                                                          | Feeds      |
| ------------------------------------- | ------------------------------------------------------------- | ---------- |
| Metadata and real zoom range          | Free — `tile_pyramid()` reads the block index and is memoised | A6         |
| Tile sizes and coverage               | Index-only — all five readers override `tile_size_stream`     | B1, B4     |
| Tile contents (validation, breakdown) | Expensive, but `probe --sample PERCENT` bounds it             | B2, B3, B7 |

The first two are too cheap to be worth persisting. The third samples by default; a full scan is an
explicit, cancellable job (E7).

- **Not a sidecar** — containers are often read-only, remote (A2), or shared. Writing next to
  someone's data is sometimes impossible and always surprising.
- **Not the project file** — it would churn a file promised to be diffable, and a project can
  reference a container it does not own.
- **If measurement later demands persistence**, use a content-addressed cache in the OS cache
  directory, for full scans only.

**Design around:** probe computes and renders at once (`&mut PrettyPrint` in, `Result<()>` out), so
Studio cannot reuse it. `validate_tile()` is reachable — it lives in `versatiles_geometry`, which is
a library. **`layer_stats()` is not**: `tools` is declared in `versatiles/src/main.rs`, not
`lib.rs`, so the byte breakdown is binary-only. A compute/render split upstream would give the CLI a
`--json` probe for free _and_ make both reachable — asked for as
[vt#236](https://github.com/versatiles-org/versatiles-rs/issues/236), two months after this noticed
it. `analysis::describe` is what Studio pays in the meantime.

### Q7 — No `planetiler` orchestration. E5 is dropped

Closed as **no**, permanently rather than deferred.

**Cost.** Java 21+, 0.5× the PBF size in RAM, 5–10× on disk, ~1 GB of auxiliary downloads before the
first run. Detecting an existing JVM makes the feature invisible to the audience that needs it;
bundling one adds 50–190 MB to ship, sign and update; Docker is absent in the public administrations
this targets. `shortbread-tilemaker` is no lighter — Lua config for a separate C++ binary.

**Instead:** document the CLI route. Planet-scale OSM builds run on servers, not on the laptop
Studio is installed on, and Studio opens and styles the result either way.

**What it costs us:** the catalogue called E5 "potentially the decisive feature for P2". That stays
untested. Revisit if P2 users say the OSM build is the blocker — with evidence, not a guess.

### Q12 — Cluster B stays out of release 1, but is cheaper than the catalogue says

Scope holds; the estimate behind it was wrong — though **less wrong than a later reading suggested**.
`tile_breakdown.rs` computes B2's per-layer byte breakdown and `probe -ddd` aggregates it by
zoom × layer, so the algorithm exists and is proven.

**Correction (found at S1.10):** it is _not reachable as a library_. `mod tools;` is declared in
`versatiles/src/main.rs`, not `lib.rs`, so `layer_stats()` is binary-only. Studio therefore either
reimplements it — around a hundred lines over `versatiles_geometry`, which is public — or asks
upstream to move it. Either way B2 is cheaper than "new construction" and dearer than "already
done".

So B1, B2 and B3 after release 1 are mostly **visualisation over existing numbers**, not analysis —
which strengthens the case for taking them first. Not pulled in now because Q2 already flags four
clusters as a wide front and Q11 just added the node graph to it.

### Q8 — Release early under v0.x, aimed at the tile audience

Ship `v0.x` from stage 1; reserve the announcement for when all four milestones are in.

**Releasing early is house style.** Every versatiles repository that ships started small:
`versatiles-rs` v0.5.8 → v4.7.0 across 100 releases, `versatiles-style` 78, `versatiles-frontend`
46, `maplibre-versatiles-styler` 18. The only two with no releases are the two not yet usable.

**But the framing matters.** If the first public build is a viewer, Studio gets categorised as "a
tile viewer", and first categorisations stick. So:

- GitHub releases only, no announcement campaign.
- A `versatiles-choro`-style "under development" banner stating what works and what does not.
- Early audience is P3 and ourselves — they tolerate rough edges and file good bug reports.
- 1.0 and the announcement land together.

**Why not stay silent entirely:** the macOS Gatekeeper path (Q10) cannot be tested by reading our
own instructions, and malformed containers in the wild cannot be manufactured. Better to learn both
at v0.2 with sympathetic users. The funding agreement requires no public milestones, so this is our
call.

### Q6 — A project is a directory of real files with a YAML manifest

```text
MyProject/
  project.yaml     manifest: sources, views, references to the files below
  pipeline.vpl     a real VPL file
  style.json       a real MapLibre style
```

**Reference, do not embed.** The ecosystem already chose this: `versatiles serve` config lists
sources as `src: pipeline.vpl` and resolves relative paths against the config directory. So a Studio
pipeline runs unchanged under `versatiles convert`, and a Studio style loads unchanged in MapLibre.
Embedding VPL — a text DSL — in JSON would mean escaped newlines and unreadable diffs.

**YAML**, because `versatiles serve --config` already is. It permits comments, which matters for a
hand-editable file. TOML was rejected as a second format and awkward for nested source lists; JSON
for having no comments. YAML's footguns are accepted since Studio mostly reads its own output.

**`project.yaml` cannot double as a serve config:** `versatiles/src/config/main.rs` sets
`#[serde(deny_unknown_fields)]`, so any Studio key invalidates it. Studio exported one as a derived
artefact instead (C7) until [Q40](#q40--c7-is-dropped-four-artefacts-that-never-composed-into-one-story)
dropped that; the config is now the reader's to write. _Worth raising upstream:_ an ignored `x-`
namespace would let one file serve both purposes.

**Design for:** a project is a folder, so sharing means sending one — offer zip/unzip and a
"Save As" that copies the whole directory.

### Q3 — Three planes: IPC for control, HTTP for data, Channels for events

| Plane       | Carries                                                      | Mechanism                |
| ----------- | ------------------------------------------------------------ | ------------------------ |
| **Control** | open a container, read metadata, list operations, start jobs | Tauri IPC commands       |
| **Data**    | tiles, glyphs, sprites                                       | the embedded HTTP server |
| **Events**  | job progress, warnings, log lines                            | Tauri Channels           |

**Forced, not stylistic.** Tauri serialises command returns as JSON and its own v2 docs warn this is
slow for large payloads, so tile bytes must not travel over IPC. Channels are Tauri's recommended
streaming mechanism, which is what the job runner (E7) needs. For a one-off blob — a raw tile for
A4 — `tauri::ipc::Response` returns an array buffer without JSON.

**Studio's own tiles take a detour through the webview.** They still travel the data plane over
HTTP; what changed is who queues them. MapLibre fetches through a `studio://` protocol Studio
registers, which holds a queue bounded at the browser's own per-origin limit and hands requests on
from there. The reason is that neither end could otherwise answer a question S2.16 needed: MapLibre
reports a tile as loading the moment it _issues_ a fetch, which is before the browser has a
connection for it, and a counter inside the mounted tile source would only ever see the handful the
browser let through. With the queue in the middle, "rendering" means the server has it and "queued"
means nobody has started — and the status bar and the map overlay can say which. Keeping the bound at
or below the browser's cap is what keeps that true; above it, "rendering" would quietly start
including tiles still waiting for a socket.

Only Studio's own tiles. A background map's come from versatiles.org, and queueing those would report
someone else's network as this pipeline being slow.

**The core sits below the commands:** a plain Rust library with no Tauri types, so it is testable
without a Tauri runtime. `versatiles_node` demonstrates the shape — `TileServer`, `TileSource` and a
`Progress` class carrying `onProgress`/`onMessage` map closely onto the control and event planes.
Mirror its vocabulary rather than inventing a second one.

**Types across the boundary:** [`tauri-specta`](https://github.com/specta-rs/tauri-specta) generates
TypeScript from the Rust definitions, for commands and events. Two hand-kept copies of the command
surface is exactly the drift the generated-UI principle exists to avoid, so generation is worth some
risk — but the risk is larger than "community-maintained" suggests: **the Tauri v2 line is
`2.0.0-rc.25`, with no stable 2.x.**

**Deferred at S0, adopted before stage 3.** The cost of hand-writing wrappers scales with the size of
the command surface, and at S0 that surface was three commands. The trigger set here — "roughly ten
commands" — was reached at 26, with 19 hand-kept interfaces behind them. The RC never settled, so the
adoption happened on the second condition rather than the first; [Q26](#q26--the-ipc-types-are-generated-and-the-generated-file-is-committed)
records what made a pre-1.0 generator acceptable anyway.

**Consequence:** the embedded server is load-bearing, its lifecycle is a core service, loopback
only.

### Q10 — Release 1 ships Linux packages and a Homebrew cask; signing comes later

**Amended 2026-08-23: Windows x86_64 is built, and unsigned.** The original decision deferred
Windows entirely. What actually costs money and lead time is the _certificate_, not the build. So
Windows ships on the same terms macOS already does: an installer that the platform warns about, and
instructions for getting past the warning.

**arm64 was attempted and dropped the same day.** `windows-11-arm` runners are free for public
repositories, so the plan was to build both natively. `gdal-sys` 0.12 ends it: it ships prebuilt
bindings for four targets, `aarch64 + windows` is not among them, and it generates none at build
time unless its `bindgen` feature is on — which a bundled build cannot use, because `gdal-src`
publishes no include directory for bindgen to read. The upstream fix is one line, and the same file
already shares one binding set between x86_64 and aarch64 on Linux, so the change is small and
well-founded; applying it from here would mean a second pinned fork on top of [Q34](#q34--studio-carries-a-pinned-proj-sys-fork-until-the-libsqlite3-sys-conflict-resolves-upstream)'s.
Not worth it while Windows on ARM runs the x64 build under emulation. Revisit if upstream takes the
patch, or if ARM laptops become a large enough share to justify the fork.
SmartScreen is the Windows equivalent of Gatekeeper here.

A paid Apple Developer identity remains deferred, and so does the Windows certificate.

**Linux.** No signing. Ship Tauri's outputs from GitHub releases — with an AppImage alongside the
`.deb`, since a `.deb` built against one WebKitGTK version may not install across distributions.

**macOS via our own tap.** Three things to design around:

- Homebrew's cask signing audit is **skipped for third-party taps** (`audit.rb` returns early unless
  the tap is official), so an unsigned cask in `versatiles-org/homebrew-versatiles` passes.
  Submitting to official `homebrew-cask` should wait until we notarise.
- Homebrew still **applies quarantine**, and as of 6.0.15 there is no `--no-quarantine` flag or
  opt-out variable. Users approve once under System Settings → Privacy & Security, or run
  `xattr -d com.apple.quarantine`.
- Tauri's ad-hoc signing must still be configured — on Apple Silicon a binary needs at least an
  ad-hoc signature to execute at all.

**Cost to accept:** macOS users meet a security dialog before first launch, and Windows users meet
SmartScreen. It lands hardest on P1, who skew towards Macs. The plain-language install instructions
are the deliverable here, not the packaging.

**Revisit after release 1:** the Apple Developer account ($99/year; the lead time is approval, not
the money) and the Windows certificate route — OV, EV, or Azure Artifact Signing. Get quotes first;
certificates issued after 1 June 2023 need hardware-token or HSM storage, which complicates CI.

### Q2 — Scope of release 1 is set by the funding milestones

Analysis audience or creation audience first? Moot — the four milestones are funded, spanning
clusters A, D, E and C, and **cluster B is not in scope**, reversing the earlier roadmap. Four
independent sources agree with them:

- **Who uses VersaTiles** — of 76 showcase projects, 24 are tagged `journalism`, 16
  `data-visualisation`, 7 `storytelling`; at least 21 come from news organisations, 37 from Germany.
  Caveat: the gallery only records public web maps, so it under-counts tile operators.
- **What people ask for** — the documentation backlog is almost entirely creation workflows.
  Analysis demand is quieter and phrased as CLI ergonomics.
- **What gets used** — `@versatiles/style` sees 53,183 npm downloads a year, an order of magnitude
  above anything else. `versatiles-rs` has 13,294 release downloads; `versatiles-frontend` 6,367.
- **What it costs** — share of features per cluster building on existing machinery: B 89%, E 86%,
  F 86%, C 75%, A 63%, G 57%, D 56%. This measures whether an _engine_ exists, not total effort —
  cluster E's engines exist but its wizard UI is the expensive part.

**Risk to watch.** Four clusters is a wide front, and the two most expensive by reuse ratio (D 56%,
A 63%) are both in it. Hence the minimum reading of each milestone in the scope document.

### Q9 — Fonts and sprites are fetched per family, and never unpacked

`frontend-blank` is not used as a single bundle; `versatiles-fonts` already publishes one archive
per family. Three tiers instead ([numbers](ecosystem.md#map-assets-fonts-and-sprites)):

| Tier           | Contents                                         | Size         | When                               |
| -------------- | ------------------------------------------------ | ------------ | ---------------------------------- |
| **Bundled**    | Sprites (1.3 MB) + Latin-only Noto Sans (0.5 MB) | 1.9 MB       | in the installer                   |
| **On demand**  | One family from `versatiles-fonts` releases      | 1–45 MB each | when a style needs it              |
| **Everything** | `fonts.tar.gz`, all families                     | 107 MB       | explicit action, for offline/field |

- **Works offline from first launch** — no 109 MB wall before the user has seen a map, and the
  empty-glyph-tile trick renders non-Latin text blank rather than erroring.
- **Per-family beats all-or-nothing** — picking Roboto downloads 3 MB, not 109 MB.
- **Archives are served, never unpacked**, which is why each asset stays atomic to verify and
  delete.

Consequences:

- An **asset manifest** pinning version and checksum per family (G7). This exists:
  `assets/manifest.json`, moved only by `npm run assets:update` ([S0.12](scope-release-1.md)).
  GitHub returns a `sha256` digest on every release asset, so checking and repinning are
  metadata-only — nothing is downloaded, though the font archives total ~190 MB.
  **Correction:** an earlier draft said sprites come from a `versatiles-style` prerelease channel.
  They do not — `sprites.tar.gz` ships on stable releases (v5.13.1 at time of writing).
- B8 must distinguish "empty glyph tile by design" from "family not installed".
- G5 becomes "no network requirement _after_ the assets you chose are installed".
- F4 and F7 need the full tier, so the asset manager is their prerequisite.

Locally generated glyphs (D9) are complementary: they add fonts the releases lack, through the same
archive format, manifest and serving path.

### Q1 — VersaTiles Studio is a native Tauri v2 application

Not a subcommand serving a browser UI. Native file dialogs, drag & drop, file type associations and
being findable as an application outweigh the alternative.

**Tauri v2**, not v1. The removed template was v1, and everything since assumes v2 — the multi-window
model of [Q16](#q16--one-application-instance-one-window-per-project), the Channels of [Q3](#q3--three-planes-ipc-for-control-http-for-data-channels-for-events), and `tauri-specta`'s v2 support all
depend on it. Stated here so nobody scaffolds v1 from the old template.

**In exchange:** signing and notarisation costs (G3), building auto-update ourselves (G4), no path
for running Studio on the remote server holding a very large file, and no UI reuse inside
`versatiles-frontend-dev`.

### Q5 — No Node runtime is shipped

Every JavaScript library Studio needs runs in the browser, so all of it is bundled into the webview
at build time. Node stays a build-time dependency (npm, Vite).

Checked individually: `@versatiles/style` and `maplibre-versatiles-styler` are browser libraries;
`@versatiles/svelte` is a Svelte component library; `@versatiles/svg-renderer` ships a UMD bundle
and a `/maplibre` subpath, so F6 runs in the webview.

**Consequence:** SVG export (F6) is bounded by what the webview can render. Headless or batch image
export has no path here — acceptable, since it is not a v1 goal.

### Build on the existing `versatiles-studio` repository

The previous contents were a Tauri 1 + Svelte 4 template from January 2024 with no substantive code.
Removed; the history remains in git. Repository name, GitHub project and `app-icon.png` were kept.

### Planning documents in English

Consistent with every other repository in versatiles-org, and readable by potential contributors.
Working discussions continue in German.
