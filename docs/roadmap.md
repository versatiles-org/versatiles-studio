# Roadmap

> Stages, not dates. Feature IDs refer to the [Feature Catalogue](features.md).

**The work is defined by four funding milestones (M1–M4)**, not by us. The stages and items live in
the scope documents and are not repeated here; this is the shape around them.

| Release                         | What it is                                         | State                                |
| ------------------------------- | -------------------------------------------------- | ------------------------------------ |
| [Release 1](scope-release-1.md) | M1–M4: open, edit, convert, style, ship            | Every item done bar six stretch ones |
| [Release 2](scope-release-2.md) | Style modes: the four kinds of tileset people open | Done                                 |
| [Release 3](scope-release-3.md) | One window, one project, and a launcher of its own | Done                                 |

Shipped so far: `v0.1.0` and `v0.2.0`, both alpha. **1.0 and the public announcement land together**
([Q8](decisions.md)) — the journalism audience should not meet Studio before it can create anything.

An earlier plan put analysis (cluster B) in stage 2 as the cheapest useful work. The funded scope
reverses that ([Q2](decisions.md)).

## Platforms

- **Linux and macOS** via a Homebrew cask ([Q10](decisions.md)).
- **Windows and Apple notarisation are deferred**, keeping certificate procurement off the critical
  path. The cost is a Gatekeeper dialog macOS users click through once, so the install instructions
  are part of the deliverable.

## Next

The cheapest valuable additions, in order:

- **Apple Developer signing and notarisation** — removes the Gatekeeper dialog and opens the door to
  the official `homebrew-cask` repository. $99/year; the lead time is account approval.
- **Windows builds and a certificate** — OV, EV, or Azure Artifact Signing. Get quotes first
  ([Q10](decisions.md)).
- **B1, B2, B3** — tile size statistics, byte breakdown, spec validation with a repair button.
  Cheaper than once assumed: the per-layer breakdown exists and the size scan is index-only
  ([Q12](decisions.md)). Only B2's per-attribute split is new analysis work.
- **F5, F4** — embed snippet and static site export. Without these, a user who has made a map still
  has to ask us what to do next.

## Later

- **The six stretch items release 1 did not reach** — S2.10 and S2.11 (recipe library, watch mode),
  S3.8 and S3.9 (DEM workflow, table joins), S4.9 and S4.10 (accessibility checks, glyphs from own
  fonts). A stretch item is scoped into a release and cut first if time runs out, so it lands at the
  top of this list rather than at the bottom.
- **B4, B5** — coverage gaps and container diff, valuable once people rebuild data sets regularly.
- **D7** — legends. Explicitly **out** of release 1, unlike the D-cluster stretch items.
- **F3, F6, F7** — upload targets, print-quality image export, offline packages.

## Deliberately open-ended

B6, B7, B8, B9, D4. All valuable, none blocking. Revisit once real users tell us which they miss.

E5 (planetiler orchestration) is **not** on this list — [Q7](decisions.md) drops it outright rather
than deferring it.
