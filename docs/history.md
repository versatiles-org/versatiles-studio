# Release History

What each release set out to do, the work items it was tracked by, and what shipped. All four have
landed; `✓` marks a delivered item.

**Item ids are identity, not order.** `S3.4` means one thing forever - items are never renumbered
when something is inserted, and a retired id is never reused - which is what lets issues and code
comments point at them. `*` marks a stretch item, cut first.

## Release 1 - the four funded milestones

Four funded milestones, **M1**-**M4**, mapped to the [Feature Catalogue](features.md).

They span clusters A, D, E and C. Cluster B is out of scope ([Q2](decisions.md)).

---

### M1 · Open and preview all supported formats

**Required** A1 (local: `.mbtiles`, `.pmtiles`, `.versatiles`, `.tar`, directories), A2 (remote over
HTTPS and SFTP), A6 (metadata and TileJSON), A8 (feature popup) · **strongly implied** A5, A7 ·
**stretch** A4.

### M2 · Create your own map style

**Required** D1 (presets and recolouring), D2 (derive a style from the layers actually present), D3
(layer tree with filter/zoom/paint editing), D8 (export), G7 (asset manager - styling is what makes
a user want a font) · **stretch** D5, D6, D9 · **out** D4, D7.

### M3 · Convert image and vector data into map tiles

**Required** E1 (GeoJSON, NDJSON, shapefile), E2 (CSV with lon/lat), E3 (GDAL **raster** - the "image data" half, statically bundled per [Q19](decisions.md); no GeoPackage, [Q20](decisions.md)), E7 (job queue), F2 (write the result out) · **strongly implied** C6 · **stretch** E4, E6 ·
**out** E5, dropped outright ([Q7](decisions.md)).

### M4 · Edit VPL and instantly see the result

**Required** C1 (bidirectional node graph ⟷ VPL text), C2 (generated parameter forms), C3 (live
preview - the "instantly" half), C4 (inline errors), C9 (open a `.vpl` file) · **stretch** C5, C8.

**Settled ([Q11](decisions.md)):** this means node graph _plus_ text editor. C1 is a deliverable.

**C9 - opening a `.vpl` written elsewhere - is what makes the milestone reachable from outside
Studio, or "edit VPL" only ever means "edit VPL Studio wrote".** M4 was the most expensive item in
the release, and not for the reason the catalogue suggested: parsing VPL was solved, writing it back
was not ([Q11](decisions.md), [Q23](decisions.md)).

---

### The dependency that saves the most work

**M3 and M4 share one engine.** E1, E2 and E3 are the `from_geo`, `from_csv` and GDAL operations of
the pipeline, so importing is a front-end onto a VPL pipeline the user could have typed. Build the
pipeline layer first and import's preview _is_ C3's preview. Taken to its conclusion, this is why
there is no import surface at all.

### Stage order

Derived from that dependency, not from the funder's numbering - which is why the milestones are
delivered in the order M1, M4, M3, M2.

| Stage  | Theme            | Delivers             |
| ------ | ---------------- | -------------------- |
| **S0** | Foundation       | nothing user-visible |
| **S1** | Open & explore   | **M1**               |
| **S2** | Pipeline editing | **M4**               |
| **S3** | Import & convert | **M3**               |
| **S4** | Style            | **M2**               |
| **S5** | Ship             | shippability         |

M2 comes last because D2 wants tiles to style, and those come from M3.

### Work items

#### S0 · Foundation

Nothing user-visible, and a prerequisite for every milestone.

| Item      | Work                                                                                 | Feature        |
| --------- | ------------------------------------------------------------------------------------ | -------------- |
| **S0.1**  | ✓ Tauri shell: one window per project, dialogs, drag & drop, file associations       | infrastructure |
| **S0.2**  | ✓ Studio core skeleton - a plain Rust library with no Tauri types                    | infrastructure |
| **S0.3**  | ✓ Control plane: `#[tauri::command]` bindings and `tauri-specta` type generation     | infrastructure |
| **S0.4**  | ✓ Event plane: Tauri Channels for progress, warnings and log lines                   | infrastructure |
| **S0.5**  | ✓ Embedded server and server manager - one instance, named mounts, loopback only     | infrastructure |
| **S0.6**  | ✓ Bundled asset tier: sprites (1.3 MB) and Latin-only glyphs (0.5 MB)                | infrastructure |
| **S0.7**  | ✓ CI for Linux and macOS, including ad-hoc macOS signing                             | infrastructure |
| **S0.8**  | ✓ Measure the per-webview memory baseline                                            | infrastructure |
| **S0.9**  | ✓ No telemetry, no account, no analytics dependency                                  | G5             |
| **S0.10** | ✓ Decide the GDAL driver list                                                        | infrastructure |
| **S0.11** | ✓ Measure the statically bundled binary size                                         | infrastructure |
| **S0.12** | ✓ `scripts/update-assets.ts` - check and move the pinned asset versions deliberately | infrastructure |
| **S0.13** | ✓ The application's name wherever the system shows it                                | infrastructure |

