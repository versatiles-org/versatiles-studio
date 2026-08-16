# Roadmap

> Draft, and downstream of [Q2](decisions.md). Stages, not dates. Feature IDs refer to the
> [Feature Catalogue](features.md).

The ordering follows one principle: **build the things whose engine already exists first.** That
front-loads visible progress, gets the tool into our own hands early, and constructs the
foundation — map canvas, layer stack, container abstraction, job runner — that every later stage
needs anyway.

## Stage 0 · Skeleton

The unglamorous part that everything rests on.

- Tauri 2 + Svelte project, with the shell kept thin
- versatiles-rs wired in as a library dependency
- Embedded server: tiles from the pipeline, plus bundled sprites and Latin glyphs served straight
  from their archives (see [Q9](decisions.md))
- Command interface between UI and core (see [Q3](decisions.md))
- CI building for all three platforms — before signing, which comes later (G3)

**Done when** a container can be opened and its tiles appear, correctly labelled, on a map in the
window.

## Stage 1 · Viewer & Inspector

- A1, A2 — open local and remote containers
- A3 — multi-source layer stack with swipe and split comparison
- A5, A7, A8 — grid overlay, recent files, feature popups
- A4 — raw MVT inspector
- A6 — metadata and TileJSON viewing

**Done when** we stop reaching for the CLI to answer "what is actually in this file?"

## Stage 2 · Analysis

The first stage that offers something no other tool does.

- B1 — tile size heat map and statistics
- B2 — byte breakdown per layer and attribute _(killer feature candidate)_
- B3 — spec validation with a repair button
- B4 — coverage gaps
- E7 — job queue, needed here first for long scans

**Done when** we can hand it to the community as something worth installing on its own.

## Stage 3 · Pipeline Editor

- C2 — parameter forms generated from `field_meta` (verify this assumption before Stage 3 starts)
- C1 — bidirectional node graph ⟷ VPL text
- C3 — live preview per node
- C4 — inline errors
- C7 — export as CLI command / `.vpl` / CI snippet
- G1 — project file, needed once there is state worth saving
- G2 — "show me the command"

**Done when** a pipeline authored in Studio runs unchanged on a server.

## Stage 4 · Style Generator

- G7 — asset manager, needed here first: a style is what makes a user want a font they do not have
- D1, D8 — embed `maplibre-versatiles-styler`, presets, recolouring, export
- D2 — derive a style from the layers actually present
- D3 — layer tree and expression editing
- D5, D6 — dark variants, accessibility checks

**Done when** a style can be built for a self-made tile set without hand-editing JSON.

## Stage 5 · Creating Data

- E1, E2 — vector and CSV import wizards with preview
- E6 — table join for choropleths
- E4 — DEM and hillshade
- E3 — GDAL formats
- B5 — container diff, which becomes valuable once we produce our own containers

**Done when** the P1 scenario in the [vision](vision.md) works end to end.

## Stage 6 · Publishing & Polish

- F1, F2 — local server, crop and export
- F3, F4, F5 — upload, static site, embed snippet
- F6, F7 — image export, offline package
- G3, G4 — signing, notarisation, auto-update
- G6 — undo/redo

**Done when** someone outside the project can go from raw file to published map without asking us
anything.

## Deliberately later

E5 (planetiler orchestration, see [Q7](decisions.md)), B6, B7, B8, B9, C5, C6, C8, D4, D7 — all
valuable, none blocking. Revisit once real users are telling us which ones they miss.
