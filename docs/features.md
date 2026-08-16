# Feature Catalogue

> Draft. This is the **idea pool**, not a commitment. Nothing here is scheduled; see
> [Roadmap](roadmap.md) for what we would actually build first.

Features are grouped into seven clusters and given stable IDs so they can be referenced from other
documents and from issues. Audience IDs (`P1`–`P5`) refer to [Target Audiences](audiences.md).

The **Basis** column records what already exists to build on — see
[Ecosystem Inventory](ecosystem.md) for details. This is the difference between a feature that
takes a week and one that takes a quarter.

---

## Cluster A · Open & Explore

The foundation. Everything else renders into this surface.

| ID     | Feature                                                                                                                             | Audiences | Basis                               |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------- |
| **A1** | Open local containers by drag & drop or file dialog: `.mbtiles`, `.pmtiles`, `.versatiles`, `.tar`, directories                     | all       | `versatiles_container`              |
| **A2** | Open remote sources over HTTPS and SFTP by URL, with byte-range fetching so a planet file opens instantly                           | P3        | `versatiles_container`              |
| **A3** | Multi-source workspace: several containers as a layer stack, with opacity, swipe comparison and split view                          | P3        | new                                 |
| **A4** | **Raw MVT inspector**: click a tile, get layers → features → properties as a tree, with byte sizes per layer and a geometry preview | P3        | `versatiles_geometry`, `probe -ddd` |
| **A5** | Tile grid overlay showing z/x/y, with a jump-to-coordinate box                                                                      | all       | new                                 |
| **A6** | View and **edit** container metadata and TileJSON                                                                                   | P3        | `meta_update` operation             |
| **A7** | Recent files, and named view bookmarks stored in the project                                                                        | all       | new                                 |
| **A8** | Feature popup on hover/click showing all attributes of the feature under the cursor                                                 | P1, P5    | MapLibre                            |

---

## Cluster B · Analyse & QA

**This is where the strongest differentiation lies.** Most of it is a visual front-end for
analysis `versatiles probe` already performs, which makes it unusually cheap to build relative to
its value. Nothing on the market does B2 well.

| ID     | Feature                                                                                                                                                                           | Audiences | Basis                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| **B1** | Tile size heat map overlaid on the map per zoom level; p50/p95/max statistics; top-N largest tiles, clickable to navigate there                                                   | P3        | `probe -dd`; index-only via `tile_size_stream`                                                      |
| **B2** | **Byte breakdown per layer and per attribute** — "which layer, which property is eating your z14 tiles". The single most requested thing that no tool does well today             | P3        | **`tile_breakdown.rs` already does the per-layer half**; per-attribute is new ([Q12](decisions.md)) |
| **B3** | Spec validation against MVT 2.1, versatiles-spec, TileJSON schema and the MapLibre style schema — with a **"repair" button** that generates and runs the `vector_repair` pipeline | P3        | `probe -ddd` already emits a `fix:` suggestion                                                      |
| **B4** | Coverage map: which tiles actually exist versus what the bounding box claims — find holes                                                                                         | P3        | `probe -dd`; index-only via `tile_size_stream`                                                      |
| **B5** | **Container diff**: compare two versions visually and statistically. A regression test for every rebuild                                                                          | P3        | new                                                                                                 |
| **B6** | Compression comparison (gzip / brotli / zstd) and raster format comparison (png / webp / avif) with size and side-by-side visual difference                                       | P3        | `versatiles_image`, convert                                                                         |
| **B7** | Attribute statistics: value distribution per property — the basis for filtering and styling decisions                                                                             | P1, P5    | `versatiles_geometry`                                                                               |
| **B8** | Glyph and sprite check: are glyphs missing for a given language? does the style reference an icon that does not exist?                                                            | P5        | `versatiles-glyphs-rs`                                                                              |
| **B9** | Load-time estimate for a viewport at 3G/4G speeds                                                                                                                                 | P1, P4    | derived from B1                                                                                     |

---

## Cluster C · Pipeline Editor (VPL)

