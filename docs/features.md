# Feature Catalogue

> Draft. This is the **idea pool**, not a commitment. See [Release 1 Scope](scope-release-1.md) for
> what is actually being built, and [Roadmap](roadmap.md) for the order.

Seven clusters, stable IDs so they can be referenced from other documents and from issues. Audience
IDs `P1`–`P5` refer to [Target Audiences](audiences.md). The **Basis** column records what already
exists to build on — the difference between a feature that takes a week and one that takes a
quarter. Details are in the [Ecosystem Inventory](ecosystem.md).

---

## Cluster A · Open & Explore

The foundation. Everything else renders into this surface.

| ID     | Feature                                                                                                                   | Audiences | Basis                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------- |
| **A1** | Open local containers by drag & drop or dialog: `.mbtiles`, `.pmtiles`, `.versatiles`, `.tar`, directories                | all       | `versatiles_container`              |
| **A2** | Open remote sources over HTTPS and SFTP, with byte ranges so a planet file opens instantly                                | P3        | `versatiles_container`              |
| ~~A3~~ | ~~Multi-source workspace: layer stack with opacity, swipe comparison and split view~~ — **dropped** ([Q17](decisions.md)) | P3        | not pursued                         |
| **A4** | **Raw MVT inspector**: layers → features → properties as a tree, with byte sizes and geometry preview                     | P3        | `versatiles_geometry`, `probe -ddd` |
| **A5** | Tile grid overlay showing z/x/y, with a jump-to-coordinate box                                                            | all       | new                                 |
| **A6** | View and **edit** container metadata and TileJSON                                                                         | P3        | `meta_update`                       |
| **A7** | Recent files, and named view bookmarks stored in the project                                                              | all       | new                                 |
| **A8** | Feature popup showing all attributes of the feature under the cursor                                                      | P1, P5    | MapLibre                            |

---

## Cluster B · Analyse & QA

**Where the strongest differentiation lies.** Mostly a visual front-end for analysis `versatiles
probe` already performs, which makes it unusually cheap relative to its value. Out of release 1
([Q2](decisions.md)), and cheaper than once assumed ([Q12](decisions.md)).

| ID     | Feature                                                                                                   | Audiences | Basis                                       |
| ------ | --------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------- |
| **B1** | Tile size heat map per zoom; p50/p95/max; top-N largest tiles, clickable                                  | P3        | `probe -dd`; index-only                     |
| **B2** | **Byte breakdown per layer and per attribute** — which layer, which property is eating your z14 tiles     | P3        | `tile_breakdown.rs` does the per-layer half |
| **B3** | Spec validation against MVT 2.1, versatiles-spec, TileJSON and the style schema, with a **repair button** | P3        | `probe -ddd` emits a `fix:` suggestion      |
| **B4** | Coverage map: which tiles exist versus what the bounding box claims — find holes                          | P3        | `probe -dd`; index-only                     |
| **B5** | **Container diff**: compare two versions visually and statistically — a regression test per rebuild       | P3        | new                                         |
| **B6** | Compression comparison (gzip/brotli/zstd) and raster format comparison, with visual difference            | P3        | `versatiles_image`, convert                 |
| **B7** | Attribute statistics: value distribution per property — the basis for filtering and styling decisions     | P1, P5    | `versatiles_geometry`                       |
| **B8** | Glyph and sprite check: missing glyphs for a language, style references to icons that do not exist        | P5        | `versatiles-glyphs-rs`                      |
| **B9** | Load-time estimate for a viewport at 3G/4G speeds                                                         | P1, P4    | derived from B1                             |

---

## Cluster C · Pipeline Editor (VPL)

| ID     | Feature                                                                                                  | Audiences | Basis                                                 |
| ------ | -------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------- |
| **C1** | **Bidirectional node graph ⟷ VPL text.** The text stays the source of truth; the graph is a view onto it | P3, P2    | parses, but **no serialiser** ([Q11](decisions.md))   |
| **C2** | **Parameter forms generated from `field_meta`** — no hand-written UI, new operations appear for free     | all       | `all_operation_metadata()`, `generateVplTypescript()` |
| **C3** | Live preview per node: renders the intermediate state on the map; before/after as a swipe                | all       | embedded `serve`                                      |
| **C4** | Parse and validation errors marked inline at the correct position                                        | P3        | needs spans the parser does not carry yet             |
| **C5** | Recipe library: hillshade from DEM, overviews, land mask, choropleth join — working starting points      | P1, P2    | `help.md` examples                                    |
| **C6** | Sampling-based cost estimate: "~40 min, ~2.3 GB" before you commit                                       | P2, P3    | new                                                   |
| **C7** | **Export as CLI command, serve config, Dockerfile or GitHub Action** — desktop to production             | P2, P3    | project layout does most of the work                  |
| **C8** | Watch mode: source file changes on disk → preview updates                                                | P3        | new                                                   |

---

## Cluster D · Style Generator

