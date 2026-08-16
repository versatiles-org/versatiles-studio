# Roadmap

> Stages, not dates. Feature IDs refer to the [Feature Catalogue](features.md).

**Release 1 is defined by four funding milestones (M1–M4)**, not by us. Their scope, the six stages
and the work items live in
[Release 1 Scope](scope-release-1.md) and are not repeated here. This document covers how release 1
ships, and what comes after it.

An earlier version put analysis (cluster B) in stage 2 as the cheapest useful work. The funded scope
reverses that — see [Q2](decisions.md).

## How release 1 ships

Per [Q8](decisions.md), stages 1 onward ship as `v0.x` releases with an honest "under development"
banner, aimed at tile operators and ourselves. **1.0 and the public announcement land together**,
when all four milestones are in — the journalism audience should not meet Studio before it can
create anything.

Release 1 targets **Linux and macOS** via a Homebrew cask ([Q10](decisions.md)). Windows and Apple
notarisation are deferred, keeping certificate procurement off the critical path; the cost is a
Gatekeeper approval macOS users click through once, so the install instructions are part of the
deliverable.

## Immediately after release 1

The cheapest valuable additions, in order:

- **Apple Developer signing and notarisation** — removes the Gatekeeper dialog and opens the door to
  the official `homebrew-cask` repository. $99/year; the lead time is account approval.
- **Windows builds and a certificate** — OV, EV, or Azure Artifact Signing. Get quotes first
  ([Q10](decisions.md)).
- **B1, B2, B3** — tile size statistics, byte breakdown, spec validation with a repair button.
  Cheaper than once assumed: the per-layer breakdown already exists and the size scan is index-only
  ([Q12](decisions.md)), so what remains is mostly visualisation. Only B2's per-attribute split is
  new analysis work.
- **F5, F4** — embed snippet and static site export. Without these, a user who has made a map still
  has to ask us what to do next.

## Later

- **B4, B5** — coverage gaps and container diff, valuable once people rebuild data sets regularly.
- **D5, D6, D7, D9** — dark variants, accessibility checks, legends, glyph generation from own fonts.
- **E4, E6** — DEM and hillshade, table joins for choropleths.
- **F3, F6, F7** — upload targets, print-quality image export, offline packages.

## Deliberately open-ended

B6, B7, B8, B9, C5, C8, D4. All valuable, none blocking. Revisit once real users tell us which they
miss.

E5 (planetiler orchestration) is **not** on this list — [Q7](decisions.md) drops it outright rather
than deferring it.
