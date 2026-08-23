# Release 1 Scope

VersaTiles Studio is funded against four milestones, **M1**–**M4**. This document maps each to the
[Feature Catalogue](features.md), separates what a milestone requires from what merely fits near it,
and breaks the work into stage-scoped items (`S2.1`, `S3.4`, …) you can open issues against.

> The four milestones are fixed, and their numbers are the funder's. The minimum readings, the
> ordering and the stretch lists are our proposal and open to revision.

They span clusters A, D, E and C. Cluster B is out of scope ([Q2](decisions.md)).

---

## M1 · Open and preview all supported formats

**Required** A1 (local: `.mbtiles`, `.pmtiles`, `.versatiles`, `.tar`, directories), A2 (remote over
HTTPS and SFTP), A6 (metadata and TileJSON), A8 (feature popup) · **strongly implied** A5, A7 ·
**stretch** A4.

"Preview" only means something if vector tiles render legibly, so this pulls in the bundled asset
tier from [Q9](decisions.md) — sprites plus Latin glyphs — and a default style to render against.
Raster preview too, not just vector.

**Settled:** "all supported formats" includes remote sources. `versatiles_container` supports HTTPS
and SFTP with byte ranges, so excluding them would arbitrarily narrow the word "all".

## M2 · Create your own map style

**Required** D1 (presets and recolouring), D2 (derive a style from the layers actually present), D3
(layer tree with filter/zoom/paint editing), D8 (export), G7 (asset manager — styling is what makes
a user want a font) · **stretch** D5, D6, D9 · **out** D4, D7.

D2 is load-bearing and the hardest: for a tile set the user made themselves the editor cannot assume
Shortbread layers, so it has to read what is in the container — the same introspection as A4. D1 and
D8 are largely embedding `maplibre-versatiles-styler`; D3 is new construction.

**Settled:** "create" means start from a preset, recolour, edit layers, export — not authoring from
an empty document, which is a cartographer's tool (P5) and a far larger surface.

## M3 · Convert image and vector data into map tiles

**Required** E1 (GeoJSON, NDJSON, shapefile), E2 (CSV with lon/lat), E3 (GDAL **raster** — the "image data" half, statically bundled per [Q19](decisions.md); no GeoPackage, [Q20](decisions.md)), E7 (job queue), F2 (write the result out) · **strongly implied** C6 · **stretch** E4, E6 ·
**out** E5, dropped outright ([Q7](decisions.md)).

E7 is not optional. Conversions run for minutes to hours; without progress and cancellation the
first long run makes the app look broken.

## M4 · Edit VPL and instantly see the result

**Required** C1 (bidirectional node graph ⟷ VPL text), C2 (generated parameter forms), C3 (live
preview — the "instantly" half), C4 (inline errors), C9 (open a `.vpl` file) · **stretch** C5, C8.

**Settled ([Q11](decisions.md)):** this means node graph _plus_ text editor. C1 is a deliverable.

**C9 is what makes the milestone reachable from outside Studio.** A pipeline written by hand or
emitted by the CLI has to be openable, or "edit VPL" only ever means "edit VPL Studio wrote", and the
CLI and the GUI are two tools that cannot hand work to each other. It is cheap once the editor
exists: [Q23](decisions.md)'s parser turns the file into a document, and upstream's
`PipelineFactory::build_pipeline` takes exactly the `VPLPipeline` that document produces.

