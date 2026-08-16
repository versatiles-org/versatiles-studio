# Release 1 Scope

VersaTiles Studio is funded, and four features are committed. This document maps each commitment to
the [Feature Catalogue](features.md) and separates what a commitment requires from what merely fits
near it.

> The four commitments are fixed. The minimum readings, the ordering and the stretch lists are our
> proposal and open to revision.

They span clusters A, D, E and C. Cluster B is out of scope ([Q2](decisions.md)).

---

## Commitment 1 · Open and preview all supported formats

|                      | Features                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Required**         | A1 (local: `.mbtiles`, `.pmtiles`, `.versatiles`, `.tar`, directories), A2 (remote over HTTPS and SFTP), A6 (metadata and TileJSON), A8 (feature popup) |
| **Strongly implied** | A5 (tile grid with z/x/y), A7 (recent files)                                                                                                            |
| **Stretch**          | A3 (multi-source layer stack), A4 (raw MVT inspector)                                                                                                   |

"Preview" only means something if vector tiles render legibly, so this silently pulls in the bundled
asset tier from [Q9](decisions.md) — sprites plus Latin glyphs — and a default style to render
against. Raster preview too, not just vector.

**Settled:** "all supported formats" includes remote sources. `versatiles_container` supports HTTPS
and SFTP with byte ranges, so excluding them would arbitrarily narrow the word "all".

## Commitment 2 · Create your own map style

|              | Features                                                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Required** | D1 (presets and global recolouring), D2 (derive a style from the layers actually present), D3 (layer tree with filter/zoom/paint editing), D8 (export), G7 (asset manager — styling is what makes a user want a font) |
| **Stretch**  | D5 (dark variant), D6 (accessibility checks), D9 (glyph generation from own fonts)                                                                                                                                    |
| **Out**      | D4 sprite authoring, D7 legend generator                                                                                                                                                                              |

D2 is load-bearing and the hardest. "Your own map style" for a tile set the user made themselves
means the editor cannot assume Shortbread layers — it has to read what is in the container, which is
the same introspection as A4. D1 and D8 are largely embedding `maplibre-versatiles-styler`; D3 is
new construction.

**Settled:** "create" means start from a preset, recolour, edit layers, export — not authoring from
an empty document, which is a cartographer's tool (P5) and a far larger surface.

## Commitment 3 · Convert image and vector data into map tiles

|                      | Features                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Required**         | E1 (GeoJSON, NDJSON, shapefile), E2 (CSV with lon/lat), E3 (GDAL path — the "image data" half), E7 (job queue with progress and cancellation), F2 (write the result out) |
| **Strongly implied** | C6 (cost estimate before a long run)                                                                                                                                     |
| **Stretch**          | E4 (DEM encoding and hillshade), E6 (table join for choropleths)                                                                                                         |
| **Out**              | E5 — dropped outright, not deferred ([Q7](decisions.md))                                                                                                                 |

E7 is not optional. Conversions run for minutes to hours; without progress and cancellation the
first long run makes the app look broken.

## Commitment 4 · Edit VPL and instantly see the result

|              | Features                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Required** | C1 (bidirectional node graph ⟷ VPL text), C3 (live preview — the "instantly" half), C4 (inline parse and validation errors), C2 (generated parameter forms) |
| **Stretch**  | C5 (recipe library), C8 (watch mode)                                                                                                                        |

**Settled ([Q11](decisions.md)):** this means node graph _plus_ text editor. C1 is a deliverable.

**It is the most expensive single item in release 1**, and not for the reason the catalogue
suggests. Parsing VPL is solved; writing it back is not — no serialiser, a `BTreeMap` that reorders
parameters, and a parser that discards comments
([details](ecosystem.md#3-the-vpl-parser-only-runs-one-way)). So the graph must edit text through
span-based edits over a lossless syntax tree. C4 needs the same work, since parse errors currently
come back as rendered strings with no positions.

---

## The dependency that saves the most work

**Commitments 3 and 4 share one engine.** E1, E2 and E3 are the `from_geo`, `from_csv` and GDAL
operations of the pipeline; the import wizard is a guided front-end onto a VPL pipeline the user
could equally well have typed. Building the pipeline layer first means the wizard's preview _is_
C3's preview, every wizard gets a "show me the VPL" escape hatch (G2, satisfying C7), and fixing the
pipeline fixes the wizard. Building them separately means writing the conversion plumbing twice.

## Proposed order

Derived from that dependency, not from the numbering of the commitments.

| Stage | Contents                                                                                                | Delivers             |
| ----- | ------------------------------------------------------------------------------------------------------- | -------------------- |
| **0** | Tauri shell, embedded server, IPC boundary, bundled sprites and Latin glyphs, CI for Linux and macOS    | nothing user-visible |
| **1** | Cluster A plus a default render style                                                                   | **Commitment 1**     |
| **2** | Lossless VPL syntax tree, node graph, inline errors, generated parameter forms, live preview, undo/redo | **Commitment 4**     |
| **3** | Import wizards on the pipeline layer, job queue, container export                                       | **Commitment 3**     |
| **4** | Asset manager, style editing against the user's own layers (on stage 2's undo stack), export            | **Commitment 2**     |
| **5** | Project directory (G1), Linux packaging and Homebrew cask (G3), auto-update (G4)                        | shippability         |

Commitment 2 comes last because D2 wants tiles to style, and those come from commitment 3.

**Stage 2 is the long pole.** The syntax tree has to exist before the graph can edit anything, so
start it during stage 1 — ideally as an upstream contribution, so review overlaps with cluster A
rather than following it.

**Undo/redo (G6) is in stage 2, not after release 1.** A node graph invites experimentation, and
this is the cheap moment: stage 2 already routes every interaction through a small set of text
edits, and that edit list is the command stack. Retrofitting undo means finding every mutation path
afterwards. Since G6 covers pipeline _and_ style edits, stage 2 delivers the stack plus pipeline
undo, and stage 4 must put style edits on the same stack rather than inventing a second one.

**Stage 5 is not polish** — without a distribution path the application reaches nobody. Per
[Q10](decisions.md) release 1 ships Linux packages and a Homebrew cask; the price is a one-time
Gatekeeper approval on macOS, so plain-language install instructions are part of the deliverable.
Ad-hoc signing still has to be configured — on Apple Silicon a binary needs it to run at all.

## Explicitly out of release 1

Cluster B in full, F3–F7 (upload, static site export, embed snippet, image export, offline package),
and the stretch items above. Also **Windows builds** and **Apple Developer signing**, both deferred
by [Q10](decisions.md).

**Dropped rather than deferred:** E5 ([Q7](decisions.md)) — it is not on a later roadmap either.

B1, B2 and B3 are cheaper than this document once assumed — per [Q12](decisions.md) the byte
breakdown already exists upstream — and are the natural first additions once the commitments ship.
