# Ecosystem Inventory

> Snapshot taken 2026-08-16. Verify before relying on any single detail.

Studio is unusual among new projects in that most of its engine already exists. This document
records what is available, so that feature planning can distinguish "wire up something that works"
from "build something new".

## versatiles-rs — the engine

A Rust workspace. Studio would depend on these crates directly rather than shelling out to the
binary.

| Crate                  | What it gives us                                                                                                                                                              |
|------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `versatiles_container` | Read and write `.versatiles`, `.pmtiles`, `.mbtiles`, `.tar` and directories. Remote read over HTTP(S) and SFTP with byte ranges; SFTP write. This is cluster A's foundation. |
| `versatiles_pipeline`  | The VersaTiles Pipeline Language (VPL) and roughly 30 operations. This is cluster C and most of cluster E.                                                                    |
| `versatiles_core`      | Shared types: tile coordinates, bounding boxes, TileJSON, compression.                                                                                                        |
| `versatiles_geometry`  | Vector geometry and MVT encoding/decoding. The basis for the raw inspector (A4) and the byte breakdown (B2).                                                                  |
| `versatiles_image`     | Raster encoding: png, jpg, webp, avif. Basis for the format comparison (B6).                                                                                                  |
| `versatiles_derive`    | Derive macros, including the ones behind operation metadata.                                                                                                                  |
| `versatiles_node`      | napi bindings — precedent for how the crates get exposed to a JS layer.                                                                                                       |

### Pipeline operations available today

```
read       from_container, from_tilejson, from_tile, from_color, from_geo, from_csv,
           from_merged_vector, from_stacked, from_stacked_raster, from_debug
general    filter, meta_update
vector     vector_repair, vector_overzoom, vector_filter_layers, vector_filter_features,
           vector_filter_properties, vector_update_properties
raster     raster_overview, raster_flatten, raster_levels, raster_tile_resize,
           raster_format, raster_overscale, raster_mask
dem        dem_overview, dem_tile_resize, dem_quantize
```

### Two findings that shape the architecture

**1. `versatiles_pipeline/src/vpl/field_meta.rs` carries parameter metadata per operation.**
This means the pipeline editor's parameter forms (C2) can be *generated* rather than hand-written.
Every new operation added to versatiles-rs then appears in Studio with a working UI at no cost.
This is the difference between a pipeline editor that rots and one that stays current, and it
should be treated as a load-bearing architectural assumption — worth verifying in depth before
committing to it.

**2. `versatiles probe` is already an analysis engine.**

| Depth  | What it scans                                                                                                                                       | Feeds  |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------|--------|
| `-d`   | Container metadata                                                                                                                                  | A6     |
| `-dd`  | All tile sizes                                                                                                                                      | B1, B4 |
| `-ddd` | Tile contents; validates MVT 2.1 conformance, reports missing `extent`/`version`, duplicate layer names, polygon winding problems, degenerate rings | B3     |

`probe -ddd` even emits a `fix:` line suggesting the correct `vector_repair` invocation. Turning
that into a button (B3) is close to free, and it is a genuinely delightful feature.

## Frontend pieces

