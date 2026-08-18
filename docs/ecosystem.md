# Ecosystem Inventory

> Snapshot taken 2026-08-16. Verify before relying on any single detail.

Most of Studio's engine already exists. This is the evidence base the [decision log](decisions.md)
refers back to — what is available, so planning can tell "wire up something that works" from "build
something new".

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

The transformation already ships: `versatiles_node/src/codegen.rs` turns this into TypeScript via
`generateVplTypescript()`, mapping enum fields to string-literal unions. Three caveats:

- `all_operation_metadata()` sits behind `#[cfg(feature = "codegen")]`, so Studio must enable it.
- The metadata carries `is_required` but **no default values**, so generated forms show empty
  optional fields.
- `OperationMeta` is `{ tag_name, kind, doc, fields }` where `kind` is only `"read"` or
  `"transform"` — there is **no input or output data type**. A node graph therefore cannot check
  that `vector_filter_layers` is not fed a raster tile; it can only infer from the `raster_*` /
  `vector_*` / `dem_*` naming convention, which is a convention rather than a contract. This matters
  now that C1 is a deliverable ([Q11](decisions.md)): a graph that lets you draw an invalid
  connection and fails at run time is a bad graph.

### 2. `versatiles probe` is already an analysis engine

| Depth  | What it scans                                                                                                                           | Feeds  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `-d`   | Container metadata                                                                                                                      | A6     |
| `-dd`  | All tile sizes                                                                                                                          | B1, B4 |
| `-ddd` | Tile contents; validates MVT 2.1, reports missing `extent`/`version`, duplicate layer names, polygon winding problems, degenerate rings | B3     |

`probe -ddd` emits a `fix:` line suggesting the right `vector_repair` invocation, so B3 is close to
free. Three details drive [Q4](decisions.md) and [Q12](decisions.md):

- **The byte breakdown (B2) already exists.** `versatiles/src/tools/tile_breakdown.rs` splits each
  layer into geometry, tag references, property keys, property values, feature ids and a framing
  residual; `probe -ddd` aggregates it by zoom × layer. Only the **per-attribute** split is missing.
- **Sampling is built in.** `probe --sample PERCENT` reads a deterministic subset as contiguous
  64×64 windows, sized so remote sources coalesce them into single range requests
  (`tile_sampling.rs`). Scanning tile _sizes_ is cheaper still — all five readers override
  `tile_size_stream`, so no tile bodies are read.
- **Compute and rendering are entangled, and half of it is binary-only.** Every probe function
  takes `&mut PrettyPrint` and returns `Result<()>`, so results are text, not data.
  `validate_tile()` is reachable — it lives in `versatiles_geometry`. **`layer_stats()` is not**:
  `tools` is declared in `versatiles/src/main.rs` rather than `lib.rs`, so the byte breakdown
  cannot be imported at all.

### 3. The VPL parser only runs one way

> **Resolved upstream in v4.8.0** (not yet on crates.io): a lossless `CstFile` with spans, a
> serialiser and positioned parse errors. See [Q23](decisions.md) for what that means for Studio.

The constraint that shapes cluster C. Text → structure is solved; structure → text does not exist:

| Needed for                       | Status                                                                     |
| -------------------------------- | -------------------------------------------------------------------------- |
| Parse VPL (C1, C4 input)         | ✅ `FromStr` on `VPLPipeline`, `VPLNode::try_from_str`                     |
| Write VPL back out (C1 output)   | ❌ no `Display`, no `to_string`, no serialiser — only `Debug`              |
| Preserve parameter order         | ❌ `properties` is a `BTreeMap`, so a round-trip sorts them alphabetically |
| Preserve `#` comments            | ❌ the parser matches and discards them                                    |
| Error positions for editor marks | ❌ errors are rendered strings via nom's `convert_error`; no spans         |

Since [Q11](decisions.md) puts the node graph in release 1, a **lossless syntax tree** is the first
thing stage 2 has to build — ideally upstream.

## Upstream asks

Five small changes to versatiles-rs that Studio is a good reason to make — the list to take to a
versatiles-rs planning session. None blocks Studio; each removes a workaround.

| Ask                                           | Why                                                                              | Raised by                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| **A lossless VPL syntax tree and serialiser** | The node graph must edit text without reordering parameters or dropping comments | [Q11](decisions.md); the largest of these |
| **Data types on `OperationMeta`**             | So the graph can reject invalid connections instead of failing at run time       | finding 1 above                           |
| **Default values on `VPLFieldMeta`**          | So generated forms are pre-filled rather than empty                              | finding 1 above                           |
| **A compute/render split in `probe`**         | Studio needs data, not `PrettyPrint` text; the CLI would gain `--json` for free  | [Q4](decisions.md)                        |
| **`tools` moved into `versatiles`'s lib**     | `layer_stats()` is binary-only, so B2's breakdown cannot be imported             | [Q12](decisions.md)                       |
| **An ignored `x-` namespace in `Config`**     | `deny_unknown_fields` stops one file serving as both project and serve config    | [Q6](decisions.md)                        |

The first is on the critical path for stage 2 and should be offered upstream during stage 1, so
review overlaps with cluster A rather than following it. The rest can land whenever.

### Filed and open

What has actually been asked for, and what each one buys back here. Most workarounds are things
Studio would keep anyway — a tile URL that defeats a cache, a guard against an unbounded traversal —
so they need no reminder to remove. **Where a workaround exists only until the fix lands, a test
fails on that day**: `vpl::operations::the_workaround_is_still_needed` is the one such tripwire
today, for vt#229. This table is the map, not the reminder.

