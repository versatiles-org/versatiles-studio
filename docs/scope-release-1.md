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

**Settled:** "all supported formats" includes remote sources (A2). `versatiles_container` supports
HTTPS and SFTP with byte ranges, so excluding them would be an arbitrary narrowing of the word
"all".

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

**Settled:** "create" means start from a preset, recolour globally, edit individual layers, and
export. It does not mean authoring a style from an empty document — that is a cartographer's tool
(P5) and a much larger surface than the commitment implies.

## Commitment 3 · Convert image and vector data into map tiles

|                      | Features                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Required**         | E1 (GeoJSON, NDJSON, shapefile), E2 (CSV with lon/lat), E3 (GDAL path for GeoTIFF and friends — this is the "image data" half), E7 (job queue with progress and cancellation), F2 (write the result to a container) |
| **Strongly implied** | C6 (cost estimate before a long run)                                                                                                                                                                                |
| **Stretch**          | E4 (DEM encoding and hillshade), E6 (table join for choropleths)                                                                                                                                                    |
| **Out**              | E5 (planetiler orchestration — dropped outright, not deferred; see [Q7](decisions.md))                                                                                                                              |

E7 is not optional. Conversions run for minutes to hours; without a job model with progress and
cancellation, the first long run makes the app look broken.

## Commitment 4 · Edit VPL and instantly see the result

|              | Features                                                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Required** | C1 (bidirectional node graph ⟷ VPL text), C3 (live preview — this is the "instantly" half and the whole point), C4 (parse and validation errors inline at the right position), C2 (parameter forms generated from `field_meta`) |
| **Stretch**  | C5 (recipe library), C8 (watch mode)                                                                                                                                                                                            |

**Settled ([Q11](decisions.md)):** the commitment is read as **node graph plus text editor**, not
text editor alone. C1 is a deliverable, not a stretch goal.

**This is the most expensive single item in release 1**, and not for the reason the catalogue
suggests. Parsing VPL is solved — `VPLPipeline` implements `FromStr`. Writing it back is not:

- there is **no serialiser** on `VPLNode`/`VPLPipeline`, only `Debug`;
- `properties` is a `BTreeMap`, so a round-trip **reorders parameters alphabetically**;
- the parser **discards `#` comments**.

So the graph cannot regenerate text from the AST without silently reformatting the user's file and
deleting their comments. It has to edit the text through span-based edits over a lossless syntax
tree, which is real new construction and preferably lands upstream in `versatiles_pipeline`. C4
depends on the same work: the parser reports errors as rendered strings via nom's `convert_error`,
and carries no structured positions to hang an editor marker on.

Plan stage 2 around that syntax tree first, then the graph on top of it.

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

| Stage | Contents                                                                                                | Delivers             |
| ----- | ------------------------------------------------------------------------------------------------------- | -------------------- |
| **0** | Tauri shell, embedded server, IPC boundary, bundled sprites and Latin glyphs, CI for Linux and macOS    | nothing user-visible |
| **1** | Cluster A plus a default render style                                                                   | **Commitment 1**     |
| **2** | Lossless VPL syntax tree, node graph, inline errors, generated parameter forms, live preview, undo/redo | **Commitment 4**     |
| **3** | Import wizards on top of the pipeline layer, job queue, container export                                | **Commitment 3**     |
| **4** | Asset manager, style editing against the user's own layers (on stage 2's undo stack), export            | **Commitment 2**     |
| **5** | Project directory (G1), Linux packaging and Homebrew cask (G3), auto-update (G4)                        | shippability         |

Commitment 2 comes last because D2 wants tiles to style, and those come from commitment 3.

**Stage 2 is now the long pole.** [Q11](decisions.md) makes the node graph a deliverable, and the
lossless VPL syntax tree it needs has to be built before the graph can edit anything. Start that
work early — ideally as an upstream contribution to `versatiles_pipeline` during stage 1, so the
review cycle overlaps with cluster A rather than following it.

**Undo/redo (G6) is in stage 2, not after release 1.** A node graph invites experimentation, and
experimentation without undo is punishing — dragging a connection to the wrong node has to be
recoverable. Doing it here rather than later is also the cheap moment: stage 2 already has to route
every graph interaction through a small set of text edits over the syntax tree, and that edit list
_is_ the command stack. Retrofitting undo onto an editor built without it means finding every
mutation path afterwards.

Note what this does and does not deliver. G6 is specified as undo/redo "across pipeline and style
edits", and style editing does not exist until stage 4. So stage 2 delivers the command stack and
pipeline undo; **stage 4 has to put style edits on the same stack** rather than inventing a second
one. That is a constraint on how the style editor is built, and it belongs in stage 4's plan.

Stage 5 is not polish — without a distribution path the application does not reach anyone. Per
[Q10](decisions.md), release 1 ships **Linux packages and a Homebrew cask**; Windows and Apple
notarisation are deferred. That removes the long procurement lead time from the critical path, at
the price of a one-time Gatekeeper approval that macOS users must click through. The install
instructions have to cover that in plain language — treat it as part of stage 5, not as an
afterthought.

Ad-hoc signing on macOS still has to be configured: on Apple Silicon a binary needs at least an
ad-hoc signature to run at all.

## Explicitly out of release 1

Cluster B in full (analysis, including B2), F3–F7 (upload, static site export, embed snippet, image
export, offline package), and the stretch items listed above.

Also out: **Windows builds** and **Apple Developer signing and notarisation**. Both are deferred to
a later release by [Q10](decisions.md).

**Dropped rather than deferred:** E5 (planetiler orchestration). [Q7](decisions.md) closes it as a
no — it is not on a later roadmap either.

B1, B2 and B3 stay worth remembering, and are cheaper than this document previously assumed: per
[Q12](decisions.md) the per-layer byte breakdown already exists upstream in `tile_breakdown.rs`, so
the remaining work is visualisation rather than analysis. They are the natural first additions once
the committed scope is delivered.