| Repository                                                                                                  | What it gives us                                                                                                                                                                                                                                                  |
|-------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [`versatiles-style`](https://github.com/versatiles-org/versatiles-style) (`@versatiles/style`)              | Style and sprite generation; presets colorful, eclipse, graybeard, shadow, neutrino, satellite. The core of cluster D.                                                                                                                                            |
| [`maplibre-versatiles-styler`](https://github.com/versatiles-org/maplibre-versatiles-styler)                | **A working style editor already exists** as a MapLibre control: editable palettes, global recolouring, font and language selection, satellite adjustments, export to `style.json` or `@versatiles/style` code. D1 and D8 are largely a matter of embedding this. |
| [`node-versatiles-svelte`](https://github.com/versatiles-org/node-versatiles-svelte) (`@versatiles/svelte`) | Svelte component library including `BasicMap` with a bundled MapLibre worker.                                                                                                                                                                                     |
| [`versatiles-map-editor`](https://github.com/versatiles-org/versatiles-map-editor)                          | SvelteKit drawing and styling app, extracted from the above. Precedent for app structure — and the reason Studio should *not* do feature editing itself.                                                                                                          |
| [`versatiles-frontend`](https://github.com/versatiles-org/versatiles-frontend)                              | Pre-packaged web assets — fonts, sprites, MapLibre — in several size tiers. The route to offline operation (G5) and static site export (F4, F7).                                                                                                                  |

## Supporting tools

| Repository                                                                                                                                     | Relevance                                                                                                                                                                 |
|------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [`versatiles-glyphs-rs`](https://github.com/versatiles-org/versatiles-glyphs-rs)                                                               | SDF glyph generation from TrueType fonts, in Rust, no C++ dependencies. Enables font embedding (D4) and the glyph coverage check (B8) inside the Tauri binary.            |
| [`versatiles-svg-renderer`](https://github.com/versatiles-org/versatiles-svg-renderer)                                                         | Renders vector maps as SVG. The path to print-quality still export (F6). Runs in the browser as well as in Node — it ships a UMD bundle and a `/maplibre` control subpath. |
| [`versatiles-choro`](https://github.com/versatiles-org/versatiles-choro)                                                                       | Choropleth workflow aimed at newsrooms and data journalists — the same audience as P1, and directly relevant to E6. Under heavy development; API and formats will change. |
| [`versatiles-spec`](https://github.com/versatiles-org/versatiles-spec)                                                                         | Container specification, currently v02. The reference for validation (B3).                                                                                                |
| [`planetiler`](https://github.com/versatiles-org/planetiler), [`shortbread-tilemaker`](https://github.com/versatiles-org/shortbread-tilemaker) | OSM → vector tiles. Candidates for orchestration (E5) rather than reimplementation.                                                                                       |
| [`node-versatiles-google-cloud`](https://github.com/versatiles-org/node-versatiles-google-cloud)                                               | Precedent for cloud upload (F3).                                                                                                                                          |
| [`versatiles-documentation`](https://github.com/versatiles-org/versatiles-documentation)                                                       | Learning resources, and a showcase gallery of 76 known projects using VersaTiles — a ready-made list of potential Studio users to talk to.                                |

## Map assets: fonts and sprites

MapLibre needs SDF glyphs and sprite sheets that neither versatiles-rs nor the style library can
conjure at render time. Numbers as of `versatiles-frontend` v3.14.0, `versatiles-fonts` v2.2.0 and
`versatiles-style` v5.13.1:

**`frontend-blank`** — "blank frontend with only fonts and sprites", i.e. exactly the two asset
kinds Studio needs and none of the JS libraries it will bundle itself:

| Asset | Download | Unpacked |
|---|---|---|
| `frontend-blank.tar.gz` | 109 MB | ~190 MB |
| `frontend-blank.br.tar.gz` | 85 MB | ~190 MB |

It contains **47,360 glyph files** plus sprites. Two facts change how we should handle that:

**Fonts are published per family**, so `frontend-blank` is not the only granularity available:

| Family | Size | | Family | Size |
|---|---|---|---|---|
| `fonts.tar.gz` (everything) | 107 MB | | `lato` | 5 MB |
| `noto_sans` | 45 MB | | `nunito` | 4 MB |
| `fira_sans` | 8 MB | | `roboto` | 3 MB |
| `source_sans_3` | 6 MB | | `open_sans` | 3 MB |
| `merriweather_sans` | 2 MB | | `pt_sans`, `libre_baskerville` | <1 MB |

Sprites are a separate 1.3 MB download from `versatiles-style` releases (`sprites.tar.gz`).

**The embedded server serves static content straight out of an archive** — no unpacking:

```sh
versatiles serve -s "[/assets]static.tar.br" tiles.versatiles
```

Supported: `.tar`, `.tar.gz`, `.tar.br`, and directories. This matters more than it looks: 47,360
tiny files on disk is slow to extract, painful on Windows (per-file NTFS overhead, Defender
scanning each one), and awkward to verify or delete. One archive file is atomic, checksummable and
removable in one step.

**The Latin-only trick.** `frontend-tiny` keeps glyphs below codepoint 1024 and replaces higher
ranges with *valid but empty* glyph tiles, so clients get HTTP 200 rather than 404. The whole
bundle is 1 MB. This is the mechanism that lets a small default ship inside the binary — with the
caveat that B8 must then distinguish "genuinely empty glyph" from "font not downloaded yet".

See [Q9](decisions.md) for the resulting proposal.

## What genuinely does not exist yet

Worth naming explicitly, because this is the actual construction work:

- The application shell and window/panel layout
- Multi-source layer stack with comparison modes (A3)
- Visual analysis surfaces: heat map, breakdown charts, diff view (B1, B2, B5)
- The node graph and its synchronisation with VPL text (C1)
- Deep style editing beyond what the styler control does (D2, D3, D6, D7)
- Import wizards with preview (E1–E3)
- Job queue and progress model (E7)
- The project file format (G1)
- Build, signing and update infrastructure (G3, G4)

## The state of this repository

The previous contents were a Tauri 1 + Svelte 4 + Vite template from January 2024 — a menu and a
basic layout, no substantive code. It has been removed; the history remains in git. The repository
name, the GitHub project and `app-icon.png` were kept.