| Issue                                                                | Asks for                                                   | What Studio does meanwhile                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| [vt#222](https://github.com/versatiles-org/versatiles-rs/issues/222) | Configurable `cache-control` on `serve`                    | A per-mount revision in the tile URL                         |
| [vt#223](https://github.com/versatiles-org/versatiles-rs/issues/223) | `tools` in the library, not binary-only                    | B2's byte breakdown is deferred ([Q12](decisions.md))        |
| [vt#224](https://github.com/versatiles-org/versatiles-rs/issues/224) | Check a pipeline without building it                       | `validate` re-implements the checks it can                   |
| [vt#225](https://github.com/versatiles-org/versatiles-rs/issues/225) | A name accessor on `SourceType`                            | `analysis::container_name` parses `Display` output           |
| [vt#226](https://github.com/versatiles-org/versatiles-rs/issues/226) | Loosen the `r2d2_sqlite` pin so GDAL can link              | Carries a pinned `proj-sys` fork ([Q19](decisions.md))       |
| [vt#227](https://github.com/versatiles-org/versatiles-rs/issues/227) | A sanity check before an unbounded traversal               | `export::MAX_TILES` refuses one ([S3.6](scope-release-1.md)) |
| [vt#228](https://github.com/versatiles-org/versatiles-rs/issues/228) | PMTiles from an overview pipeline                          | Nothing — the failure is reported and readable               |
| [vt#229](https://github.com/versatiles-org/versatiles-rs/issues/229) | An operation summary separate from its doc                 | `vpl::summary` splits the first paragraph                    |
| [proj#261](https://github.com/georust/proj/pull/261)                 | Widen `libsqlite3-sys` to any 0.x — **a PR, not an issue** | The pinned fork above                                        |

Resolved: [vt#216–#218](https://github.com/versatiles-org/versatiles-rs/issues/216), which became
the lossless CST in 4.8.0 and let Studio delete 1 021 lines of its own parser.

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

MapLibre needs SDF glyphs and sprite sheets neither versatiles-rs nor the style library can conjure
at render time. Numbers as of `versatiles-frontend` v3.14.0, `versatiles-fonts` v2.2.0,
`versatiles-style` v5.13.1; see [Q9](decisions.md) for what we do with them.

`frontend-blank` carries exactly the two asset kinds Studio needs — 109 MB compressed (85 MB brotli),
~190 MB unpacked, **47,360 glyph files** plus sprites. Three facts make that the wrong granularity:

**Fonts are published per family:**

| Family                      | Size   |     | Family                         | Size  |
| --------------------------- | ------ | --- | ------------------------------ | ----- |
| `fonts.tar.gz` (everything) | 107 MB |     | `lato`                         | 5 MB  |
| `noto_sans`                 | 45 MB  |     | `nunito`                       | 4 MB  |
| `fira_sans`                 | 8 MB   |     | `roboto`                       | 3 MB  |
| `source_sans_3`             | 6 MB   |     | `open_sans`                    | 3 MB  |
| `merriweather_sans`         | 2 MB   |     | `pt_sans`, `libre_baskerville` | <1 MB |

Sprites are a separate 1.3 MB download from `versatiles-style` releases.

**Sprite _generation_ exists upstream but is not reachable as a library** — the same shape of problem
as `layer_stats()` in [Q12](decisions.md). `versatiles-style/scripts/lib/sprites.ts` takes SVG icons
and produces a packed sheet with SDF at several ratios (`bin-pack`, `optipng`, `sharp`), and the repo
carries an `icons/` tree to feed it. None of it ships: the npm package's `files` field is `dist/*`,
and the built `index.d.ts` mentions sprites only as MapLibre's `SpriteSpecification` — a URL to load,
not a sheet to build. So D10 is not free. It would need the algorithm reimplemented in Rust, since
`sharp` is a Node native module and Studio has no Node runtime at run time.

**Archives are served directly, never unpacked** — `serve -s "[/assets]static.tar.br"` reads `.tar`,
`.tar.gz`, `.tar.br` and directories. 47,360 tiny files are slow to extract, painful on Windows
(per-file NTFS overhead, Defender scanning each) and awkward to verify or delete; one archive is
atomic and checksummable.

**The Latin-only trick** — `frontend-tiny` keeps glyphs below codepoint 1024 and replaces higher
ranges with _valid but empty_ tiles, so clients get HTTP 200 rather than 404. The whole bundle is
1 MB, which lets a small default ship inside the binary. B8 must then distinguish "genuinely empty
glyph" from "font not downloaded yet".

## What genuinely does not exist yet

The actual construction work:

- The application shell and window/panel layout
- A lossless VPL syntax tree — spans, comments, parameter order — and a serialiser on top of it
- The node graph and its synchronisation with VPL text (C1)
- Deep style editing beyond what the styler control does (D2, D3, D6, D7)
- Import with preview (E1–E3)
- Job queue and progress model (E7)
- The project file format (G1)
- Build, signing and update infrastructure (G3, G4)
- A statically bundled GDAL via `gdal-src`, with a fixed driver set ([Q19](decisions.md))
- Visual analysis surfaces (B1, B2, B5) — after release 1

## The state of this repository

The previous contents were a Tauri 1 + Svelte 4 + Vite template from January 2024 — a menu and a
basic layout, no substantive code. Removed; the history remains in git. The repository name, the
GitHub project and `app-icon.png` were kept.
