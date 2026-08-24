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
  connection and fails at run time is a bad graph. Asked for as
  [vt#235](https://github.com/versatiles-org/versatiles-rs/issues/235) — and asked of the _operation_
  rather than of the metadata, because the properties that decide it (alpha channel, tile size, which
  layers exist) are more than a metadata vocabulary should have to carry.

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

Small changes to versatiles-rs that Studio is a good reason to make — the list to take to a
versatiles-rs planning session. None blocks Studio; each removes a workaround.

| Ask                                           | Why                                                                              | Raised by                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| **A lossless VPL syntax tree and serialiser** | The node graph must edit text without reordering parameters or dropping comments | [Q11](decisions.md); the largest of these |
| **A compute/render split in `probe`**         | Studio needs data, not `PrettyPrint` text; the CLI would gain `--json` for free  | [Q4](decisions.md)                        |
| **`tools` moved into `versatiles`'s lib**     | `layer_stats()` is binary-only, so B2's breakdown cannot be imported             | [Q12](decisions.md)                       |
| **An ignored `x-` namespace in `Config`**     | `deny_unknown_fields` stops one file serving as both project and serve config    | [Q6](decisions.md)                        |

The first is on the critical path for stage 2 and should be offered upstream during stage 1, so
review overlaps with cluster A rather than following it. The rest can land whenever.

**Drafted and deliberately not filed: an operation declaring what it produces.** `check_pipeline`
passes `from_debug format=pbf | raster_flatten` and the build refuses it, so a type mismatch is
caught by building and not by checking. It would be a real improvement for a `--dry-run` or a CI
check — and Studio barely needs it: the picker cannot offer a misfit since
[vt#235](https://github.com/versatiles-org/versatiles-rs/issues/235) landed, and a hand-typed one
already fails the preview with upstream's own wording a second later. The difference is an underline
rather than a status line. Worth raising when someone has the CI case to point at, which
[S5.5](scope-release-1.md) would give us.

Two more were filed on 2026-08-21: identifying the software making a request
([vt#248](https://github.com/versatiles-org/versatiles-rs/issues/248)) and a formatter that keeps
comments ([vt#249](https://github.com/versatiles-org/versatiles-rs/issues/249)). Both passed the same
test as the ten before them — they are about _tiles_ rather than about Studio's interface, and the
CLI and `versatiles_node` want them too. Both landed the next day, in 4.9.1.

### A field's type is not its meaning

The forms generate themselves, which is finding 1 above and the reason an operation added upstream
appears in Studio with no work here. This is the limit of that, and the decision it forced.

`VPLFieldMeta` carries `name`, `rust_type`, `is_required`, `is_sources`, `doc`, `enum_variants`,
`accepts` and `default`. There is no slot for what a value _is_. `control_for` therefore reads
`rust_type` and nothing else — which is right, and which is why a zoom level renders as a spinner
that goes to 255.

Read against 4.10.0's `all_operation_metadata()`, the operation set holds these:

| What it means                  | Fields                                                                                                                                                                                                                     | Type today                  | What the form gives                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------- |
| **A file on disk** — 15        | `filename` ×7, `meta_update.tilejson_file` / `tilejson_update_file` / `vector_layers_file`, `raster_mask.geojson`, `vector_update_properties.data_source_path`, `cutline` ×2, `from_container.ssh_identity`                | `String`                    | a text box to type a path into                |
| **A URL**                      | `from_tilejson.url`; `from_container.filename` takes a path _or_ `http`/`https`/`sftp`                                                                                                                                     | `String`                    | the same text box                             |
| **A rectangle on the map** — 6 | `bbox` on `from_csv`, `from_geo`, `from_grid`, `from_h3`, `filter`; `meta_update.bounds`                                                                                                                                   | `[f64;4]` `[w,s,e,n]` WGS84 | four number boxes                             |
| **A point on the map**         | `meta_update.center`                                                                                                                                                                                                       | `[f64;3]` `[lon,lat,zoom]`  | three number boxes                            |
| **A zoom level** — 19          | `min_zoom`, `max_zoom`, `level_min`, `level_max`, `level`, `level_base`, `fillzoom` across ten operations                                                                                                                  | `u8`                        | a spinner from 0 to 255                       |
| **A bounded number**           | `from_h3.resolution` (0–15), `raster_format.effort` (0–100), `raster_levels.brightness` (±255), `contrast` and `gamma` (above 0), `dem_quantize.elevation_error`                                                           | `u8` / `f32` / `f64`        | the type's range, not the field's             |
| **`256` or `512`**             | `tile_size` ×4, `from_color.size`                                                                                                                                                                                          | `u16` / `u32`               | a spinner over 65,535 values                  |
| **A colour**                   | `from_color.color` (hex `RRGGBB`), `raster_flatten.color` (`[u8;3]`)                                                                                                                                                       | `String` / `[u8;3]`         | a text box and three number boxes             |
| **An EPSG code**               | `from_grid.epsg`, `from_gdal_raster.crs`                                                                                                                                                                                   | `u32`                       | a spinner over four billion values            |
| **A name out of the data**     | `from_csv`'s five column fields, `from_geo.properties_include` / `_exclude`, `vector_update_properties`'s `layer_name` / `id_field_tiles` / `id_field_data`, `vector_filter_features.layer`, `vector_filter_layers.filter` | `String` / `Vec<String>`    | a text box; `from_csv` alone gets suggestions |
| **Code**                       | `vector_filter_features.expr` (CEL), `vector_filter_properties.regex`, `meta_update`'s three JSON strings, `from_grid.id_template`                                                                                         | `String`                    | a single-line text box                        |
| **One character**              | `from_csv.delimiter`, `vector_update_properties.field_separator` / `decimal_separator`                                                                                                                                     | `String`                    | a text box of any length                      |

**Two of these Studio already knew about, in its own comments.** `suggest.rs` hardcodes
`CSV_COLUMN_FIELDS` and says "nothing in `field_meta` marks a `String` as 'a column name'; adding
that upstream is the better fix, and is worth an issue once there is a second operation that wants
it" — and `vector_update_properties.id_field_data` is that second operation, with `from_geo`'s two
property fields making a third and fourth. `import.rs` carries a table of extensions per import kind
for the same reason and refuses to parse them out of the prose, which is the right call: `cutline`'s
documentation reads "GeoJSON polygon outside which pixels become nodata" and it is a path
(`from_gdal/raster/raster_source.rs:129`).

#### Studio owns the field semantics, and asks upstream only for the parser

Four asks were drafted off this table: an `accepts` probe for unenumerated types, a numeric range, a
marker on path-valued fields with the formats each takes, and a marker on the fields that name a
column or layer. **One was filed and three were withdrawn**, on an argument worth keeping.

**Only Studio profits from most of it, and the vocabulary is large.** Twelve kinds of meaning across
roughly eighty fields is a substantial thing to ask operation authors to learn and maintain, and the
benefit outside a generated form is thin. A per-field extension list is worse than that: it has to be
kept in step forever, and the release it falls behind is the release it starts lying. These three
fail the test the rest of this section applies — that an ask is about _tiles_ rather than about
Studio's interface, and that the CLI and `versatiles_node` want it too.

**One of them is not an ask at all.** `check_pipeline`'s own documentation says an empty result still
permits "a value [with] the right name but the wrong format (`color=red` is not hex, and no parser in
the metadata says so)", and there is a test recording `from_color color=red` as clean. That is
upstream describing a hole in the contract of a library function whose entire purpose is finding
problems without building. The cause is one string comparison: the derive emits `accepts` only when a
field's mapping is `property_enum_option`, so every path, colour, EPSG code, bbox and delimiter gets
`None` — while the derive's own comment calls `parsed_type` "a superset of `enum_type`". No new
vocabulary, nothing for operation authors to learn. Filed as
[vt#257](https://github.com/versatiles-org/versatiles-rs/issues/257).

**The line is where the logic lives.** Validation has to sit next to the parser; presentation can sit
next to the presentation. Studio _could_ check a hex colour itself in twenty lines — the cost is not
capability but owning a second parser that has to keep agreeing with upstream's, which this
repository has already priced twice and refused: the hand-written CSV separator sniffer deleted after
[vt#238](https://github.com/versatiles-org/versatiles-rs/issues/238), and `validate.rs` giving up
deciding enum values for itself after [vt#224](https://github.com/versatiles-org/versatiles-rs/issues/224)
and [vt#252](https://github.com/versatiles-org/versatiles-rs/issues/252). A _role_, by contrast, is
not logic. "This field is a zoom level" is a static fact, and a static fact cannot drift out of
agreement with a parser because it is not one. Same for a numeric range: two numbers, no behaviour.

So Studio carries the roles, in `vpl::semantics` — a table keyed by `(operation, field)`, merged into
`operations()` where `control_for` runs. It consolidates the two miniature versions already in
`suggest.rs` and `import.rs` rather than becoming a third.

**What keeps it from rotting is two tests, and the second is the important one.**

1. Every entry still names a real `(operation, field, rust_type)` triple in
   `all_operation_metadata()` — so a rename, a removal or a type change upstream fails the build here
   rather than silently falling back.
2. **No unclassified field of a known shape**: every `[f64;4]` has a role, every `u8` whose name
   matches `zoom|level` has one, every `String` named `*file*` has one. This is the half that catches
   what upstream _adds_.

Only the first is the obvious test to write, and on its own it would be the vt#229 mistake again — a
tripwire that names one acceptable outcome and stays silent when a different one arrives. The second
asserts the claim the table rests on rather than the shape of any fix.

**What this costs, stated plainly.** It partially gives up "an operation added upstream appears with
no work here". Not entirely: a new operation still appears and still works, it just appears with
plain controls until someone adds roles. Generated for correctness, curated for polish — a tier
rather than a loss, and the failure direction is degradation to exactly today's behaviour.

**And it is the better way to earn the upstream ask.** After a release of carrying the table we will
know which roles paid for themselves, which churned, and how often the tests caught an upstream
addition. Five roles stable across two releases is a far stronger issue than the speculative enum
drafted here; constant churn means the ask was wrong and it cost one file. The withdrawn drafts are
kept rather than deleted, to be re-offered with that evidence or dropped.

#### What Studio builds, and in what order

A file dialog on the path fields is the most work saved per line written — the dialog and the
extension lists both exist already. Drawing a bbox reuses `CropOverlay`, which does exactly this for
export. Zoom as a slider is nineteen fields and the smallest change. Extending `suggest.rs` past
`from_csv` needs no new machinery; `analysis::probe_layers` already knows a source's layers. A colour
picker is two fields.

Deferred, as low harm for real cost: an EPSG picker needs a CRS database, and byte-size units and a
delimiter picker are conveniences on parameters few people set.

#### Not worth asking for, and not worth a role either

**Conditional units.** `from_csv.point_reduction_value` is tile-pixels under `min_distance` and a
keep-fraction under `drop_rate`; `from_grid.size` is meters, or degrees when `epsg=4326`. A field
whose unit depends on a sibling is a large vocabulary for two cases, and both doc strings already say
it. Rendering the documentation beside the field is the whole fix.

**An expression language on `expr` and `regex`.** Worth having only if Studio builds an editor for
CEL, which nothing in release 1 asks for. A syntax-highlighted box is Studio's business until then.

**Cross-field constraints** — `properties_include` XOR `properties_exclude` (twice), `filter`'s
`bbox_border` requiring `bbox`, `from_grid.id_template` overriding `id_preset`, `meta_update`'s four
tilejson spellings, and every `min ≤ max` pair. Real, and `check_pipeline` could decide all of them
without I/O — this one is genuinely upstream's, since it is logic rather than a fact. Held rather
than dropped: each is one documented line today, and vt#257 is the ask with the better argument
behind it.

### Filed, and what came back

What has actually been asked for, and what each one buys back here. Most workarounds are things
Studio would keep anyway — a tile URL that defeats a cache, a guard against an unbounded traversal —
so they need no reminder to remove.

**One reminder was tried and did not work.** `the_workaround_is_still_needed` was a test built to
fail the day vt#229 landed, so nobody had to remember. It never fired. It watched for the generated
`### Parameters` section to disappear from `doc`; upstream instead added `summary` and `details` and
left `doc` whole — the other of the two fixes the issue had offered. A tripwire that names one
acceptable outcome is silent when the other one arrives, and a silent tripwire is worse than none,
because it is trusted. What replaced it asserts the claim the workaround rested on rather than the
shape of the fix: `every_operation_has_a_short_usable_summary` holds whoever supplies the summary to
the same standard, and cannot be satisfied by a fix arriving in an unexpected form.

#### Still open

| Issue                                                                | Asks for                                                   | What Studio does meanwhile                                                                                                                            |
| -------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [vt#226](https://github.com/versatiles-org/versatiles-rs/issues/226) | Loosen the `r2d2_sqlite` pin so GDAL can link              | Carries a pinned `proj-sys` fork ([Q34](decisions.md#q34--studio-carries-a-pinned-proj-sys-fork-until-the-libsqlite3-sys-conflict-resolves-upstream)) |
| [proj#261](https://github.com/georust/proj/pull/261)                 | Widen `libsqlite3-sys` to any 0.x — **a PR, not an issue** | The pinned fork above                                                                                                                                 |
| [vt#254](https://github.com/versatiles-org/versatiles-rs/issues/254) | Drop the open-ended CORS origin patterns                   | Nothing — Studio binds loopback and takes the default `ServerConfig`, so no origin pattern of ours is at stake. Deferred upstream to the next major.  |

#### Landed in 4.10.0

Two, in a release that is otherwise a security pass over untrusted input. Both were read in the
4.10.0 source rather than taken from the issue being closed, for the reason vt#229 gives above.

| Issue                                                                | Landed as                                                                                       | What Studio does with it                                                                                                                                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [vt#255](https://github.com/versatiles-org/versatiles-rs/issues/255) | `from_geo`/`from_csv` refuse coordinates outside ±180/±90 and a `crs` member naming another CRS | **Nothing to change, and that is the win** — a projected shapefile used to fail several layers down; the message now names the problem, and `open_container` already forwards `{e:#}` whole |
| [vt#256](https://github.com/versatiles-org/versatiles-rs/issues/256) | `bbox=` filters while reading and clips the pyramid                                             | **Nothing to change** — the parameter forms are generated from the metadata, so a control that always errored on submit now works, with no edit here (S2.6)                                 |

**Neither needed adoption, which is twice the point of generating the forms and forwarding upstream's
own wording.** vt#256 in particular had been a live trap: `bbox` was in `from_geo`'s metadata all
along, so Studio drew the four number fields, and filling them in failed the preview with
`from_geo: bbox= is not supported`. The fix arrived underneath the form.

**One change does need watching rather than adopting.** SFTP connections now verify host keys on
OpenSSH's `accept-new` policy — an unknown host is recorded in `~/.ssh/known_hosts`, a host whose key
changed is refused. Studio passes `ssh://` URLs straight through ([S1.3](scope-release-1.md)) and has
nothing to configure; a rebuilt server is a failed open with upstream's message in it, and
`VERSATILES_SFTP_KNOWN_HOSTS` is the escape hatch to mention if anyone hits one.

#### Landed in 4.9.1

Four, the day after the last of them was filed. Each row was read in the 4.9.1 source rather than
taken from the issue being closed, for the reason vt#229 gives above.

| Issue                                                                | Landed as                                                            | What Studio does with it                                                                                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [vt#248](https://github.com/versatiles-org/versatiles-rs/issues/248) | `io::set_product`, appended to `USER_AGENT` rather than replacing it | `studio_core::identify` at start-up, so a remote read says `versatiles/4.9.1 … VersaTiles-Studio/…` ([S1.11](scope-release-1.md)) — **done** |
| [vt#249](https://github.com/versatiles-org/versatiles-rs/issues/249) | `CstFile::format`, rewriting trivia and moving nothing else          | A Format button in the VPL tab, on the undo stack ([S2.15](scope-release-1.md)) — **done**                                                   |
| [vt#252](https://github.com/versatiles-org/versatiles-rs/issues/252) | `VPLFieldMeta::accepts`, the type's own parser                       | Nothing to change — Studio asks `check_pipeline`, so `format=notaformat` is now underlined as it is typed rather than failing a preview      |
| [vt#253](https://github.com/versatiles-org/versatiles-rs/issues/253) | `VPLFieldMeta::default`, in VPL's own spelling                       | The generated form shows it as the empty box's placeholder — shown, never written — **done**                                                 |

**vt#252 needed no adoption, which is the point of having taken `check_pipeline` in 4.9.0.** Studio
stopped deciding for itself then; the fix arrived underneath it, and the only change here was a test
that recorded `from_debug format=notaformat` as a known miss and now records that it is caught.

#### Landed in 4.9.0

Ten of the twelve closed at once. Each row below was read in the 4.9.0 source, not taken from the
issue being closed — the two are not the same claim, as vt#229 shows. The last column is the work
this opens up; only vt#229's is done.

| Issue                                                                | Landed as                                                      | What it lets Studio drop                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [vt#222](https://github.com/versatiles-org/versatiles-rs/issues/222) | `cache_control` on `serve` and in the config file              | **Not taken** — the revision is the better answer; see below               |
| [vt#223](https://github.com/versatiles-org/versatiles-rs/issues/223) | `versatiles_container::probe::probe_report`                    | **Not taken yet** — its new half is B2's, which [Q12](decisions.md) defers |
| [vt#224](https://github.com/versatiles-org/versatiles-rs/issues/224) | `check_pipeline` and `VplProblem`                              | **Done** — `validate` places upstream's verdict in the text                |
| [vt#227](https://github.com/versatiles-org/versatiles-rs/issues/227) | A tile-count guard that refuses an impossible pyramid          | Nothing — `export::MAX_TILES` guards a different limit                     |
| [vt#228](https://github.com/versatiles-org/versatiles-rs/issues/228) | The PMTiles writer names `raster_overview` as the cause        | Nothing — there was no workaround                                          |
| [vt#229](https://github.com/versatiles-org/versatiles-rs/issues/229) | `OperationMeta.summary` and `.details`                         | **Done** — `vpl::summary` and its tripwire are deleted                     |
| [vt#235](https://github.com/versatiles-org/versatiles-rs/issues/235) | `Compatibility` and `compatible_transforms`                    | **Done** — the picker groups by what fits (S2.14)                          |
| [vt#236](https://github.com/versatiles-org/versatiles-rs/issues/236) | `probe_report` returns its analysis instead of printing it     | **Not taken yet** — its new half is B2's, which [Q12](decisions.md) defers |
| [vt#237](https://github.com/versatiles-org/versatiles-rs/issues/237) | `versatiles_core::utils::read_csv_header`                      | **Done** — `tabular` calls it (S3.4)                                       |
| [vt#238](https://github.com/versatiles-org/versatiles-rs/issues/238) | `read_csv_iter` fails rather than panicking on a bad separator | **Done** — the hand-written sniffer is deleted                             |

**Two of the ten are not worth taking, and that is a finding rather than a backlog.**

_vt#222, the configurable `Cache-Control`._ Studio asked for it because the server hardcoded four
weeks and a rebuilt preview served stale tiles. The fix landed, and the workaround it was meant to
retire is better than the fix: a per-mount revision in the tile URL gives perfect caching _and_
immediate invalidation, while `no-cache` would make panning back over tiles the browser already has
fetch them again. The revision stays, and the four-week default is now right rather than tolerated.

_vt#223 and vt#236, `probe_report`._ The half that would replace `analysis::describe` does not: it
carries no geographic bounding box, so the extent still has to be derived, and at its shallowest
depth it calls `tile_pyramid()` — the one thing `describe` already does. What is genuinely new is
`tile_sizes` and `contents`, which scan a container for the per-layer byte breakdown. That is
[B2](features.md), which [Q12](decisions.md) keeps out of release 1. The ask was right and the answer
is good; it is simply for a feature that is not being built yet.

Resolved earlier: [vt#216–#218](https://github.com/versatiles-org/versatiles-rs/issues/216), which
became the lossless CST in 4.8.0 and let Studio delete 1 021 lines of its own parser.

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
