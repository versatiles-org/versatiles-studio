# Architecture

> Draft. The core idea is settled enough to build on; the shell question (Q1) is not.

## The central idea

```
┌─────────────────────────────────────────────────────────┐
│  Shell (Tauri)                                          │
│  native file dialogs · drag & drop · menus · updates    │
│  ┌───────────────────────────────────────────────────┐  │
│  │  UI (web: Svelte + MapLibre GL)                    │ │
│  │  layer stack · node graph · style editor · charts  │ │
│  │        │                          ▲                │ │
│  │        │ commands / IPC           │ tiles via HTTP │ │
│  └────────┼──────────────────────────┼────────────────┘ │
│           ▼                          │                  │
│  ┌────────────────────┐   ┌──────────┴───────────────┐  │
│  │  Studio core (Rust)│──▶│  embedded tile server    │  │
│  │  project · jobs    │   │  (versatiles serve, local)│ │
│  └─────────┬──────────┘   └──────────────────────────┘  │
│            ▼                                            │
│  versatiles-rs crates: container · pipeline · geometry  │
└─────────────────────────────────────────────────────────┘
```

The load-bearing decision is the **embedded tile server**. Instead of pushing tile bytes through
IPC into the webview, Studio runs `versatiles serve` on localhost against the *current* pipeline
state and lets MapLibre fetch tiles over HTTP as it normally would.

This buys a great deal:

- Live preview (C3) becomes almost free: change a pipeline parameter, re-point or invalidate the
  source, MapLibre re-fetches. There is no separate "build" step to design.
- MapLibre stays completely standard — no custom protocol handler, no bespoke tile plumbing.
- The same UI works unchanged when served from a real server, which is what keeps Q1 open.
- Existing pieces (`@versatiles/svelte`, `maplibre-versatiles-styler`, `versatiles-frontend`) drop
  in without modification, because they already expect an HTTP tile source.

Cost to watch: cache invalidation on every pipeline edit, and binding to a random free port
without tripping firewall prompts or exposing the port beyond loopback.

## Layers

**Shell (Tauri).** Native window, menus, file dialogs, drag & drop, file type associations,
auto-update. Deliberately thin — see Q1.

**UI (web).** Svelte, matching the rest of the org. MapLibre GL for the map canvas. Consumes the
core through a typed command interface and consumes tiles over HTTP.

**Studio core (Rust).** The part worth designing carefully:

- *Project model* — sources, pipeline, style, views; serialised to the project file (G1)
- *Job runner* — long operations with progress, cancellation and logging (E7); this must exist
  before any export feature, not after
- *Analysis services* — the probe-derived statistics behind cluster B, cached per container
- *Server manager* — lifecycle of the embedded server, one instance per previewed pipeline node

**versatiles-rs.** Consumed as a library dependency, not shelled out to. Studio should be a
first-class consumer of the crates, and pressure to improve their APIs is a welcome side effect.

## Principles

**The text is the source of truth.** The VPL text, the style JSON and the project file are the
real artefacts; the node graph, the style panels and the layer tree are views onto them. This is
what makes projects diffable, reviewable, git-friendly and handable to a CLI user. It also removes
a whole class of "the GUI and the file disagree" bugs.

**Generate UI from metadata where possible.** Parameter forms come from `field_meta`
([see inventory](ecosystem.md)). Hand-written UI per operation would rot the first time
versatiles-rs adds an operation.

**Every action names its command.** G2 is an architectural constraint, not a feature: if an action
cannot be expressed as a command, it probably should not exist.

**Nothing only exists inside Studio.** Every artefact must be exportable in a documented format.

## Open architectural questions

Detailed in [Open Decisions](decisions.md); summarised here.

**Q1 — Tauri app, or `versatiles studio` subcommand serving a browser UI?**
The subcommand route avoids code signing, installers and auto-update entirely, works over an SSH
tunnel on the server where the 500 GB file actually lives, and makes the UI reusable in
`versatiles-frontend-dev`. The Tauri app wins on double-click-to-open, drag & drop, native
dialogs, and being findable as an application. **Proposal: one web UI, two shells** — adopt that as
a design constraint from day one even if only the Tauri shell ships first. It costs little now and
is expensive to retrofit.

**Q3 — How does the UI talk to the core?** Tauri IPC commands are the obvious answer but tie the
UI to Tauri, which conflicts with Q1. A local HTTP/JSON API used by both shells is more portable
and more testable, at the price of some ceremony.

**Q4 — Where do the analysis statistics live?** Scanning a large container is expensive.
Options: compute on demand with an in-memory cache, persist a sidecar cache next to the container,
or store results in the project file. Affects how B1–B5 feel in practice.

**Q5 — Node integration.** `versatiles-svg-renderer` and parts of the style tooling are Node/JS.
Do we bundle a Node runtime, port the pieces to Rust, or accept that some features only work when
Node is installed? Affects F6 in particular.
