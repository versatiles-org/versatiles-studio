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
preview — the "instantly" half), C4 (inline errors) · **stretch** C5, C8.

**Settled ([Q11](decisions.md)):** this means node graph _plus_ text editor. C1 is a deliverable.

**It is the most expensive single item in release 1**, and not for the reason the catalogue suggests.
Parsing VPL is solved; writing it back is not — no serialiser, a `BTreeMap` that reorders parameters,
a parser that discards comments ([details](ecosystem.md#3-the-vpl-parser-only-runs-one-way)). So the
graph must edit text through span-based edits over a lossless syntax tree, and C4 needs the same work
since parse errors come back as strings with no positions.

---

## The dependency that saves the most work

**M3 and M4 share one engine.** E1, E2 and E3 are the `from_geo`, `from_csv` and GDAL operations of
the pipeline, so the import wizard is a guided front-end onto a VPL pipeline the user could have
typed. Build the pipeline layer first and the wizard's preview _is_ C3's preview, every wizard gets a
"show me the VPL" escape hatch (G2, satisfying C7), and fixing the pipeline fixes the wizard.
Building them separately means writing the conversion plumbing twice.

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

| Item      | Work                                                                                                    | Feature        |
| --------- | ------------------------------------------------------------------------------------------------------- | -------------- |
| **S0.1**  | Tauri shell: one window per project, native menus, dialogs, drag & drop, file associations              | infrastructure |
| **S0.2**  | Studio core skeleton — a plain Rust library with no Tauri types, driven by ordinary tests               | infrastructure |
| **S0.3**  | Control plane: `#[tauri::command]` bindings and `tauri-specta` type generation                          | infrastructure |
| **S0.4**  | Event plane: Tauri Channels for progress, warnings and log lines                                        | infrastructure |
| **S0.5**  | Embedded server and server manager — one instance, named mounts, loopback only                          | infrastructure |
| **S0.6**  | Bundled asset tier: sprites (1.3 MB) and Latin-only glyphs (~1.1 MB), pinned in `assets/manifest.json`  | infrastructure |
| **S0.7**  | CI for Linux and macOS, including ad-hoc macOS signing                                                  | infrastructure |
| **S0.8**  | ~~Measure the per-webview memory baseline~~ — **done**: ~28 MB/window ([Q16](decisions.md))             | infrastructure |
| **S0.9**  | ~~No telemetry, no account, no analytics dependency~~ — **done**, stated in the README                  | G5             |
| **S0.10** | ~~Decide the GDAL driver list~~ — **settled**: GTiff, COG, VRT, PNG, JPEG, JP2 ([Q19](decisions.md))    | infrastructure |
| **S0.11** | ~~Measure the statically bundled binary size~~ — **done**: 18.3 MB ([Q19](decisions.md))                | infrastructure |
| **S0.12** | `scripts/update-assets.ts` — check and move the pinned asset versions deliberately ([Q9](decisions.md)) | infrastructure |

**All three checkpoints are answered, and none changed the plan.** S0.8 measured ~28 MB per window,
so [Q16](decisions.md)'s window model holds and its fallback is unused. S0.10 and S0.11 are settled
by [Q19](decisions.md): the driver list is fixed, and a statically bundled GDAL costs 18.3 MB — with
GEOS unlinked, which removes the LGPL obligation entirely.

### S1 · Open & explore → M1

| Item        | Work                                                                                                                                                                | Feature        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **S1.1**    | ~~Landing screen in an empty window: ways in plus recent files~~ — **done**                                                                                         | A7             |
| **S1.2**    | ~~Open local containers — `.mbtiles`, `.pmtiles`, `.versatiles`, `.tar`, directories~~ — **done**                                                                   | A1             |
| **S1.3**    | ~~Open remote sources over HTTPS and SFTP with byte ranges~~ — **done**; a planet file opens in ~2 s from its index                                                 | A2             |
| **S1.4**    | ~~Map canvas and default render style; one `Map` instance, viewport owned by the core~~ — **done**, includes the MapLibre 6 worker build step ([Q18](decisions.md)) | infrastructure |
| **S1.5**    | ~~Inspector: container metadata and TileJSON~~ — **view done**; editing needs the pipeline's `meta_update` (S2)                                                     | A6             |
| **S1.6**    | ~~Feature popup on hover/click~~ — **done**                                                                                                                         | A8             |
| **S1.7**    | ~~Tile grid overlay with z/x/y and a jump-to-coordinate box~~ — **done**                                                                                            | A5             |
| **S1.8**    | Named view bookmarks stored in the project                                                                                                                          | A7             |
| **S1.9**    | ~~Command strip — the CLI equivalent of the last action, copyable~~ — **done**                                                                                      | G2             |
| **S1.10\*** | Raw MVT inspector: layers → features → properties, with byte sizes                                                                                                  | A4             |

### S2 · Pipeline editing → M4

The long pole. S2.1 gates everything after it.

| Item        | Work                                                                                             | Feature        |
| ----------- | ------------------------------------------------------------------------------------------------ | -------------- |
| **S2.1**    | **Lossless VPL syntax tree and serialiser** — spans, comments, parameter order. Ideally upstream | infrastructure |
| **S2.2**    | Mode bar; Explore and Pipeline as separate modes; state that survives a switch                   | infrastructure |
| **S2.3**    | VPL text editor over the syntax tree                                                             | C1             |
| **S2.4**    | Inline parse and validation errors at the right position                                         | C4             |
| **S2.5**    | Node graph, tabbed with VPL: selection sync, error badge, never a stale graph                    | C1             |
| **S2.6**    | Parameter forms generated from `field_meta`                                                      | C2             |
| **S2.7**    | Live preview of the selected node, mounted on the embedded server                                | C3             |
| **S2.8**    | Undo/redo command stack over the syntax tree's edit list                                         | G6             |
| **S2.9\***  | Recipe library of working starting points                                                        | C5             |
| **S2.10\*** | Watch mode: source changes on disk refresh the preview                                           | C8             |

**Start S2.1 during S1.** It does not exist upstream, it is not small, and everything in M4 sits on
it. Offering it to `versatiles_pipeline` early means review overlaps with cluster A rather than
following it.

### S3 · Import & convert → M3

| Item       | Work                                                                                                                            | Feature        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **S3.1**   | Job runner and job bar: progress, cancellation, and an expandable per-job log                                                   | E7             |
| **S3.2**   | Import cards on the landing screen and on "+ Add source"                                                                        | infrastructure |
| **S3.3**   | Vector import: GeoJSON, NDJSON, shapefile                                                                                       | E1             |
| **S3.4**   | Tabular point import: CSV with lon/lat columns                                                                                  | E2             |
| **S3.5**   | GDAL raster path: GTiff/COG, VRT, PNG, JPEG, MEM. Block pkg-config in the build or it links a system GDAL ([Q19](decisions.md)) | E3             |
| **S3.6**   | Write the result to a container                                                                                                 | F2             |
| **S3.7**   | Sampling-based cost estimate, shown where a run is committed                                                                    | C6             |
| **S3.8\*** | DEM workflow: terrarium encoding, hillshade, quantisation                                                                       | E4             |
| **S3.9\*** | Table join: existing tiles plus CSV → choropleth                                                                                | E6             |

**No import wizard surface.** A card opens the native file dialog, inserts a node into the pipeline
and selects it; S2.6's generated form is the configuration UI and S2.7's preview is the preview.

### S4 · Style → M2

| Item        | Work                                                                          | Feature        |
| ----------- | ----------------------------------------------------------------------------- | -------------- |
| **S4.1**    | Asset manager: download, pin, verify and remove font families and sprite sets | G7             |
| **S4.2**    | Style mode: layer tree pane and paint inspector                               | infrastructure |
| **S4.3**    | Preset styles with global recolouring                                         | D1             |
| **S4.4**    | Derive a style from the layers actually present in the container              | D2             |
| **S4.5**    | Layer tree with filter/zoom/paint editing and an expression editor            | D3             |
| **S4.6**    | Export `style.json`, `@versatiles/style` code, or a bundle                    | D8             |
| **S4.7**    | Put style edits on S2.8's undo stack rather than building a second one        | G6             |
| **S4.8\***  | Derive a dark variant from a light style                                      | D5             |
| **S4.9\***  | Accessibility: contrast checking and colour-blindness simulation              | D6             |
| **S4.10\*** | Generate SDF glyphs from the user's own fonts                                 | D9             |

**S4.4 is the hardest item in the release.** It cannot assume Shortbread layers — it has to read what
is in the container, which is the same introspection as A4 (S1.10).

### S5 · Ship

Delivers no milestone, and without it none of them reaches anyone.

| Item     | Work                                                                                     | Feature        |
| -------- | ---------------------------------------------------------------------------------------- | -------------- |
| **S5.1** | Project directory: `project.yaml` beside real `.vpl` and `style.json`; zip and "Save As" | G1             |
| **S5.2** | Publish mode: export options, and the map as a crop input                                | infrastructure |
| **S5.3** | Local server toggle with LAN URL and QR code                                             | F1             |
| **S5.4** | Crop by rectangle plus a zoom range                                                      | F2             |
| **S5.5** | Export as CLI command, serve config, Dockerfile or GitHub Action                         | C7             |
| **S5.6** | Linux packaging: `.deb` plus an AppImage, from GitHub releases                           | G3             |
| **S5.7** | macOS Homebrew cask in our own tap, plus install instructions covering Gatekeeper        | G3             |
| **S5.8** | Auto-update                                                                              | G4             |

**S5.7's deliverable is the instructions, not the cask.** Homebrew still applies quarantine and there
is no opt-out, so every macOS user meets a security dialog before first launch — and that lands
hardest on P1.

**Undo/redo is in S2, not after release 1.** A graph invites experimentation, and this is the cheap
moment: S2 already routes every interaction through a small set of text edits, and that edit list is
the command stack. Retrofitting means finding every mutation path afterwards.

**S5 is not polish** — without a distribution path the application reaches nobody.

## Explicitly out of release 1

Cluster B in full, F3–F7 (upload, static site export, embed snippet, image export, offline package),
and the stretch items above. Also **Windows builds** and **Apple Developer signing**, both deferred
by [Q10](decisions.md).

**Dropped rather than deferred:** E5 ([Q7](decisions.md)) and A3 ([Q17](decisions.md)). Neither is
on a later roadmap.

B1, B2 and B3 are cheaper than this document once assumed — per [Q12](decisions.md) the byte
breakdown already exists upstream — and are the natural first additions once the milestones ship.
