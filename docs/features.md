# Feature Catalogue

> Draft. This is the **idea pool**; the **Stage** column says what is actually scheduled. See
> [Release 1 Scope](scope-release-1.md) for why, and [Roadmap](roadmap.md) for what comes after.

Seven clusters, stable IDs so they can be referenced from other documents and from issues. The
**Basis** column records what already exists to build on — the difference between a feature that
takes a week and one that takes a quarter; details are in the
[Ecosystem Inventory](ecosystem.md). Who each feature is for is recorded the other way round, in
[Target Audiences](audiences.md).

**Stage values.** `0`–`5` are the release 1 stages from
[Release 1 Scope](scope-release-1.md#stage-order), where each stage is broken into work items
(`S2.1`, `S3.4`, …). Everything else is after 1.0:

| Value       | Meaning                                                                             |
| ----------- | ----------------------------------------------------------------------------------- |
| `0`–`5`     | Committed to that stage of release 1                                                |
| `N stretch` | Wanted in stage N, first to be cut — drops to `later` or `someday` if time runs out |
| `next`      | The cheapest valuable additions immediately after release 1                         |
| `later`     | Worth doing, no date                                                                |
| `someday`   | Deliberately open-ended; revisit when users say they miss it                        |
| `dropped`   | Decided against, and not on a later roadmap                                         |

---

## Cluster A · Open & Explore

The foundation. Everything else renders into this surface.

| ID     | Stage       | Feature                                                                                                     | Basis                               |
| ------ | ----------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **A1** | `1`         | Open local containers by drag & drop or dialog: `.mbtiles`, `.pmtiles`, `.versatiles`, `.tar`, directories  | `versatiles_container`              |
| **A2** | `1`         | Open remote sources over HTTPS and SFTP, with byte ranges so a planet file opens instantly                  | `versatiles_container`              |
| ~~A3~~ | `dropped`   | ~~Multi-source workspace: layer stack with opacity, swipe comparison and split view~~ ([Q17](decisions.md)) | not pursued                         |
| **A4** | `1 stretch` | **Raw MVT inspector**: layers → features → properties as a tree, with byte sizes and geometry preview       | `versatiles_geometry`, `probe -ddd` |
| **A5** | `1`         | Tile grid overlay showing z/x/y, with a jump-to-coordinate box                                              | new                                 |
| **A6** | `1`         | View and **edit** container metadata and TileJSON                                                           | `meta_update`                       |
| **A7** | `1`         | Recent files, and named view bookmarks stored in the project                                                | new                                 |
| **A8** | `1`         | Feature popup showing all attributes of the feature under the cursor                                        | MapLibre                            |

---

## Cluster B · Analyse & QA

**Where the strongest differentiation lies**, and entirely after release 1 ([Q2](decisions.md)).
Mostly a visual front-end for analysis `versatiles probe` already performs, which makes it cheaper
than it looks ([Q12](decisions.md)).

| ID     | Stage     | Feature                                                                                                   | Basis                                       |
| ------ | --------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **B1** | `next`    | Tile size heat map per zoom; p50/p95/max; top-N largest tiles, clickable                                  | `probe -dd`; index-only                     |
| **B2** | `next`    | **Byte breakdown per layer and per attribute** — which layer, which property is eating your z14 tiles     | `tile_breakdown.rs` does the per-layer half |
| **B3** | `next`    | Spec validation against MVT 2.1, versatiles-spec, TileJSON and the style schema, with a **repair button** | `probe -ddd` emits a `fix:` suggestion      |
| **B4** | `later`   | Coverage map: which tiles exist versus what the bounding box claims — find holes                          | `probe -dd`; index-only                     |
| **B5** | `later`   | **Container diff**: compare two versions visually and statistically — a regression test per rebuild       | new; first feature needing two maps         |
| **B6** | `someday` | Compression comparison (gzip/brotli/zstd) and raster format comparison, with visual difference            | `versatiles_image`, convert                 |
| **B7** | `someday` | Attribute statistics: value distribution per property — the basis for filtering and styling decisions     | `versatiles_geometry`                       |
| **B8** | `someday` | Glyph and sprite check: missing glyphs for a language, style references to icons that do not exist        | `versatiles-glyphs-rs`                      |
| **B9** | `someday` | Load-time estimate for a viewport at 3G/4G speeds                                                         | derived from B1                             |

---

## Cluster C · Pipeline Editor (VPL)

| ID     | Stage       | Feature                                                                                                            | Basis                                                 |
| ------ | ----------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| **C1** | `2`         | **Bidirectional node graph ⟷ VPL text.** The text stays the source of truth; the graph is a view onto it           | parses, but **no serialiser** ([Q11](decisions.md))   |
| **C2** | `2`         | **Parameter forms generated from `field_meta`** — no hand-written UI, new operations appear for free               | `all_operation_metadata()`, `generateVplTypescript()` |
| **C3** | `2`         | Live preview per node: the selected node's output renders on the map, so intermediate pipeline results are visible | embedded `serve`                                      |
| **C4** | `2`         | Parse and validation errors marked inline at the correct position                                                  | needs spans the parser does not carry yet             |
| **C5** | `2 stretch` | Recipe library: hillshade from DEM, overviews, land mask, choropleth join — working starting points                | `help.md` examples                                    |
| **C6** | `3`         | Sampling-based cost estimate: "~40 min, ~2.3 GB" before you commit                                                 | new                                                   |
| **C7** | `5`         | **Export as CLI command, serve config, Dockerfile or GitHub Action** — desktop to production                       | falls out of G1's project layout                      |
| **C8** | `2 stretch` | Watch mode: source file changes on disk → preview updates                                                          | new                                                   |

---

## Cluster D · Style Generator

| ID     | Stage       | Feature                                                                                              | Basis                                 |
| ------ | ----------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **D1** | `4`         | Preset styles with global recolouring — hue, saturation, brightness, contrast                        | `maplibre-versatiles-styler` (exists) |
| **D2** | `4`         | **Style against your own tiles** — derive a starting style from the layers actually in the container | new; needs A4                         |
| **D3** | `4`         | Layer tree with filter / zoom / paint editing, and an expression editor with live preview            | new                                   |
| **D4** | `someday`   | Font selection from installed families, and sprite sheet management                                  | G7, `@versatiles/style`               |
| **D5** | `4 stretch` | Derive a dark variant from a light style (and back)                                                  | `@versatiles/style`                   |
| **D6** | `4 stretch` | **Accessibility**: contrast checking and colour-blindness simulation                                 | new                                   |
| **D7** | `later`     | Legend generator, exportable alongside the map                                                       | new                                   |
| **D8** | `4`         | Export as `style.json`, as `@versatiles/style` code, or as a complete bundle                         | `@versatiles/style`                   |
| **D9** | `4 stretch` | **Generate SDF glyphs from your own fonts** — drop in a TTF/OTF, get a glyph set Studio can serve    | `versatiles-glyphs-rs`                |

---

## Cluster E · Create Data

| ID     | Stage       | Feature                                                                                                                               | Basis                                          |
| ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **E1** | `3`         | Import wizard for vector data: GeoJSON, NDJSON, shapefile → tiles, with a preview before the full build                               | `from_geo`                                     |
| **E2** | `3`         | Import wizard for tabular point data: CSV with lon/lat columns                                                                        | `from_csv`                                     |
| **E3** | `3`         | **GDAL raster path**: GeoTIFF, COG, PNG/JPEG/JP2. Vectors go via `from_geo`, no GDAL; GeoPackage is unsupported ([Q20](decisions.md)) | GDAL, statically bundled                       |
| **E4** | `3 stretch` | DEM workflow: GeoTIFF → terrarium encoding, hillshade, quantisation                                                                   | `dem_*` operations                             |
| ~~E5~~ | `dropped`   | ~~Planetiler orchestration~~ — Java 21+ plus ~1 GB of downloads ([Q7](decisions.md))                                                  | not pursued                                    |
| **E6** | `3 stretch` | Table join: existing tiles + CSV → choropleth                                                                                         | `versatiles-choro`, `vector_update_properties` |
| **E7** | `3`         | Job queue with progress, cancellation and a log — long runs are the normal case here                                                  | new                                            |

---

## Cluster F · Publish

| ID     | Stage     | Feature                                                                                  | Basis                                       |
| ------ | --------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| **F1** | `5`       | Local server at the press of a button, plus a LAN URL and QR code for testing on a phone | `versatiles serve`                          |
| **F2** | `3` · `5` | Export to any supported container, optionally cropped by a rectangle and a zoom range    | `convert --bbox/--min-zoom/--max-zoom`      |
| **F3** | `later`   | Upload to SFTP, S3/R2, Google Cloud, GitHub Pages                                        | SFTP exists; `node-versatiles-google-cloud` |
| **F4** | `next`    | Export a complete static site with `versatiles-frontend` bundled                         | `versatiles-frontend`                       |
| **F5** | `next`    | Copy-paste embed snippet (HTML + JS)                                                     | new                                         |
| **F6** | `later`   | Still-image export as PNG/SVG for print and editorial use                                | `versatiles-svg-renderer` (in the webview)  |
| **F7** | `later`   | Offline package: tiles + style + fonts in one folder for field work                      | `versatiles-frontend`                       |

**F2 lands twice.** Writing a container is required for M3, so the export itself is stage 3 (S3.6).
The crop rectangle is a Publish-mode gesture on the map, and Publish mode arrives at stage 5.

---

## Cluster G · Platform & Cross-cutting

| ID     | Stage     | Feature                                                                                                 | Basis                                                         |
| ------ | --------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **G1** | `5`       | **Project as a directory**: `project.yaml` beside real `.vpl` and `style.json` files, usable by the CLI | serve config conventions ([Q6](decisions.md))                 |
| **G2** | `1`       | **"Show me the command"**: every GUI action displays its CLI equivalent                                 | the command strip exists from the first shell                 |
| **G3** | `5`       | Cross-platform builds with signing. Release 1 is Linux + Homebrew cask; Windows and Apple ID deferred   | Tauri; **long lead times — plan early** ([Q10](decisions.md)) |
| **G4** | `5`       | Auto-update                                                                                             | Tauri updater                                                 |
| **G5** | `0`       | No telemetry, no account, no network requirement once the chosen assets are installed                   | design constraint ([Q9](decisions.md))                        |
| **G6** | `2` · `4` | Undo/redo across pipeline and style edits                                                               | new                                                           |
| **G7** | `4`       | **Asset manager**: download, pin, verify and remove font families and sprite sets, including local D9   | `versatiles-fonts`/`-style` releases, `serve -s`              |

**G6 lands twice** ([Q11](decisions.md)): the command stack ships in stage 2 with the node graph, and
stage 4 puts style edits on that same stack rather than building a second one. **G2 and G5 are
constraints rather than screens** — G2 is satisfied by the persistent command strip present from the
first shell, G5 by not building the thing that would violate it.

---

## By stage

The same information read the other way. Stretch items are marked `*`.

| Stage       | Features                                 |
| ----------- | ---------------------------------------- |
| **0**       | G5                                       |
| **1**       | A1, A2, A4\*, A5, A6, A7, A8, G2         |
| **2**       | C1, C2, C3, C4, C5\*, C8\*, G6           |
| **3**       | C6, E1, E2, E3, E4\*, E6\*, E7, F2       |
| **4**       | D1, D2, D3, D5\*, D6\*, D8, D9\*, G6, G7 |
| **5**       | C7, F1, F2, G1, G3, G4                   |
| **next**    | B1, B2, B3, F4, F5                       |
| **later**   | B4, B5, D7, F3, F6, F7                   |
| **someday** | B6, B7, B8, B9, D4                       |
| **dropped** | A3, E5                                   |

Stages 0 and 5 carry little that is user-visible on their own: stage 0 is the shell, embedded server,
IPC boundary, bundled assets and CI, and stage 5 is what makes the application reach anyone.

---

## Killer-feature candidates

If we get one thing genuinely right, it should probably be one of these:

1. **C1 + C3 — pipeline editing with live preview.** The most visually convincing feature, and the
   one that makes "Studio" the right word. Stage 2 ([Q11](decisions.md)).
2. **B2 — byte breakdown per layer and attribute.** Everyone who builds vector tiles has this
   problem; nobody solves it well. Cheaper than it looks, since the per-layer measurement already
   exists ([Q12](decisions.md)). Out of release 1, first in line after.
3. **E1 → F5 — file to published map in five minutes, without a terminal.** The broadest appeal, and
   by far the most work — it spans stage 3 and `next`.