**It is the most expensive single item in release 1**, and not for the reason the catalogue suggests.
Parsing VPL is solved; writing it back is not — no serialiser, a `BTreeMap` that reorders parameters,
a parser that discards comments ([details](ecosystem.md#3-the-vpl-parser-only-runs-one-way)). So the
graph must edit text through span-based edits over a lossless syntax tree, and C4 needs the same work
since parse errors come back as strings with no positions.

---

## The dependency that saves the most work

**M3 and M4 share one engine.** E1, E2 and E3 are the `from_geo`, `from_csv` and GDAL operations of
the pipeline, so importing is a front-end onto a VPL pipeline the user could have typed. Build the
pipeline layer first and import's preview _is_ C3's preview, its "show me the VPL" escape hatch (C7)
comes for free, and fixing the pipeline fixes import. Building them separately means writing the
conversion plumbing twice. Taken to its conclusion this is why there is no import surface at all —
see [S3](#s3--import--convert--m3) below.

## Stage order

Derived from that dependency, not from the funder's numbering — which is why the milestones are
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

## Work items

One line per unit of work, scoped to its stage. **The number is identity, not order** — items are
listed roughly in dependency order but are never renumbered when something is inserted, and retired
items are never reused. `*` marks a stretch item, cut first. Where an item delivers a catalogued
feature the ID is given; where it says _infrastructure_ there is no feature, which is precisely why
the item needs an ID of its own.

### S0 · Foundation

Nothing user-visible, and a prerequisite for every milestone.

| Item      | Work                                                                                                                                                                          | Feature        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **S0.1**  | ~~Tauri shell: one window per project, dialogs, drag & drop, file associations~~ — **done**; native menus are still outstanding                                               | infrastructure |
| **S0.2**  | ~~Studio core skeleton — a plain Rust library with no Tauri types, driven by ordinary tests~~ — **done**                                                                      | infrastructure |
| **S0.3**  | ~~Control plane: `#[tauri::command]` bindings and `tauri-specta` type generation~~ — **done**; `src/lib/ipc/bindings.ts` is generated and a test fails when it is stale       | infrastructure |
| **S0.4**  | ~~Event plane: Tauri Channels for progress, warnings and log lines~~ — **done**; its `demo_job` placeholder was replaced by the real runner at S3.1                           | infrastructure |
| **S0.5**  | ~~Embedded server and server manager — one instance, named mounts, loopback only~~ — **done**                                                                                 | infrastructure |
| **S0.6**  | ~~Bundled asset tier: sprites (1.3 MB) and Latin-only glyphs (0.5 MB), pinned in `assets/manifest.json`~~ — **done**                                                          | infrastructure |
| **S0.7**  | ~~CI for Linux and macOS, including ad-hoc macOS signing~~ — **done**                                                                                                         | infrastructure |
| **S0.8**  | ~~Measure the per-webview memory baseline~~ — **done**: ~28 MB/window ([Q16](decisions.md))                                                                                   | infrastructure |
| **S0.9**  | ~~No telemetry, no account, no analytics dependency~~ — **done**, stated in the README                                                                                        | G5             |
| **S0.10** | ~~Decide the GDAL driver list~~ — **settled**: GTiff, COG, VRT, PNG, JPEG, JP2 ([Q19](decisions.md))                                                                          | infrastructure |
| **S0.11** | ~~Measure the statically bundled binary size~~ — **done**: 18.3 MB ([Q19](decisions.md))                                                                                      | infrastructure |
| **S0.12** | ~~`scripts/update-assets.ts` — check and move the pinned asset versions deliberately~~ — **done** ([Q9](decisions.md))                                                        | infrastructure |
| **S0.13** | ~~The application's name wherever the system shows it~~ — **dropped**: nothing to fix. Only `cargo tauri dev` shows the crate name, and cargo forbids the space it would need | infrastructure |

**All three checkpoints are answered, and none changed the plan.** S0.8 measured ~28 MB per window,
so [Q16](decisions.md)'s window model holds and its fallback is unused. S0.10 and S0.11 are settled
by [Q19](decisions.md): the driver list is fixed, and a statically bundled GDAL costs 18.3 MB — with
GEOS unlinked, which removes the LGPL obligation entirely.

### S1 · Open & explore → M1

| Item        | Work                                                                                                                                                                                    | Feature        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **S1.1**    | ~~Landing screen in an empty window: ways in plus recent files~~ — **done**                                                                                                             | A7             |
| **S1.2**    | ~~Open local containers — `.mbtiles`, `.pmtiles`, `.versatiles`, `.tar`, directories~~ — **done**                                                                                       | A1             |
| **S1.3**    | ~~Open remote sources over HTTPS and SFTP with byte ranges~~ — **done**; a planet file opens in ~2 s from its index                                                                     | A2             |
| **S1.4**    | ~~Map canvas and default render style; one `Map` instance, viewport owned by the core~~ — **done**, includes the MapLibre 6 worker build step ([Q18](decisions.md))                     | infrastructure |
| **S1.5**    | ~~Inspector: container metadata and TileJSON~~ — **view done**; editing needs the pipeline's `meta_update` (S2). [Q38](decisions.md) took the opener and the views back out of it       | A6             |
| **S1.6**    | ~~Feature popup on hover/click~~ — **done**                                                                                                                                             | A8             |
| **S1.7**    | ~~Tile grid overlay with z/x/y and a jump-to-coordinate box~~ — **done**                                                                                                                | A5             |
| **S1.8**    | ~~Named view bookmarks~~ — **done**, application-wide rather than in the project ([Q21](decisions.md)); renamed **views** and moved onto the map, with ordering, by [Q38](decisions.md) | A7             |
| **S1.9**    | ~~Command strip~~ — **dropped with G2**; the bottom bar is the status and job bar instead ([Q24](decisions.md))                                                                         | G2             |
| **S1.10\*** | ~~Raw MVT inspector: layers → features → properties, with byte sizes~~ — **done**                                                                                                       | A4             |
| **S1.11**   | ~~A user agent naming Studio on every remote request~~ — **done** in 4.9.1: `io::set_product` appends a second token rather than replacing, so a provider's log names both (vt#248)     | infrastructure |

### S2 · Pipeline editing → M4

The long pole. S2.1 gates everything after it.

| Item        | Work                                                                                                                                                                                                      | Feature        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **S2.1**    | ~~**Lossless VPL syntax tree and serialiser** — spans, comments, parameter order~~ — **done**, in `studio-core::vpl` ([Q23](decisions.md))                                                                | infrastructure |
| **S2.2**    | ~~The collapsible left pane, sections remembering their state~~ — **done**; state in `store::Layout` ([Q22](decisions.md))                                                                                | infrastructure |
| **S2.3**    | ~~VPL text editor over the syntax tree~~ — **done**; highlighting comes from the parser's own tokens ([Q25](decisions.md))                                                                                | C1             |
| **S2.4**    | ~~Inline parse and validation errors at the right position~~ — **done**; validation checks the document against `all_operation_metadata()`                                                                | C4             |
| **S2.5**    | ~~Node graph, tabbed with VPL: selection sync, error badge, never a stale graph~~ — **done**; a chain gains and loses transforms here too, since typing VPL was the only way before                       | C1             |
| **S2.6**    | ~~Parameter forms generated from `field_meta`~~ — **done**; controls, bounds and help text come from the metadata, and since 4.9.1 a default shows as the empty box's placeholder (vt#253)                | C2             |
| **S2.7**    | ~~Live preview of the pinned node, mounted on the embedded server~~ — **done**; the map shows the pipeline's output, not the raw container                                                                | C3             |
| **S2.8**    | ~~Undo/redo command stack over the document~~ — **done**; one stack for text, form and graph edits alike                                                                                                  | G6             |
| **S2.9**    | ~~Open a `.vpl` file — dialog, drag & drop and recents, into the editor and the graph~~ — **done**; paths inside resolve against the file, and Save writes it back                                        | C9             |
| **S2.12**   | ~~**Several named graphs per project** ([Q32](decisions.md))~~ — **done**; `graphs::Graphs` with id-not-name identity, one undo stack that names the graph to restore, and a mount per graph              | C1             |
| **S2.13**   | ~~**The graph list and the node-as-form**~~ — **done**; pin, unsaved dot and inline rename; every node shows its arguments, and the Parameters pane is gone ([Q32](decisions.md))                         | C2             |
| **S2.14**   | ~~Recommend the operations that fit, when appending a node~~ — **done**; the preview carries the verdict — what fits depends on what the build produces. Refused ones stay listed and disabled            | C2             |
| **S2.16**   | ~~Tile activity in the status bar — queued and rendering, once the wait is worth mentioning~~ — **done**; `addProtocol` puts the queue in Studio's hands, capped at 6 like the browser's per-origin limit | C3             |
| **S2.15**   | ~~Pretty-print the VPL document~~ — **done** in 4.9.1: `CstFile::format` lays out the tree that still has the comments, so no node moves and no value is re-quoted (vt#249)                               | C1             |
| **S2.10\*** | Recipe library of working starting points                                                                                                                                                                 | C5             |
| **S2.11\*** | Watch mode: source changes on disk refresh the preview                                                                                                                                                    | C8             |

**Start S2.1 during S1.** It does not exist upstream, it is not small, and everything in M4 sits on
it. Offering it to `versatiles_pipeline` early means review overlaps with cluster A rather than
following it.

### S3 · Import & convert → M3

| Item       | Work                                                                                                                                                                                                        | Feature        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **S3.1**   | ~~Job runner behind the status bar: the queue, cancellation, and a per-job log~~ — **done**; two lanes rather than one queue ([Q27](decisions.md)), and the preview became the first cancellable job        | E7             |
| **S3.2**   | ~~Import cards on the landing screen and on "+ Add source"~~ — **done**; one catalogue in the core from the operation registry, so a card cannot offer what the build lacks ([Q28](decisions.md))           | infrastructure |
| **S3.3**   | ~~Vector import: GeoJSON, NDJSON, shapefile~~ — **done**; no wizard — the imported node is selected, and the form offers the property names the data actually has ([Q29](decisions.md))                     | E1             |
| **S3.4**   | ~~Tabular point import: CSV with lon/lat columns~~ — **done**; the header is read and the coordinate columns filled in when it names them; otherwise the form offers the real columns ([Q30](decisions.md)) | E2             |
| **S3.5**   | ~~GDAL raster path: GTiff/COG, VRT, PNG, JPEG, MEM~~ — **done**, on a pinned `proj-sys` fork until the `libsqlite3-sys` conflict resolves upstream ([Q34](decisions.md), georust/proj#261)                  | E3             |
| **S3.6**   | ~~Write the result to a container as a `queued` job, with a tile-count guard and a per-graph export modal~~ — **done**; bounds and zoom become one `filter` node, so the count checked is the count written | F2             |
| **S3.7**   | ~~Sampling-based cost estimate, shown where a run is committed~~ — **done**; the real pipeline over a spread of tiles under a two-second budget, stratified by zoom because that is where the variance is   | C6             |
| **S3.8\*** | DEM workflow: terrarium encoding, hillshade, quantisation                                                                                                                                                   | E4             |
| **S3.9\*** | Table join: existing tiles plus CSV → choropleth                                                                                                                                                            | E6             |

**No import wizard surface.** A card opens the native file dialog, inserts a node into the pipeline
and selects it; S2.6's generated form is the configuration UI and S2.7's preview is the preview.

### S4 · Style → M2

**Built in this order, which is not the numbering.** The numbers are identity and never change; the
order below is the dependency. S4.2 gates the rest because it is where the document and its undo
live ([Q36](decisions.md)), and **S4.7 is folded
into it** rather than done afterwards — a stack retrofitted onto edits that already exist means
finding every mutation path again, which is the argument S2.8 already made once.

S4.1 goes last. It is the asset manager, not the style chain, and nothing here waits on it: S0.6
already bundles the sprites and Latin glyphs that make a style render. Placed first it would delay
every visible result behind a manager for assets Studio already has.

| Item        | Work                                                                                                                                                                                                                                                                 | Feature        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **S4.2**    | ~~Style pane, and the recipe the core owns, on S2.8's undo stack ([Q36](decisions.md)). Includes **S4.7**~~ — **done**; `history::Target` carries the style beside the graphs, and `map/style.ts` renders a recipe                                                   | infrastructure |
| **S4.3**    | ~~Preset styles with global recolouring — the six `@versatiles/style` builders over the project's graphs~~ — **done**; the map draws the recipe when the preset's layers match the tiles, and keeps the hairlines when they do not                                   | D1             |
| **S4.4**    | ~~Derive a style from the layers actually present in the container~~ — **done**; a preset of its own, drawing every layer the probe found in the geometry it is made of, coloured from the layer's name                                                              | D2             |
| **S4.5**    | ~~Layer tree with filter/zoom/paint editing and an expression editor~~ — **done**; visibility, colour, zoom and filter go back into the recipe. It edits **filters**, not colours ([Q37](decisions.md))                                                              | D3             |
| **S4.6**    | ~~Export `style.json`, `@versatiles/style` code, or a bundle~~ — **done**; all three carry a tile-URL placeholder, not the ephemeral local port, and the bundle brings its own glyphs and sprites                                                                    | D8             |
| **S4.1**    | ~~Asset manager for fonts and sprite sets, plus the **Map · Assets** mode bar ([Q22](decisions.md))~~ — **done for fonts**; pinned in a compiled-in manifest, verified before install, never unpacked. [Q39](decisions.md) made it a dialog and retired the mode bar | G7             |
| **S4.7**    | ~~Put style edits on S2.8's undo stack rather than building a second one~~ — **done with S4.2**; one stack, `Target::Graph` beside `Target::Style`                                                                                                                   | G6             |
| **S4.8\***  | ~~Derive a dark variant from a light style~~ — **done with S4.3**; `RecolorOptions.invertBrightness` is a checkbox in the pane and hues are kept, so a light style becomes a dark one rather than a photographic negative                                            | D5             |
| **S4.9\***  | Accessibility: contrast checking and colour-blindness simulation                                                                                                                                                                                                     | D6             |
| **S4.10\*** | Generate SDF glyphs from the user's own fonts                                                                                                                                                                                                                        | D9             |

**S4.4 turned out not to be the hardest item in the release.** It cannot assume Shortbread layers,
and it did not have to: A4's introspection already read the tile, and each layer's geometry was a
field on every feature it had decoded. What made it small is that a derived style has a much lower
bar than a preset — it is not trying to look like a map, only to make every layer visible and told
apart from its neighbours, which is what you need before styling anything (S4.5).

### S5 · Ship

Delivers no milestone, and without it none of them reaches anyone.

| Item     | Work                                                                                                                                                                                                                                                                                                                            | Feature        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **S5.1** | ~~Project directory: `project.yaml` beside real `.vpl` and `style.json`; zip and "Save As"~~ — **done**; the manifest carries the graphs and the style recipe ([Q36](decisions.md)); the files beside it work without Studio                                                                                                    | G1             |
| **S5.2** | ~~Crop and estimate in the Pipeline pane; the map as a crop tool. No Export pane ([Q31](decisions.md))~~ — **done**; the crop lives on the graph in the core, so it survives a reload and goes into the manifest                                                                                                                | infrastructure |
| **S5.4** | ~~Crop by rectangle plus a zoom range~~ — **done**: dragging on the map fills the same fields typing does, and the area is shown by dimming everything the export will not write                                                                                                                                                | F2             |
| **S5.5** | ~~Export as CLI command, serve config, Dockerfile or GitHub Action~~ — **done**; `deploy.rs` builds all four from the project as it stands, and the serve config is checked against `versatiles`' own parser                                                                                                                    | C7             |
| **S5.6** | ~~Linux packaging: `.deb` plus an AppImage, from GitHub releases~~ — **done**; `release.yml` builds on a `v*` tag, verifies every URL in `latest.json`, then publishes as _latest_; `npm run release` drives the whole thing                                                                                                    | G3             |
| **S5.7** | ~~macOS Homebrew cask in our own tap, plus install instructions covering Gatekeeper~~ — **instructions done**, which Q10 calls the deliverable; the cask is filled by `npm run cask`. **Pushing to the tap is still to do**                                                                                                     | G3             |
| **S5.8** | ~~Auto-update~~ — **done**; checked when asked, never on a timer — an app that swaps itself out mid-export is what people turn updaters off to escape. Only a **published** release resolves                                                                                                                                    | G4             |
| **S5.9** | ~~Windows packaging: an NSIS installer~~ — **done for x86_64**, which builds and smoke-tests green. **arm64 is not buildable**: `gdal-sys` has no bindings for `aarch64 + windows` and generates none when bundled ([Q10](decisions.md)). Windows on ARM runs the x64 installer under emulation. Unsigned, so SmartScreen warns | infrastructure |

**S5.7's deliverable is the instructions, not the cask.** Homebrew still applies quarantine and there
is no opt-out, so every macOS user meets a security dialog before first launch — and that lands
hardest on P1.

**Undo/redo is in S2, not after release 1.** A graph invites experimentation, and this is the cheap
moment: S2 already routes every interaction through a small set of text edits, and that edit list is
the command stack. Retrofitting means finding every mutation path afterwards.

**S5 is not polish** — without a distribution path the application reaches nobody.

## Explicitly out of release 1

Cluster B in full, F3–F7 (upload, static site export, embed snippet, image export, offline package),
and the stretch items above. Also **code signing** — an Apple Developer identity and a Windows
certificate — both deferred by [Q10](decisions.md).

**Windows builds are no longer out.** [Q10](decisions.md) was amended on 2026-08-23: what costs
money and lead time is the certificate, not the build. S5.9 is the item — **x86_64 only**, because
`gdal-sys` cannot build `aarch64 + windows` at all; Windows on ARM runs the x64 installer under
emulation.

**Dropped rather than deferred:** E5 ([Q7](decisions.md)) and A3 ([Q17](decisions.md)). Neither is
on a later roadmap.

B1, B2 and B3 are cheaper than this document once assumed — per [Q12](decisions.md) the byte
breakdown already exists upstream — and are the natural first additions once the milestones ship.
