# Release 1 Scope

VersaTiles Studio is funded, and four features are committed for the first release. This document
maps each commitment to the [Feature Catalogue](features.md), separates what the commitment
requires from what merely fits near it, and records where the wording leaves room for
interpretation.

> The four commitments are fixed. Everything else on this page — the minimum readings, the
> ordering, the stretch lists — is our proposal and open to revision.

## The four commitments

1. **Open and preview all supported tile container formats.**
2. **Create your own map style.**
3. **Convert image and vector data into map tiles.**
4. **Edit VPL and instantly see the result.**

They span clusters A, D, E and C. Cluster B (analysis) is out of scope — see
[Q2](decisions.md).

---

## Commitment 1 · Open and preview all supported formats

|                      | Features                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Required**         | A1 (local: `.mbtiles`, `.pmtiles`, `.versatiles`, `.tar`, directories), A2 (remote over HTTPS and SFTP), A6 (metadata and TileJSON view), A8 (feature popup) |
| **Strongly implied** | A5 (tile grid with z/x/y), A7 (recent files)                                                                                                                 |
| **Stretch**          | A3 (multi-source layer stack with comparison), A4 (raw MVT inspector)                                                                                        |

"Preview" only means something if vector tiles render legibly, so this commitment silently pulls in
the bundled asset tier from [Q9](decisions.md) — sprites plus Latin glyphs — and a default style to
render against. It also needs raster preview, not just vector.

**Interpretation to confirm:** does "all supported formats" include remote sources (A2)? We read it
as yes, since `versatiles_container` supports them and excluding them would be arbitrary.

## Commitment 2 · Create your own map style

|              | Features                                                                                                                                                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Required** | D1 (presets and global recolouring), D2 (derive a style from the layers actually present), D3 (layer tree with filter/zoom/paint editing), D8 (export `style.json` and `@versatiles/style` code), G7 (asset manager, because styling is what makes a user want a font they do not have) |
| **Stretch**  | D5 (dark variant derivation), D6 (accessibility checks), D9 (glyph generation from own fonts)                                                                                                                                                                                           |
| **Out**      | D4 sprite authoring, D7 legend generator                                                                                                                                                                                                                                                |

D2 is the load-bearing one and the hardest. "Your own map style" for a tile set the user made
themselves means the style editor cannot assume Shortbread layers — it has to read what is actually
in the container. That is why D2 depends on the same layer introspection as A4.

D1 and D8 are largely a matter of embedding `maplibre-versatiles-styler`, which already works.
D3 is new construction.

**Interpretation to confirm:** how deep does "create" go? We read it as: start from a preset,
recolour globally, edit individual layers, export. Not: author a style from an empty document.

## Commitment 3 · Convert image and vector data into map tiles

|                      | Features                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Required**         | E1 (GeoJSON, NDJSON, shapefile), E2 (CSV with lon/lat), E3 (GDAL path for GeoTIFF and friends — this is the "image data" half), E7 (job queue with progress and cancellation), F2 (write the result to a container) |
| **Strongly implied** | C6 (cost estimate before a long run)                                                                                                                                                                                |
| **Stretch**          | E4 (DEM encoding and hillshade), E6 (table join for choropleths)                                                                                                                                                    |
| **Out**              | E5 (planetiler orchestration, see [Q7](decisions.md))                                                                                                                                                               |

E7 is not optional. Conversions run for minutes to hours; without a job model with progress and
cancellation, the first long run makes the app look broken.

## Commitment 4 · Edit VPL and instantly see the result

|              | Features                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Required** | C3 (live preview — this is the "instantly" half and the whole point), C4 (parse and validation errors inline at the right position), C2 (parameter forms generated from `field_meta`) |
| **Stretch**  | C1 (bidirectional node graph), C5 (recipe library), C8 (watch mode)                                                                                                                   |

**Interpretation to confirm, and it matters:** the commitment says _edit VPL_, not _node graph_. A
text editor with syntax awareness, inline errors and live preview satisfies it. The node graph (C1)
is the more impressive feature but is a large piece of new construction, and we read it as a
stretch goal rather than a deliverable. If the funder expects a graph, that needs to be said now,
not late.

---

## The dependency that saves the most work

**Commitments 3 and 4 share one engine.** E1, E2 and E3 are not separate machinery — they are the
`from_geo`, `from_csv` and GDAL operations of the pipeline. The import wizard is a guided front-end
onto a VPL pipeline that the user could equally well have typed.

Building the pipeline layer first and the import wizard as a form on top of it means:

- The wizard's preview is C3's preview. One mechanism, not two.
- Every wizard automatically has a "show me the VPL" escape hatch (G2), which also satisfies C7.
- Fixing the pipeline fixes the wizard.

Building them separately would mean writing the same conversion plumbing twice.

## Proposed order

Derived from that dependency, not from the numbering of the commitments.

| Stage | Contents                                                                                             | Delivers             |
| ----- | ---------------------------------------------------------------------------------------------------- | -------------------- |
| **0** | Tauri shell, embedded server, IPC boundary, bundled sprites and Latin glyphs, CI for three platforms | nothing user-visible |
| **1** | Cluster A plus a default render style                                                                | **Commitment 1**     |
| **2** | VPL editing, inline errors, generated parameter forms, live preview                                  | **Commitment 4**     |
| **3** | Import wizards on top of the pipeline layer, job queue, container export                             | **Commitment 3**     |
| **4** | Asset manager, style editing against the user's own layers, export                                   | **Commitment 2**     |
| **5** | Project directory (G1), Linux packaging and Homebrew cask (G3), auto-update (G4)                     | shippability         |

Commitment 2 comes last because D2 wants tiles to style, and those come from commitment 3.

Stage 5 is not polish — without a distribution path the application does not reach anyone. Per
[Q10](decisions.md), release 1 ships **Linux packages and a Homebrew cask**; Windows and Apple
notarisation are deferred. That removes the long procurement lead time from the critical path, at
the price of a one-time Gatekeeper approval that macOS users must click through. The install
instructions have to cover that in plain language — treat it as part of stage 5, not as an
afterthought.

Ad-hoc signing on macOS still has to be configured: on Apple Silicon a binary needs at least an
ad-hoc signature to run at all.

## Explicitly out of release 1

Cluster B in full (analysis, including B2), E5 (planetiler), F3–F7 (upload, static site export,
embed snippet, image export, offline package), G6 (undo/redo), and the stretch items listed above.

Also out: **Windows builds** and **Apple Developer signing and notarisation**. Both are deferred to
a later release by [Q10](decisions.md).

B1 and B3 stay worth remembering: both are close to free by-products of `probe`, and they are the
natural first additions once the committed scope is delivered.
