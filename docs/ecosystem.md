# Ecosystem Inventory

> Snapshot taken 2026-08-16. Verify before relying on any single detail.

Most of Studio's engine already exists. This document records what is available, so feature planning
can tell "wire up something that works" from "build something new". It is the evidence base the
[decision log](decisions.md) refers back to.

## versatiles-rs — the engine

A Rust workspace, consumed as a library dependency rather than shelled out to.

| Crate                  | What it gives us                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `versatiles_container` | Read/write `.versatiles`, `.pmtiles`, `.mbtiles`, `.tar`, directories. Remote read over HTTP(S) and SFTP with byte ranges. Cluster A's foundation |
| `versatiles_pipeline`  | VPL and ~30 operations. Cluster C and most of E                                                                                                   |
| `versatiles_core`      | Shared types: tile coordinates, bounding boxes, TileJSON, compression                                                                             |
| `versatiles_geometry`  | Vector geometry and MVT encoding/decoding. Basis for A4 and B2                                                                                    |
| `versatiles_image`     | Raster encoding: png, jpg, webp, avif. Basis for B6                                                                                               |
| `versatiles_derive`    | Derive macros, including the ones behind operation metadata                                                                                       |
| `versatiles_node`      | napi bindings — precedent for exposing the crates to a JS layer                                                                                   |

### Pipeline operations available today

```text
read       from_container, from_tilejson, from_tile, from_color, from_geo, from_csv,
           from_merged_vector, from_stacked, from_stacked_raster, from_debug
general    filter, meta_update
vector     vector_repair, vector_overzoom, vector_filter_layers, vector_filter_features,
           vector_filter_properties, vector_update_properties
raster     raster_overview, raster_flatten, raster_levels, raster_tile_resize,
           raster_format, raster_overscale, raster_mask
dem        dem_overview, dem_tile_resize, dem_quantize
```

## Three findings that shape the architecture

### 1. Generated parameter forms (C2) are proven

`versatiles_pipeline` exposes `all_operation_metadata() -> Vec<OperationMeta>`, carrying everything
a form generator needs:

```rust
struct OperationMeta { tag_name, kind /* "read" | "transform" */, doc, fields }
struct VPLFieldMeta  { name, rust_type, is_required, is_sources, doc, enum_variants }
```

Better still, the transformation already ships: `versatiles_node/src/codegen.rs` turns this into
TypeScript via `generateVplTypescript()`, mapping enum fields to string-literal unions.

Two practical details: `all_operation_metadata()` sits behind `#[cfg(feature = "codegen")]`, so
Studio must enable it; and the metadata carries `is_required` but **no default values**, so
generated forms show empty optional fields unless `VPLFieldMeta` is extended upstream.

### 2. `versatiles probe` is already an analysis engine

| Depth  | What it scans                                                                                                                           | Feeds  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `-d`   | Container metadata                                                                                                                      | A6     |
| `-dd`  | All tile sizes                                                                                                                          | B1, B4 |
| `-ddd` | Tile contents; validates MVT 2.1, reports missing `extent`/`version`, duplicate layer names, polygon winding problems, degenerate rings | B3     |

`probe -ddd` emits a `fix:` line suggesting the right `vector_repair` invocation, so B3 is close to
free. Three further details drive [Q4](decisions.md) and [Q12](decisions.md):

- **The byte breakdown (B2) already exists.** `versatiles/src/tools/tile_breakdown.rs` splits each
  layer into geometry, tag references, property keys, property values, feature ids and a framing
  residual; `probe -ddd` aggregates it by zoom × layer. Only the **per-attribute** split is missing.
- **Sampling is built in.** `probe --sample PERCENT` reads a deterministic subset as contiguous
  64×64 windows, sized so remote sources coalesce them into single range requests
  (`tile_sampling.rs`). Scanning tile _sizes_ is cheaper still — all five readers override
  `tile_size_stream`, so no tile bodies are read.
- **Compute and rendering are entangled.** Every probe function takes `&mut PrettyPrint` and returns
  `Result<()>`, so results are text, not data. Studio aggregates over `layer_stats()` and
  `validate_tile()` instead, which do return values.

### 3. The VPL parser only runs one way

The constraint that shapes cluster C, and mis-stated in earlier drafts. Text → structure is solved;
structure → text does not exist:

| Needed for                       | Status                                                                     |
| -------------------------------- | -------------------------------------------------------------------------- |
| Parse VPL (C1, C4 input)         | ✅ `FromStr` on `VPLPipeline`, `VPLNode::try_from_str`                     |
| Write VPL back out (C1 output)   | ❌ no `Display`, no `to_string`, no serialiser — only `Debug`              |
| Preserve parameter order         | ❌ `properties` is a `BTreeMap`, so a round-trip sorts them alphabetically |
| Preserve `#` comments            | ❌ the parser matches and discards them                                    |
| Error positions for editor marks | ❌ errors are rendered strings via nom's `convert_error`; no spans         |

Since [Q11](decisions.md) puts the node graph in release 1, a **lossless syntax tree** is the first
thing stage 2 has to build — ideally upstream.

## Frontend pieces