**All three checkpoints are answered, and none changed the plan.** S0.8 measured ~28 MB per window,
so [Q16](decisions.md)'s window model holds and its fallback is unused. S0.10 and S0.11 are settled
by [Q19](decisions.md): the driver list is fixed, and a statically bundled GDAL costs 18.3 MB - with
GEOS unlinked, which removes the LGPL obligation entirely.

#### S1 · Open & explore → M1

| Item        | Work                                                                                  | Feature        |
| ----------- | ------------------------------------------------------------------------------------- | -------------- |
| **S1.1**    | ✓ Landing screen in an empty window: ways in plus recent files                        | A7             |
| **S1.2**    | ✓ Open local containers - `.mbtiles`, `.pmtiles`, `.versatiles`, `.tar`, directories  | A1             |
| **S1.3**    | ✓ Open remote sources over HTTPS and SFTP with byte ranges                            | A2             |
| **S1.4**    | ✓ Map canvas and default render style; one `Map` instance, viewport owned by the core | infrastructure |
| **S1.5**    | ✓ Inspector: container metadata and TileJSON                                          | A6             |
| **S1.6**    | ✓ Feature popup on hover/click                                                        | A8             |
| **S1.7**    | ✓ Tile grid overlay with z/x/y and a jump-to-coordinate box                           | A5             |
| **S1.8**    | ✓ Named view bookmarks                                                                | A7             |
| **S1.9**    | ✓ Command strip                                                                       | G2             |
| **S1.10\*** | ✓ Raw MVT inspector: layers → features → properties, with byte sizes                  | A4             |
| **S1.11**   | ✓ A user agent naming Studio on every remote request                                  | infrastructure |

#### S2 · Pipeline editing → M4

The long pole. S2.1 gates everything after it.

| Item        | Work                                                                                  | Feature        |
| ----------- | ------------------------------------------------------------------------------------- | -------------- |
| **S2.1**    | ✓ **Lossless VPL syntax tree and serialiser** - spans, comments, parameter order      | infrastructure |
| **S2.2**    | ✓ The collapsible left pane, sections remembering their state                         | infrastructure |
| **S2.3**    | ✓ VPL text editor over the syntax tree                                                | C1             |
| **S2.4**    | ✓ Inline parse and validation errors at the right position                            | C4             |
| **S2.5**    | ✓ Node graph, tabbed with VPL: selection sync, error badge, never a stale graph       | C1             |
| **S2.6**    | ✓ Parameter forms generated from `field_meta`                                         | C2             |
| **S2.7**    | ✓ Live preview of the pinned node, mounted on the embedded server                     | C3             |
| **S2.8**    | ✓ Undo/redo command stack over the document                                           | G6             |
| **S2.9**    | ✓ Open a `.vpl` file - dialog, drag & drop and recents, into the editor and the graph | C9             |
| **S2.12**   | ✓ **Several named graphs per project** ([Q32](decisions.md))                          | C1             |
| **S2.13**   | ✓ **The graph list and the node-as-form**                                             | C2             |
| **S2.14**   | ✓ Recommend the operations that fit, when appending a node                            | C2             |
| **S2.16**   | ✓ Tile activity in the status bar                                                     | C3             |
| **S2.15**   | ✓ Pretty-print the VPL document                                                       | C1             |
| **S2.10\*** | Recipe library of working starting points                                             | C5             |
| **S2.11\*** | Watch mode: source changes on disk refresh the preview                                | C8             |

