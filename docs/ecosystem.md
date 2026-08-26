# Ecosystem Inventory

> Snapshot taken 2026-08-16 against versatiles-rs 4.7; Studio is on 4.10. Verify before relying on
> any single detail - [Filed, and what came back](#filed-and-what-came-back) records which gaps have
> since closed.

Most of Studio's engine already exists. This is the evidence base the [decision log](decisions.md)
refers back to - what is available, so planning can tell "wire up something that works" from "build
something new".

## versatiles-rs - the engine

A Rust workspace, consumed as a library dependency rather than shelled out to.

| Crate                  | What it gives us                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `versatiles_container` | Read/write `.versatiles`, `.pmtiles`, `.mbtiles`, `.tar`, directories. Remote read over HTTP(S) and SFTP with byte ranges. Cluster A's foundation |
| `versatiles_pipeline`  | VPL and ~30 operations. Cluster C and most of E                                                                                                   |
| `versatiles_core`      | Shared types: tile coordinates, bounding boxes, TileJSON, compression                                                                             |
| `versatiles_geometry`  | Vector geometry and MVT encoding/decoding. Basis for A4 and B2                                                                                    |
| `versatiles_image`     | Raster encoding: png, jpg, webp, avif. Basis for B6                                                                                               |
| `versatiles_derive`    | Derive macros, including the ones behind operation metadata                                                                                       |
| `versatiles_node`      | napi bindings - precedent for exposing the crates to a JS layer                                                                                   |

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

`versatiles_pipeline` exposes `all_operation_metadata() -> Vec<OperationMeta>`, carrying everything a form generator needs: The transformation already ships: `versatiles_node/src/codegen.rs` turns this into TypeScript via `generateVplTypescript()`, mapping enum fields to string-literal unions. Three caveats:

### 2. `versatiles probe` is already an analysis engine

`probe -ddd` emits a `fix:` line suggesting the right `vector_repair` invocation, so B3 is close to free. Three details drive [Q4](decisions.md) and [Q12](decisions.md):

- **The byte breakdown (B2) already exists.** `versatiles/src/tools/tile_breakdown.rs` splits each layer into geometry, tag references, property keys, property values, feature ids and a framing residual; `probe -ddd` aggregates it by zoom × layer. Only the **per-attribute** split is missing.
- **Sampling is built in.** `probe --sample PERCENT` reads a deterministic subset as contiguous 64×64 windows, sized so remote sources coalesce them into single range requests (`tile_sampling.rs`).

### 3. The VPL parser only runs one way

**Resolved upstream in v4.8.0** - a lossless `CstFile` with spans, a serialiser and positioned parse
errors; Studio has been on it since, and [Q23](decisions.md) records what it meant here.

The finding, as it stood: this was the constraint that shaped cluster C. Text → structure was
solved and structure → text did not exist, so the node graph could not write an edit back without
reformatting the file and dropping its comments.

## Upstream asks

Small changes to versatiles-rs that Studio is a good reason to make. None blocks Studio; each
removes a workaround.

| Ask                                       | Why                                                                             | Raised by           |
| ----------------------------------------- | ------------------------------------------------------------------------------- | ------------------- |
| **A compute/render split in `probe`**     | Studio needs data, not `PrettyPrint` text; the CLI would gain `--json` for free | [Q4](decisions.md)  |
| **`tools` moved into `versatiles`'s lib** | `layer_stats()` is binary-only, so B2's breakdown cannot be imported            | [Q12](decisions.md) |
| **An ignored `x-` namespace in `Config`** | `deny_unknown_fields` stops one file serving as both project and serve config   | [Q6](decisions.md)  |

#### Still open

| Issue                                                                | Asks for                                                   | What Studio does meanwhile                                                                                                                            |
| -------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [vt#226](https://github.com/versatiles-org/versatiles-rs/issues/226) | Loosen the `r2d2_sqlite` pin so GDAL can link              | Carries a pinned `proj-sys` fork ([Q34](decisions.md#q34--studio-carries-a-pinned-proj-sys-fork-until-the-libsqlite3-sys-conflict-resolves-upstream)) |
| [proj#261](https://github.com/georust/proj/pull/261)                 | Widen `libsqlite3-sys` to any 0.x - **a PR, not an issue** | The pinned fork above                                                                                                                                 |
| [vt#254](https://github.com/versatiles-org/versatiles-rs/issues/254) | Drop the open-ended CORS origin patterns                   | Nothing - Studio binds loopback and takes the default `ServerConfig`, so no origin pattern of ours is at stake. Deferred upstream to the next major.  |

**Twelve more were filed and have landed**, in 4.8.0 through 4.10.0 - the lossless syntax tree
([Q23](decisions.md)), `check_pipeline`, `compatible_transforms`, a comment-preserving formatter,
per-operation `summary`/`details`, and a configurable cache header among them. Each is read in the
released source rather than taken from the issue being closed.

### Filed, and what came back

`the_workaround_is_still_needed` was a test built to fail the day an
upstream fix landed, so nobody had to remember to remove the workaround. It never fired: it watched
for one of the two acceptable shapes of fix and upstream shipped the other. A tripwire that names
one outcome is silent when the other arrives, and a silent tripwire is worse than none because it is
trusted. Assert the claim the workaround rests on, not the shape of the fix.

## Frontend pieces

| Repository                                                                                   | What it gives us                                                                                                                                         |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`versatiles-style`](https://github.com/versatiles-org/versatiles-style)                     | Style and sprite generation; presets colorful, eclipse, graybeard, shadow, neutrino, satellite. The core of cluster D                                    |
| [`maplibre-versatiles-styler`](https://github.com/versatiles-org/maplibre-versatiles-styler) | **A working style editor already exists** as a MapLibre control: palettes, global recolouring, font and language selection, export. D1 and D8 embed this |
| [`node-versatiles-svelte`](https://github.com/versatiles-org/node-versatiles-svelte)         | Svelte components including `BasicMap` with a bundled MapLibre worker                                                                                    |
| [`versatiles-map-editor`](https://github.com/versatiles-org/versatiles-map-editor)           | SvelteKit drawing and styling app. Precedent for app structure - and the reason Studio should _not_ do feature editing                                   |
| [`versatiles-frontend`](https://github.com/versatiles-org/versatiles-frontend)               | Pre-packaged web assets in several size tiers. The route to offline operation (G5) and static site export (F4, F7)                                       |

## Supporting tools

| Repository                                                                                                                                     | Relevance                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`versatiles-glyphs-rs`](https://github.com/versatiles-org/versatiles-glyphs-rs)                                                               | SDF glyph generation from TrueType, in Rust with no C++ deps - so D9 and B8 run inside the Tauri binary. Also builds the `versatiles-fonts` releases, so generated and downloaded glyph sets share a format |
| [`versatiles-svg-renderer`](https://github.com/versatiles-org/versatiles-svg-renderer)                                                         | Vector maps as SVG - the path to print-quality export (F6). Ships a UMD bundle and a `/maplibre` subpath, so it runs in the browser                                                                         |
| [`versatiles-choro`](https://github.com/versatiles-org/versatiles-choro)                                                                       | Choropleth workflow for newsrooms - same audience as P1, directly relevant to E6. Under heavy development; API will change                                                                                  |
| [`versatiles-spec`](https://github.com/versatiles-org/versatiles-spec)                                                                         | Container specification, currently v02. The reference for B3                                                                                                                                                |
| [`planetiler`](https://github.com/versatiles-org/planetiler), [`shortbread-tilemaker`](https://github.com/versatiles-org/shortbread-tilemaker) | OSM → vector tiles. **Not orchestrated by Studio** - planetiler needs Java 21+ and ~1 GB of auxiliary downloads, tilemaker is a separate C++ binary ([Q7](decisions.md))                                    |
| [`node-versatiles-google-cloud`](https://github.com/versatiles-org/node-versatiles-google-cloud)                                               | Precedent for cloud upload (F3)                                                                                                                                                                             |
| [`versatiles-documentation`](https://github.com/versatiles-org/versatiles-documentation)                                                       | Learning resources, and a gallery of 76 known projects - a ready-made list of users to talk to                                                                                                              |

## Map assets: fonts and sprites

MapLibre needs SDF glyphs and sprite sheets neither versatiles-rs nor the style library can conjure
at render time. Numbers as of `versatiles-frontend` v3.14.0, `versatiles-fonts` v2.2.0,
`versatiles-style` v5.13.1; see [Q9](decisions.md) for what we do with them.

`frontend-blank` carries exactly the two asset kinds Studio needs - 109 MB compressed (85 MB brotli),
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

**Sprite _generation_ exists upstream but is not reachable as a library** - the same shape of problem
as `layer_stats()` in [Q12](decisions.md). `versatiles-style/scripts/lib/sprites.ts` takes SVG icons
and produces a packed sheet with SDF at several ratios (`bin-pack`, `optipng`, `sharp`), and the repo
carries an `icons/` tree to feed it. None of it ships: the npm package's `files` field is `dist/*`,
and the built `index.d.ts` mentions sprites only as MapLibre's `SpriteSpecification` - a URL to load,
not a sheet to build. So D10 is not free. It would need the algorithm reimplemented in Rust, since
`sharp` is a Node native module and Studio has no Node runtime at run time.

**Archives are served directly, never unpacked** - `serve -s "[/assets]static.tar.br"` reads `.tar`,
`.tar.gz`, `.tar.br` and directories. 47,360 tiny files are slow to extract, painful on Windows
(per-file NTFS overhead, Defender scanning each) and awkward to verify or delete; one archive is
atomic and checksummable.

**The Latin-only trick** - `frontend-tiny` keeps glyphs below codepoint 1024 and replaces higher
ranges with _valid but empty_ tiles, so clients get HTTP 200 rather than 404. The whole bundle is
1 MB, which lets a small default ship inside the binary. B8 must then distinguish "genuinely empty
glyph" from "font not downloaded yet".

## What genuinely does not exist yet

The actual construction work:

- The application shell and window/panel layout
- A lossless VPL syntax tree - spans, comments, parameter order - and a serialiser on top of it
- The node graph and its synchronisation with VPL text (C1)
- Deep style editing beyond what the styler control does (D2, D3, D6, D7)
- Import with preview (E1-E3)
- Job queue and progress model (E7)
- The project file format (G1)
- Build, signing and update infrastructure (G3, G4)
- A statically bundled GDAL via `gdal-src`, with a fixed driver set ([Q19](decisions.md))
- Visual analysis surfaces (B1, B2, B5) - after release 1

## The state of this repository

The previous contents were a Tauri 1 + Svelte 4 + Vite template from January 2024 - a menu and a
basic layout, no substantive code. Removed; the history remains in git. The repository name, the
GitHub project and `app-icon.png` were kept.