| ID     | Feature                                                                                              | Audiences  | Basis                                 |
| ------ | ---------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------- |
| **D1** | Preset styles with global recolouring — hue, saturation, brightness, contrast                        | all        | `maplibre-versatiles-styler` (exists) |
| **D2** | **Style against your own tiles** — derive a starting style from the layers actually in the container | P1, P4     | new; needs A4                         |
| **D3** | Layer tree with filter / zoom / paint editing, and an expression editor with live preview            | P5         | new                                   |
| **D4** | Font selection from installed families, and sprite sheet management                                  | P5         | G7, `@versatiles/style`               |
| **D5** | Derive a dark variant from a light style (and back)                                                  | P4, P5     | `@versatiles/style`                   |
| **D6** | **Accessibility**: contrast checking and colour-blindness simulation                                 | P1, P5     | new                                   |
| **D7** | Legend generator, exportable alongside the map                                                       | P1         | new                                   |
| **D8** | Export as `style.json`, as `@versatiles/style` code, or as a complete bundle                         | all        | `@versatiles/style`                   |
| **D9** | **Generate SDF glyphs from your own fonts** — drop in a TTF/OTF, get a glyph set Studio can serve    | P1, P2, P5 | `versatiles-glyphs-rs`                |

---

## Cluster E · Create Data

| ID     | Feature                                                                                                 | Audiences | Basis                                          |
| ------ | ------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------- |
| **E1** | Import wizard for vector data: GeoJSON, NDJSON, shapefile → tiles, with a preview before the full build | P1, P2    | `from_geo`                                     |
| **E2** | Import wizard for tabular point data: CSV with lon/lat columns                                          | P1        | `from_csv`                                     |
| **E3** | GDAL path for GeoPackage, GeoTIFF and the rest                                                          | P2        | GDAL feature in versatiles-rs                  |
| **E4** | DEM workflow: GeoTIFF → terrarium encoding, hillshade, quantisation                                     | P2        | `dem_*` operations                             |
| ~~E5~~ | ~~Planetiler orchestration~~ — **dropped**: Java 21+ plus ~1 GB of downloads ([Q7](decisions.md))       | P2        | not pursued                                    |
| **E6** | Table join: existing tiles + CSV → choropleth                                                           | P1        | `versatiles-choro`, `vector_update_properties` |
| **E7** | Job queue with progress, cancellation and a log — long runs are the normal case here                    | P2, P3    | new                                            |

---

## Cluster F · Publish

| ID     | Feature                                                                                  | Audiences | Basis                                       |
| ------ | ---------------------------------------------------------------------------------------- | --------- | ------------------------------------------- |
| **F1** | Local server at the press of a button, plus a LAN URL and QR code for testing on a phone | all       | `versatiles serve`                          |
| **F2** | Export to any supported container, optionally cropped by a rectangle and a zoom range    | all       | `convert --bbox/--min-zoom/--max-zoom`      |
| **F3** | Upload to SFTP, S3/R2, Google Cloud, GitHub Pages                                        | P2, P4    | SFTP exists; `node-versatiles-google-cloud` |
| **F4** | Export a complete static site with `versatiles-frontend` bundled                         | P4        | `versatiles-frontend`                       |
| **F5** | Copy-paste embed snippet (HTML + JS)                                                     | P1, P4    | new                                         |
| **F6** | Still-image export as PNG/SVG for print and editorial use                                | P1        | `versatiles-svg-renderer` (in the webview)  |
| **F7** | Offline package: tiles + style + fonts in one folder for field work                      | P2        | `versatiles-frontend`                       |

---

## Cluster G · Platform & Cross-cutting

| ID     | Feature                                                                                                 | Audiences | Basis                                                         |
| ------ | ------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------- |
| **G1** | **Project as a directory**: `project.yaml` beside real `.vpl` and `style.json` files, usable by the CLI | all       | serve config conventions ([Q6](decisions.md))                 |
| **G2** | **"Show me the command"**: every GUI action displays its CLI equivalent                                 | P2, P3    | new                                                           |
| **G3** | Cross-platform builds with signing. Release 1 is Linux + Homebrew cask; Windows and Apple ID deferred   | all       | Tauri; **long lead times — plan early** ([Q10](decisions.md)) |
| **G4** | Auto-update                                                                                             | all       | Tauri updater                                                 |
| **G5** | No telemetry, no account, no network requirement once the chosen assets are installed                   | P2        | design constraint ([Q9](decisions.md))                        |
| **G6** | Undo/redo across pipeline and style edits. **In release 1** — stack in stage 2, style edits in stage 4  | all       | new                                                           |
| **G7** | **Asset manager**: download, pin, verify and remove font families and sprite sets, including local D9   | all       | `versatiles-fonts`/`-style` releases, `serve -s`              |

---

## Killer-feature candidates

If we get one thing genuinely right, it should probably be one of these:

1. **C1 + C3 — pipeline editing with live preview.** The most visually convincing feature, and the
   one that makes "Studio" the right word. **In release 1** ([Q11](decisions.md)).
2. **B2 — byte breakdown per layer and attribute.** Everyone who builds vector tiles has this
   problem; nobody solves it well. Cheaper than it looks, since the per-layer measurement already
   exists ([Q12](decisions.md)). Out of release 1, first in line after.
3. **E1 → F5 — file to published map in five minutes, without a terminal.** The broadest appeal, and
   by far the most work.