**Start S2.1 during S1.** It does not exist upstream, it is not small, and everything in M4 sits on
it. Offering it to `versatiles_pipeline` early means review overlaps with cluster A rather than
following it.

#### S3 · Import & convert → M3

| Item       | Work                                                                           | Feature        |
| ---------- | ------------------------------------------------------------------------------ | -------------- |
| **S3.1**   | ✓ Job runner behind the status bar: the queue, cancellation, and a per-job log | E7             |
| **S3.2**   | ✓ Import cards on the landing screen and on "+ Add source"                     | infrastructure |
| **S3.3**   | ✓ Vector import: GeoJSON, NDJSON, shapefile                                    | E1             |
| **S3.4**   | ✓ Tabular point import: CSV with lon/lat columns                               | E2             |
| **S3.5**   | ✓ GDAL raster path: GTiff/COG, VRT, PNG, JPEG, MEM                             | E3             |
| **S3.6**   | ✓ Write the result to a container as a `queued` job                            | F2             |
| **S3.7**   | ✓ Sampling-based cost estimate, shown where a run is committed                 | C6             |
| **S3.8\*** | DEM workflow: terrarium encoding, hillshade, quantisation                      | E4             |
| **S3.9\*** | Table join: existing tiles plus CSV → choropleth                               | E6             |

**No import wizard surface.** A card opens the native file dialog, inserts a node into the pipeline
and selects it; S2.6's generated form is the configuration UI and S2.7's preview is the preview.

#### S4 · Style → M2

**Built in this order, which is not the numbering.** The numbers are identity and never change; the
order below is the dependency. S4.2 gates the rest because it is where the document and its undo
live ([Q36](decisions.md)), and **S4.7 is folded
into it** rather than done afterwards - a stack retrofitted onto edits that already exist means
finding every mutation path again, which is the argument S2.8 already made once.

| Item        | Work                                                                                   | Feature        |
| ----------- | -------------------------------------------------------------------------------------- | -------------- |
| **S4.2**    | ✓ Style pane, and the recipe the core owns, on S2.8's undo stack ([Q36](decisions.md)) | infrastructure |
| **S4.3**    | ✓ Preset styles with global recolouring                                                | D1             |
| **S4.4**    | ✓ Derive a style from the layers actually present in the container                     | D2             |
| **S4.5**    | ✓ Layer tree with filter/zoom/paint editing and an expression editor                   | D3             |
| **S4.6**    | ✓ Export `style.json`, `@versatiles/style` code, or a bundle                           | D8             |
| **S4.1**    | ✓ Asset manager for fonts and sprite sets                                              | G7             |
| **S4.7**    | ✓ Put style edits on S2.8's undo stack rather than building a second one               | G6             |
| **S4.8\***  | ✓ Derive a dark variant from a light style                                             | D5             |
| **S4.9\***  | Accessibility: contrast checking and colour-blindness simulation                       | D6             |
| **S4.10\*** | Generate SDF glyphs from the user's own fonts                                          | D9             |

#### S5 · Ship

Delivers no milestone, and without it none of them reaches anyone.

| Item     | Work                                                                                                     | Feature        |
| -------- | -------------------------------------------------------------------------------------------------------- | -------------- |
| **S5.1** | ✓ Project directory: `project.yaml` beside real `.vpl` and `style.json`; zip and "Save As"               | G1             |
| **S5.2** | ✓ Crop and estimate in the Pipeline pane; the map as a crop tool                                         | infrastructure |
| **S5.4** | ✓ Crop by rectangle plus a zoom range                                                                    | F2             |
| **S5.5** | ✓ Export as CLI command, serve config, Dockerfile or GitHub Action - since removed ([Q40](decisions.md)) | ~~C7~~         |
| **S5.6** | ✓ Linux packaging: `.deb` plus an AppImage, from GitHub releases                                         | G3             |
| **S5.7** | ✓ macOS Homebrew cask in our own tap, plus install instructions covering Gatekeeper                      | G3             |
| **S5.8** | ✓ Auto-update                                                                                            | G4             |
| **S5.9** | ✓ Windows packaging: an NSIS installer                                                                   | infrastructure |

---

## Release 2 - the style pane learns what it is looking at

Release 1 shipped a style pane that works for one kind of tileset. This release makes it work for the
kinds people actually open.