| ID     | Feature                                                                                                                                                                                                                             | Audiences | Basis                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| **C1** | **Bidirectional node graph ⟷ VPL text.** The text stays the source of truth (diffable, git-friendly); the graph is a view onto it                                                                                                   | P3, P2    | `versatiles_pipeline` parses VPL; **no serialiser exists** — needs a lossless syntax tree ([Q11](decisions.md))  |
| **C2** | **Parameter forms generated automatically from `field_meta`** — no hand-written UI per operation, and new operations appear in Studio for free                                                                                      | all       | `all_operation_metadata()`; the same transformation already ships as `generateVplTypescript()`                   |
| **C3** | Live preview per node: "look here" renders the intermediate state on the map; before/after as a swipe                                                                                                                               | all       | embedded `serve`                                                                                                 |
| **C4** | Parse and validation errors marked inline in the text at the correct position                                                                                                                                                       | P3        | **corrected:** the parser reports errors as rendered strings, with no structured positions ([Q11](decisions.md)) |
| **C5** | Recipe library: hillshade from DEM, merge OSM with a custom overlay, generate overviews, land mask, choropleth join — each a working starting point                                                                                 | P1, P2    | `help.md` examples                                                                                               |
| **C6** | Sampling-based cost estimate: "this export will take ~40 min and produce ~2.3 GB" before you commit to it                                                                                                                           | P2, P3    | new                                                                                                              |
| **C7** | **Export as CLI command, `versatiles serve` config, Dockerfile or GitHub Action snippet** — the bridge from desktop to production. The `.vpl` itself needs no exporting: under [Q6](decisions.md) it is already a real file on disk | P2, P3    | project layout does most of the work                                                                             |
| **C8** | Watch mode: source file changes on disk → preview updates                                                                                                                                                                           | P3        | new                                                                                                              |

---

## Cluster D · Style Generator

| ID     | Feature                                                                                                                                                    | Audiences  | Basis                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------- |
| **D1** | Preset styles (colorful, eclipse, graybeard, shadow, neutrino, satellite) with global recolouring — hue, saturation, brightness, contrast                  | all        | `maplibre-versatiles-styler` (exists) |
| **D2** | **Style against your own tiles**, not just Shortbread: derive a starting style from the vector layers actually present in the container                    | P1, P4     | new; needs A4                         |
| **D3** | Layer tree with filter / zoom / paint editing, and an expression editor with live preview                                                                  | P5         | new                                   |
| **D4** | Font selection from installed families, and sprite sheet management                                                                                        | P5         | G7, `@versatiles/style`               |
| **D5** | Derive a dark variant from a light style (and back)                                                                                                        | P4, P5     | `@versatiles/style`                   |
| **D6** | **Accessibility**: contrast checking and colour-blindness simulation (deuteranopia, protanopia, tritanopia)                                                | P1, P5     | new                                   |
| **D7** | Legend generator, exportable alongside the map                                                                                                             | P1         | new                                   |
| **D8** | Export as `style.json`, as `@versatiles/style` code, or as a complete bundle                                                                               | all        | `@versatiles/style`                   |
| **D9** | **Generate SDF glyphs from your own fonts**: drop in a TTF/OTF, get a glyph set Studio can serve, style with and ship — including fonts no release carries | P1, P2, P5 | `versatiles-glyphs-rs`                |

---

## Cluster E · Create Data

| ID     | Feature                                                                                                                                                              | Audiences | Basis                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------- |
| **E1** | Import wizard for vector data: GeoJSON, NDJSON, shapefile → tiles. Map columns, choose layer name, zoom range, simplification — with a preview before the full build | P1, P2    | `from_geo`                                     |
| **E2** | Import wizard for tabular point data: CSV with lon/lat columns                                                                                                       | P1        | `from_csv`                                     |
| **E3** | GDAL path for GeoPackage, GeoTIFF and the rest                                                                                                                       | P2        | GDAL feature in versatiles-rs                  |
| **E4** | DEM workflow: GeoTIFF → terrarium encoding, hillshade, quantisation                                                                                                  | P2        | `dem_*` operations                             |
| ~~E5~~ | ~~**Planetiler orchestration**: OSM PBF in, Shortbread tiles out~~ — **dropped**, needs Java 21+ plus ~1 GB of auxiliary downloads ([Q7](decisions.md))              | P2        | not pursued                                    |
| **E6** | Table join: existing tiles + CSV → choropleth, attaching attributes to geometries                                                                                    | P1        | `versatiles-choro`, `vector_update_properties` |
| **E7** | Job queue with progress, cancellation and a log. Long runs are the normal case here, not the exception                                                               | P2, P3    | new                                            |