| Repository                                                                                   | What it gives us                                                                                                                                         |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`versatiles-style`](https://github.com/versatiles-org/versatiles-style)                     | Style and sprite generation; presets colorful, eclipse, graybeard, shadow, neutrino, satellite. The core of cluster D                                    |
| [`maplibre-versatiles-styler`](https://github.com/versatiles-org/maplibre-versatiles-styler) | **A working style editor already exists** as a MapLibre control: palettes, global recolouring, font and language selection, export. D1 and D8 embed this |
| [`node-versatiles-svelte`](https://github.com/versatiles-org/node-versatiles-svelte)         | Svelte components including `BasicMap` with a bundled MapLibre worker                                                                                    |
| [`versatiles-map-editor`](https://github.com/versatiles-org/versatiles-map-editor)           | SvelteKit drawing and styling app. Precedent for app structure — and the reason Studio should _not_ do feature editing                                   |
| [`versatiles-frontend`](https://github.com/versatiles-org/versatiles-frontend)               | Pre-packaged web assets in several size tiers. The route to offline operation (G5) and static site export (F4, F7)                                       |

## Supporting tools

| Repository                                                                                                                                     | Relevance                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`versatiles-glyphs-rs`](https://github.com/versatiles-org/versatiles-glyphs-rs)                                                               | SDF glyph generation from TrueType, in Rust with no C++ deps — so D9 and B8 run inside the Tauri binary. Also builds the `versatiles-fonts` releases, so generated and downloaded glyph sets share a format |
| [`versatiles-svg-renderer`](https://github.com/versatiles-org/versatiles-svg-renderer)                                                         | Vector maps as SVG — the path to print-quality export (F6). Ships a UMD bundle and a `/maplibre` subpath, so it runs in the browser                                                                         |
| [`versatiles-choro`](https://github.com/versatiles-org/versatiles-choro)                                                                       | Choropleth workflow for newsrooms — same audience as P1, directly relevant to E6. Under heavy development; API will change                                                                                  |
| [`versatiles-spec`](https://github.com/versatiles-org/versatiles-spec)                                                                         | Container specification, currently v02. The reference for B3                                                                                                                                                |
| [`planetiler`](https://github.com/versatiles-org/planetiler), [`shortbread-tilemaker`](https://github.com/versatiles-org/shortbread-tilemaker) | OSM → vector tiles. **Not orchestrated by Studio** — planetiler needs Java 21+ and ~1 GB of auxiliary downloads, tilemaker is a separate C++ binary ([Q7](decisions.md))                                    |
| [`node-versatiles-google-cloud`](https://github.com/versatiles-org/node-versatiles-google-cloud)                                               | Precedent for cloud upload (F3)                                                                                                                                                                             |
| [`versatiles-documentation`](https://github.com/versatiles-org/versatiles-documentation)                                                       | Learning resources, and a gallery of 76 known projects — a ready-made list of users to talk to                                                                                                              |

## Map assets: fonts and sprites

MapLibre needs SDF glyphs and sprite sheets that neither versatiles-rs nor the style library can
conjure at render time. Numbers as of `versatiles-frontend` v3.14.0, `versatiles-fonts` v2.2.0 and
`versatiles-style` v5.13.1. See [Q9](decisions.md) for what we do with them.

`frontend-blank` carries exactly the two asset kinds Studio needs — 109 MB compressed (85 MB
brotli), ~190 MB unpacked, **47,360 glyph files** plus sprites. Three facts make that the wrong
granularity:

**Fonts are published per family:**

| Family                      | Size   |     | Family                         | Size  |
| --------------------------- | ------ | --- | ------------------------------ | ----- |
| `fonts.tar.gz` (everything) | 107 MB |     | `lato`                         | 5 MB  |
| `noto_sans`                 | 45 MB  |     | `nunito`                       | 4 MB  |
| `fira_sans`                 | 8 MB   |     | `roboto`                       | 3 MB  |
| `source_sans_3`             | 6 MB   |     | `open_sans`                    | 3 MB  |
| `merriweather_sans`         | 2 MB   |     | `pt_sans`, `libre_baskerville` | <1 MB |

Sprites are a separate 1.3 MB download from `versatiles-style` releases.

**Archives are served directly, never unpacked** — `versatiles serve -s "[/assets]static.tar.br"`
reads `.tar`, `.tar.gz`, `.tar.br` and directories. 47,360 tiny files are slow to extract, painful
on Windows (per-file NTFS overhead, Defender scanning each one) and awkward to verify or delete; one
archive is atomic and checksummable.

**The Latin-only trick** — `frontend-tiny` keeps glyphs below codepoint 1024 and replaces higher
ranges with _valid but empty_ glyph tiles, so clients get HTTP 200 rather than 404. The whole bundle
is 1 MB, which is what lets a small default ship inside the binary. B8 must then distinguish
"genuinely empty glyph" from "font not downloaded yet".

## What genuinely does not exist yet

The actual construction work:

- The application shell and window/panel layout
- Multi-source layer stack with comparison modes (A3)
- A lossless VPL syntax tree — spans, comments, parameter order — and a serialiser on top of it
- The node graph and its synchronisation with VPL text (C1)
- Deep style editing beyond what the styler control does (D2, D3, D6, D7)
- Import wizards with preview (E1–E3)
- Job queue and progress model (E7)
- The project file format (G1)
- Build, signing and update infrastructure (G3, G4)
- Visual analysis surfaces (B1, B2, B5) — after release 1

## The state of this repository

The previous contents were a Tauri 1 + Svelte 4 + Vite template from January 2024 — a menu and a
basic layout, no substantive code. Removed; the history remains in git. The repository name, the
GitHub project and `app-icon.png` were kept.