The stages continue release 1's numbering rather than restarting - `S6.1` is unambiguous where a
second `S1.1` would not be, and the items are what issues get opened against.

The case for the work, read against the code rather than against the plan, is in
[Style Use Cases](history.md); this is only the work list.

---

### S6 · Style modes → the four things people open

A Shortbread container, a raster of imagery, a DEM, and vector tiles that are not Shortbread. Today
the first works and the other three produce a pane whose every control is a no-op - not disabled, not
explained, just inert.

**Built in this order, which is not the numbering.** The numbers are identity and never change; the
order below is the dependency.

**S6.1 to S6.3 are worth landing on their own.** Each is small, none depends on the others, and each
removes a way the pane currently misleads. If the rest of this stage slips, those three still leave
Studio honest about what it is showing.

**S6.4 is the breaking change and belongs before a release, not after one.** It rewrites what
`project.yaml` carries, and the number of projects in the world only goes up. It is deliberately
separated from S6.5 so two large changes do not land together - the recipe changes shape while the
interface stays still, and then the interface moves over a shape that already works.

| Item     | Work                                                                                 | Feature        |
| -------- | ------------------------------------------------------------------------------------ | -------------- |
| **S6.1** | ✓ Surface `tile_schema` through `ContainerInfo` and say what a source is being drawn | infrastructure |
| **S6.2** | ✓ Derive a style where a preset would draw nothing, instead of drawing none          | D2             |
| **S6.3** | ✓ The raster imagery editor                                                          | D11            |
| **S6.4** | ✓ Split the recipe's appearance into a tagged union and migrate `project.yaml` to    | infrastructure |
| **S6.5** | ✓ The source stack: one style over several graphs, drawn bottom-up                   | D1, D11        |
| **S6.6** | ✓ The DEM editor                                                                     | D12            |
| **S6.7** | ✓ Settle the override collision within a source                                      | infrastructure |

| **S6.8** | ✓ A problem log a user can copy | infrastructure |

`*` was a stretch item: it landed after S6.4 and blocked nothing.

**S6.6 is last because nothing waits on it.** It is the most new code and the least existing
scaffolding - `add-source.ts` has no `raster-dem` branch and `composeStyle` has no `hillshade` one -
while S6.1 to S6.5 each reuse something that is already written and tested.

### What breaks, and where it is caught

**`bindings_are_up_to_date` is the tripwire for S6.1 and S6.4.** It fails the moment the Rust types move and the generated TypeScript has not, which is the failure mode worth having: loud, immediate, and in the same commit as the cause.

### Not in this release

**A bundled reference basemap.** Two things now put something under your data: a second graph lower in the stack, and the **background map**, which S6.5 turned into the stack's bottom entry rather than an alternative to it. What is still missing is tiles to draw when there is no network - the background fetches from versatiles.org, while [G5](features.md) promises Studio works offline from first launch.

### What S6.5 settled: every graph is built when a project opens

`preview.refresh` used to mount one graph, and `preview.svelte.ts` said why - building all of them on every refresh is "a job apiece for tiles nobody draws". Something draws them now, so the cost had to land somewhere, and it lands **on open**: `mountAll` builds every graph a project has at the moment a person is already waiting for it, and `refresh` still rebuilds only the graph being edited.

---

## The four things people open, which release 2 was the case for

What someone opens, what they want to do with it, and what the style pane does about it. Four cases,
read against the code rather than against the plan.

Not to be confused with [Styling](styling.md), which is Studio's own CSS.

The gaps named here are the ones S6.1-S6.7 closed; the design argued for is the one that shipped.

### The finding these four share

**The container already declares what it is, and Studio ignores it.** `versatiles_core` publishes `tile_schema` in TileJSON (`types/tilejson/lib.rs:160`) with exactly the values this needs - `rgb`, `rgba`, `dem/mapbox`, `dem/terrarium`, `dem/versatiles`, `openmaptiles`, `shortbread@1.0`, `other`. It arrives inside `ContainerInfo::tile_json`, which is passed through opaque. Searching the repository for `tile_schema` returns nothing.

### UC1 - A Shortbread vector container

**Has** `europe.versatiles`, Shortbread layer names. **Wants** a basemap that looks good, and a `style.json` at the end of it.

### UC2 - A raster container of imagery