---

## Cluster F · Publish

| ID     | Feature                                                                                                   | Audiences | Basis                                           |
| ------ | --------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------- |
| **F1** | Local server at the press of a button, plus a LAN URL and QR code for testing on a phone                  | all       | `versatiles serve`                              |
| **F2** | Export to any supported container, optionally cropped — draw a rectangle on the map and pick a zoom range | all       | `convert --bbox/--min-zoom/--max-zoom`          |
| **F3** | Upload to SFTP, S3/R2, Google Cloud, GitHub Pages                                                         | P2, P4    | SFTP exists; `node-versatiles-google-cloud`     |
| **F4** | Export a complete static site with `versatiles-frontend` bundled                                          | P4        | `versatiles-frontend`                           |
| **F5** | Copy-paste embed snippet (HTML + JS)                                                                      | P1, P4    | new                                             |
| **F6** | Still-image export as PNG/SVG for print and editorial use                                                 | P1        | `versatiles-svg-renderer` (runs in the webview) |
| **F7** | Offline package: tiles + style + fonts in one folder for field work                                       | P2        | `versatiles-frontend`                           |

---

## Cluster G · Platform & Cross-cutting

| ID     | Feature                                                                                                                                                                                                                                                                  | Audiences | Basis                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ----------------------------------------------------------- |
| **G1** | **Project as a directory**: a `project.yaml` manifest beside real `.vpl` and `style.json` files — versionable, reviewable, and usable by the CLI without Studio ([Q6](decisions.md))                                                                                     | all       | `versatiles serve` config conventions                       |
| **G2** | **"Show me the command"**: every GUI action displays its CLI equivalent. Teaches the tool and makes work automatable                                                                                                                                                     | P2, P3    | new                                                         |
| **G3** | Cross-platform builds for Windows, macOS and Linux, with code signing and notarisation. Linux needs no signing; macOS needs a paid Apple account and notarisation, which Homebrew does not substitute for; Windows needs a certificate decision. See [Q10](decisions.md) | all       | Tauri; **costs money and has long lead times — plan early** |
| **G4** | Auto-update                                                                                                                                                                                                                                                              | all       | Tauri updater                                               |
| **G5** | No telemetry, no account, and no network requirement once the chosen assets are installed — as an explicit, documented property                                                                                                                                          | P2        | design constraint; see [Q9](decisions.md)                   |
| **G6** | Undo/redo across pipeline and style edits. **In release 1** — the command stack lands in stage 2 with the node graph, and style editing joins it in stage 4                                                                                                              | all       | new                                                         |
| **G7** | **Asset manager**: download, pin, verify and remove font families and sprite sets — including glyph sets generated locally (D9); show what is installed and what a style still needs                                                                                     | all       | `versatiles-fonts`, `versatiles-style` releases, `serve -s` |

---

## Killer-feature candidates

If we get one thing genuinely right, it should probably be one of these:

1. **C1 + C3 — pipeline editing with live preview.** The most visually convincing feature, and the
   one that makes "Studio" the right word for what this is. **In release 1** per
   [Q11](decisions.md).
2. **B2 — byte breakdown per layer and attribute.** Everyone who builds vector tiles has this
   problem; nobody solves it well. High recognition, and cheaper than it looks — the per-layer
   measurement already exists upstream ([Q12](decisions.md)). Out of release 1, first in line after.
3. **E1 → F5 — file to published map in five minutes, without a terminal.** The broadest appeal,
   and by far the most work.
