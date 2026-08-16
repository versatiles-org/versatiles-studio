# Roadmap

> Stages, not dates. Feature IDs refer to the [Feature Catalogue](features.md).

**Release 1 is defined by the funding commitment**, not by us. Its stages live in
[Release 1 Scope](scope-release-1.md); this document holds the shape of the release and everything
after it.

An earlier version of this roadmap put analysis (cluster B) in stage 2 on the grounds that it was
cheapest and immediately useful to us. The funded scope reverses that: B is out of release 1
entirely. See [Q2](decisions.md) for the decision and the evidence behind it.

## Release 1

| Stage | Contents                                                                                             | Delivers                                     |
| ----- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **0** | Tauri shell, embedded server, IPC boundary, bundled sprites and Latin glyphs, CI for Linux and macOS | foundation                                   |
| **1** | Cluster A plus a default render style                                                                | Open and preview all supported formats       |
| **2** | VPL editing, inline errors, generated parameter forms, live preview                                  | Edit VPL and instantly see the result        |
| **3** | Import wizards on the pipeline layer, job queue, container export                                    | Convert image and vector data into map tiles |
| **4** | Asset manager, style editing against the user's own layers, export                                   | Create your own map style                    |
| **5** | Project directory, Linux packaging and Homebrew cask, auto-update                                    | shippability                                 |

Per [Q8](decisions.md), stages 1 onward ship as `v0.x` releases with an honest "under development"
banner, aimed at tile operators and ourselves. **1.0 and the public announcement land together**,
when all four commitments are in — the journalism audience should not meet Studio before it can
create anything.

Two things worth repeating from the scope document, because they drive the whole plan:

- **Commitments 3 and 4 share one engine.** The import wizards are guided front-ends onto
  `from_geo`, `from_csv` and GDAL — the same pipeline layer the VPL editor drives. Build the
  pipeline first and the wizards become a form on top of it, with their preview already solved.
- **Release 1 is Linux plus a Homebrew cask** ([Q10](decisions.md)). Windows and Apple notarisation
  are deferred, which keeps certificate procurement off the critical path. The cost is a Gatekeeper
  approval that macOS users have to click through once, so the install instructions are part of the
  deliverable.

## Immediately after release 1

The cheapest valuable additions, in the order we would take them:

- **Apple Developer signing and notarisation** — removes the Gatekeeper dialog that release 1
  leaves in place, and opens the door to submitting to the official `homebrew-cask` repository
  rather than only our own tap. $99/year; the lead time is account approval, not the money.
- **Windows builds and a certificate** — OV, EV, or Azure Artifact Signing. See
  [Q10](decisions.md); get quotes before committing.
- **B1, B3** — tile size statistics and spec validation with a repair button. Both are close to
  free by-products of `probe`, and B3 turns a `fix:` line that already exists into a button.
- **B2** — byte breakdown per layer and attribute. The feature catalogue's strongest
  differentiator, deferred but not abandoned.
- **F5, F4** — embed snippet and static site export. Without these, a user who has made a map in
  Studio still has to ask us what to do next.
- **G6** — undo/redo, which will be conspicuously missing the moment style editing gets real use.

## Later

- **B4, B5** — coverage gaps and container diff, which become valuable once people rebuild data
  sets regularly.
- **D5, D6, D7, D9** — dark variants, accessibility checks, legends, glyph generation from the
  user's own fonts.
- **E4, E6** — DEM and hillshade, table joins for choropleths.
- **F3, F6, F7** — upload targets, print-quality image export, offline packages.
- **C1** — the node graph, if the text editor turns out not to be enough.

## Deliberately open-ended

E5 (planetiler orchestration, see [Q7](decisions.md)), B6, B7, B8, B9, C5, C8, D4. All valuable,
none blocking. Revisit once real users are telling us which ones they miss.