**Has** `satellite.versatiles`, jpg tiles. **Wants** to brighten it, drop the saturation, and put labels over it.

### UC3 - A raster container holding a DEM

Separated from UC2 because it is the case where inference cannot work at all.

### UC4 - Vector tiles that are not Shortbread

Pipeline output, or somebody else's tileset. The most common thing the pipeline pane produces.

### The mode belongs to the source, not to the pane

The pane is a **stack of sources**, each with its own kind and its own editor:

### A source's kind is stated, not guessed

Every source shows what it is being drawn as, and the statement can be corrected:

### Four editors over one skeleton

Every source, whatever its kind, carries **visibility · opacity · zoom range · position in the stack**. That is the frame. Inside it:

---

## Release 3 - a window is a project

Release 2 made the style pane honest about what it is showing. This release makes **a window mean a
project** - which [Q16](decisions.md) decided at S0.8 and nothing since has actually built.

The decision this implements, and what it supersedes, is
[Q48](decisions.md#q48---a-window-is-a-project).

---

### S7 · One window, one project - and a launcher of its own

**What the code did before this stage.** Every piece of project state in `AppState` was a single
app-wide `Mutex`: `graphs`, `style`, `history`, `pinned`, `project_dir`, `project_root` - and
`layout`, which carries the pane widths, the background _and the camera_. So ⌘N opened a second
window onto the same project, sharing one undo stack and one viewport. `open_project`'s own doc
comment conceded it: _"opening a second one beside the first would leave two sets of graphs sharing
an undo stack and a style, which is not a project."_

**And the launcher was a screen inside that window.** `LandingScreen` rendered over the map region
whenever there were no graphs, which made a project window two different things depending on its
contents - and made "new project" mean "empty this window out".

| Item     | Work                                     | Feature        |
| -------- | ---------------------------------------- | -------------- |
| **S7.1** | ✓ **A project per window.**              | infrastructure |
| **S7.2** | ✓ **Mounts namespaced per window.**      | infrastructure |
| **S7.3** | ✓ **A job list per project.**            | E7             |
| **S7.4** | ✓ **Layout per window.**                 | infrastructure |
| **S7.5** | ✓ **The launcher as a window.**          | A1, A2, A7     |
| **S7.6** | ✓ **The handoff.**                       | infrastructure |
| **S7.7** | ✓ **Startup and lifecycle.**             | infrastructure |
| **S7.8** | ✓ **The menu follows focus.**            | infrastructure |
| **S7.9** | ✓ **The in-window landing screen goes.** | infrastructure |

**Built in this order, which is close to the numbering but not identical.** S7.1 is the change
everything else stands on. S7.2, S7.3 and S7.4 are not separate features - they are the three places
where app-wide state was doing per-project work, and each is a live bug the moment two windows
exist. They land with S7.1 or immediately after it, before anything invites a person to open a
second project.

S7.5 to S7.9 are the visible half and are mostly new code: a second entry point, a window, and the
wiring between them.

**All of S7 has landed.** S7.1 to S7.4 made a window mean a project - its own graphs, undo stack,
tiles, job list and camera - and not one line of TypeScript changed for it, because specta skips a
`Window` argument the way it skips `AppHandle`. S7.5 to S7.9 made the launcher a window and took the
last of it out of the workbench.

### The three collisions S7.1 exposes

Each was found by reading, not by running, and each produces a symptom nowhere near its cause. They
are worth naming because "make the state per window" sounds complete and is not.

**Mounts are named after the graph.** `build_into` calls `server.mount(name, …)` with the graph's
name, and one server serves the whole application. Two projects with a graph called `pipeline` - the
name a container import gives its first graph - mount over each other, and each window draws the
other's tiles. Pinned previews are worse: every one of them mounts under the literal `preview`.
`Preview` already carries `name` and `tile_url` separately, so the fix has room: the mount key gains
the window, the name stays the graph's, and the style's source ids do not move (S7.2).

**`Lane::Latest` cancels application-wide.** The lane means "newest wins", which is exactly right for
a preview of a document that has since been edited - and catastrophic across projects: every
keystroke in one window cancels the other window's build. The lane needs to know whose it is (S7.3).

**`Layout` holds the camera.** It reads as pane state and is not: `background` and `view` are map
settings, and two windows sharing them means panning one pans the other on its next save (S7.4).

### What breaks, and where it is caught

**`bindings_are_up_to_date` is the tripwire for S7.1.** Around forty commands gain the window they were called from, and the generated TypeScript changes with every one of them. The test fails until `src/lib/ipc/bindings.ts` is regenerated, which is what stops a signature drifting silently.

### What stays where it is

**One embedded server, one job runner, one core.** Q16's argument for windows over separate application instances was never about state being global - it was about one Rust core, one server with named mounts, and one asset writer. All of that stands. What changes is that a _project_ is now a thing the core holds several of.

---

## Release 4 - the rules move somewhere a test can reach them

Release 3 made a window mean a project. This release is about a pattern the three before it left
behind: **a rule living where nothing can check it.**

Six defects were found by reading the code rather than by using it, and they are the same shape. Two
outcomes that wanted opposite things arrived as one `Option`. A record of what the map draws was
cleared by one of the three paths that stop drawing it. A pane kept the last parse of a document it
was no longer showing. A component named a design token that has never existed, and `var()` dropped
the declaration in silence. None of them failed a test, because none of them was anywhere a test
could ask.

So the fixes are half of it and the other half is where the code lives: `App.svelte` held twelve
`$derived`s deciding what the map draws and two dozen functions sequencing what happens when
something is opened, and both were reachable only by opening the application and looking.

---

### S8 · What the code claims, checked

**What the code did before this stage.** `docs/layers.md` was linked from sixteen files, including
committed Rust doc comments and the generated bindings, and had never been committed - so it left no
trace in `git` when it went. `mount_graph` answered `Option<Preview>` for both "this graph serves
nothing" and "a newer build took the lane", so the webview could only pick a side and picked the one
that left switched-off tiles on the map. And `App.svelte` was 1220 lines.

| Item      | Work                                                                         | Feature        |
| --------- | ---------------------------------------------------------------------------- | -------------- |
| **S8.1**  | ✓ The layer stack document, and the sixteen references that outlived it      | infrastructure |
| **S8.2**  | ✓ Tell a superseded build from a graph that draws nothing                    | infrastructure |
| **S8.3**  | ✓ One record for what the preview draws, cleared by everything that stops it | C3             |
| **S8.4**  | ✓ The pane's draft belongs to the document it was typed into                 | C4             |
| **S8.5**  | ✓ Every `var(--token)` names a token that exists                             | infrastructure |
| **S8.6**  | ✓ A tile's abort listener is released with its slot                          | infrastructure |
| **S8.7**  | ✓ Delete what nothing calls                                                  | infrastructure |
| **S8.8**  | ✓ Comments and documents that describe code which is not there               | infrastructure |
| **S8.9**  | ✓ The preview's state as one record, so the test seam cannot fall behind it  | infrastructure |
| **S8.10** | ✓ The rules leave the page root                                              | infrastructure |

**S8.2 before S8.3, which is the only ordering that is not obvious.** `refresh` cannot take stale
layers off the map without also blanking it mid-keystroke, because it could not tell the two cases
apart - so the fix for the visible bug needed the one nobody would have filed first.

**S8.10 is three extractions, smallest risk first.** `map/composition.svelte.ts` is what the map
draws, `shell/window-events.svelte.ts` is what reaches a window from outside it, and
`state/workbench.svelte.ts` is opening things and the order that keeps every view agreeing. Only the
last needs anything the component owns, and it takes the map as a function rather than an instance -
one held across a reload would be stale.

### What breaks, and where it is caught

**`bindings_are_up_to_date` is the tripwire for S8.2**, which turns `Option<Preview>` into a tagged
union and changes the generated TypeScript with it.

**Four guards arrived that did not exist**, each for a failure that had already happened: a
`var(--token)` must resolve, a pane folder must be in the component inventory, `reset()` cannot fall
behind the state it clears, and the composed style must keep its identity across reads - a getter
rebuilding it per read is a full `setStyle` per render, and nothing else would notice.

### What this is not

**Not a rewrite, and not a feature.** Every rule here already existed and is unchanged; what moved is
where it is written, and what is new is the ability to ask it a question. `App.svelte` is 554 lines
of wiring and markup, and the end-to-end stories - which are what cover the wiring the unit tests
cannot reach - pass unchanged.
