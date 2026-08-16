# Decisions

Questions still open, then decisions taken. When a question is answered it moves down with a date
and a rationale. Evidence for the upstream claims below lives in the
[Ecosystem Inventory](ecosystem.md); this file records what we decided and why.

---

## Open questions

None. New questions get a `Q` number here, and move to **Decided** once settled.

---

## Decided

All dated 2026-08-16.

### Q18 — Studio's Svelte components are written from scratch

Studio does not depend on `@versatiles/svelte`. Its code is a **reference to read, not a package to
import**.

**Why.** Studio's shell has requirements no other consumer has: one `Map` instance owned by the Rust
core and restored from it ([Q16](decisions.md)), panes that reconfigure per mode, a graph pane that
edits text through a syntax tree. Adapting a library built for embedding single maps in pages would
constrain all of that, and the coupling would run both ways — Studio's needs would start distorting a
library other projects depend on.

**What we accept.** The org already has `InputRow.svelte` byte-identical in three repositories and
Studio makes a fourth. That duplication is real, and it is not Studio's to fix.

**Three solved problems to copy deliberately rather than rediscover.** All are cheap to carry over
and expensive to hit blind:

- **MapLibre 6's worker cannot be bundled naively.** Since v6 the worker loads from a separate file
  via `import.meta.url`, which stops resolving once a bundler inlines `maplibre-gl.mjs`. The fix is a
  build step that bundles the worker into the app from the installed `maplibre-gl`, referenced with a
  plain `new URL(…, import.meta.url)` — a Vite-only `?worker&url` import breaks Vite's own dependency
  pre-bundling. It also requires pinning `maplibre-gl` exactly, so worker and main thread match. See
  `node-versatiles-svelte/scripts/bundle_worker.ts`.
- **`BBoxDrawer`** (227 lines) is drag-to-draw bbox selection on a MapLibre map — most of F2 (S5.4).
- **The styler's `defaultValue` / `isModified` input pattern**, which shows whether a value differs
  from its default. That matters more in Studio than anywhere else, because `VPLFieldMeta` carries no
  defaults at all.

### Q17 — A3, the multi-source layer stack, is dropped

No stacking several containers in one view with opacity, swipe and split. Dropped, not deferred.

[Q14](decisions.md) removed the sources strip from Explore, leaving A3 — a stretch item — with
nowhere to live. [Q16](decisions.md) mostly replaces it: one window per project means comparing two
containers is two windows side by side. Not a swipe, but free and the platform convention.

**Release 1 therefore has no comparison view at all.** C3 is not one — it shows the selected node's
output on one map. **B5 (container diff) is the first feature needing two, and it is post-1.0**, so a
swipe/split control can be designed then. Release 1 needs exactly one live `Map` per project.

**Given up:** two unrelated containers overlaid with opacity. P3 would have wanted it; if genuinely
missed it returns as a map control, not a panel.

### Q16 — One application instance, one window per project

Not tabs, not separate application instances.

|                    | App instance           | **Window**                       | Tab              |
| ------------------ | ---------------------- | -------------------------------- | ---------------- |
| Webview processes  | N                      | N                                | 1                |
| Rust cores         | N                      | **1**                            | 1                |
| WebGL budget       | 16 each                | **16 each**                      | 16 _total_       |
| Crash blast radius | 1 project              | **1 project**                    | **all projects** |
| Asset manager (G7) | N writers, needs locks | **single writer**                | single writer    |
| Job queue (E7)     | fragmented             | **unified**                      | unified          |
| macOS conventions  | wrong                  | **⌘N, Window menu, full screen** | non-native       |

**Tauri already gives us the isolation.** Every webview is a separate OS process and the docs name
fault isolation as the point, with the core able to restart one that goes invalid. So a window per
project buys isolation we would otherwise engineer, and a second application instance buys nothing
beyond it while costing a second core.

**WebGL is headroom, not a decider.** Chrome and WebKit allow ~16 contexts and silently discard the
oldest past that. The original argument assumed two or three maps per project; after
[Q17](decisions.md) it is one, so even ten projects sit under the cap. Separate budgets are worth
having for free, but the decision rests on isolation and the single core.

**The server does not need duplicating.** `add_tile_source` / `remove_tile_source` work on a running
server, and the config mounts many named sources at once.

**Consequences.**

- **One embedded server for the whole application**, mounts named per project and per preview node —
  correcting [Architecture](architecture.md).
- **Nothing may live only in the webview**, so a crash is recoverable by reloading that one window.
  Promoted to an architectural principle. MapLibre's own recovery is imperfect — context loss before
  style load throws (maplibre-gl-js #7022), events fire after `Map#remove` (#726) — which is why the
  reload path matters more than prevention.
- **Destroy `Map` instances that are not visible.** Not pressing at one map per project, but the
  ceiling discards the context you looked at _first_, so establish the habit before B5.
- **The landing screen is what an empty window shows** ([Q13](decisions.md)); ⌘N opens another.
- **Measure the per-webview baseline at S0.8.** No trustworthy figure exists for our bundle. If it is
  prohibitive the fallback is tabs plus aggressive `Map` disposal — worse isolation, same
  correctness.

### Q13 — Studio is a workbench. New projects start from a landing screen

The workbench-versus-P1 tension resolves for the workbench: `vision.md` stands unamended, there is no
simplified mode, and P1 is expected to cope. New projects open on a **landing screen** — a launcher,
not a wizard.

- **The P1 risk is accepted, not overlooked.** `audiences.md` warns "a rough edge a developer shrugs
  off will stop a journalist entirely". The mitigation is polish and good defaults. If P1 adoption
  stalls, this is the first decision to revisit.
- **The landing screen exists from stage 1**, not stage 3 — Studio must show something when it opens
  with no project. It starts as open-a-container plus recents (A7) and gains cards as clusters land.
- **It never gates anything.** Everything on it is also reachable from inside the workbench. A
  launcher that becomes a required first step is a wizard by another name.

### Q14 — Explore and Pipeline stay separate modes

Different activities: Explore is consumption, Pipeline is production. Collapsing them saves a mode at
the cost of muddying both.

**Consequence for the Sources panel — settled after two revisions.** First reading: shared, meaning a
view stack in Explore and an input list in Pipeline — rejected, because a panel that changes meaning
by mode reads as a bug. Second: Pipeline only. Final: **there is no sources pane at all.** Sources
are the `from_*` read nodes at the head of the pipeline, so the graph already shows them and a
separate list duplicated them. "+ Add source" adds a read node.

Two things follow. Explore keeps no left pane, which is what left A3 homeless and led
[Q17](decisions.md) to drop it. And the layout settles into **left is structure, right is
parameters** — Pipeline's graph and Style's layer tree occupy the same pane, and Explore and Publish
have no structure to navigate, so the map runs wide.

### Q15 — The pipeline pane tabs between graph and text

One pane, two tabs: **Graph** and **VPL**, not side by side. This also settles the small-screen
question — the layout no longer needs ~1400 px, so no drawer is required.

Side-by-side existed so a user could see graph and file agree, so the tabs owe that back:

- **Selection survives the switch** — select a node, switch to VPL, land on its span, and back. This
  is what makes two tabs feel like one document.
- **The Graph tab never shows a stale graph** — a parse failure is shown, not the last good render.
- **The VPL tab carries an error badge** when parsing or validation fails (C4).
- **Switching is free** — no reparse, no lost cursor or scroll; both are views over one syntax tree.

### Q11 — The node graph (C1) is in release 1, and needs a lossless VPL syntax tree

M4 means **node graph plus text editor**, not text editor alone. C1 becomes a deliverable
and stage 2 is planned around it.

The catalogue assumed C1 was cheap because "the parser exists". It parses, but it cannot write back:
no serialiser, `properties` is a `BTreeMap` so a round-trip reorders parameters alphabetically, and
`#` comments are discarded ([details](ecosystem.md#3-the-vpl-parser-only-runs-one-way)).

So the graph must edit the text through **span-based edits over a lossless syntax tree**, not by
reparsing and printing. Regenerating from the AST would reformat the user's file and delete their
comments on every interaction — the exact "GUI and file disagree" bug the source-of-truth principle
exists to prevent. This is the largest piece of new construction in release 1.

Build it upstream in `versatiles_pipeline` if possible: a lossless parse and a formatter help the
CLI too, and it keeps one grammar. Studio carrying it is the fallback; a second divergent VPL
grammar is not.

**Consequence — undo/redo (G6) moves into stage 2**, from post-release. Stage 2 already turns every
graph interaction into a small text edit, and that edit list is the command stack, so undo is cheap
now and expensive to retrofit. G6 covers pipeline _and_ style edits, so stage 2 delivers the stack
plus pipeline undo, and **stage 4 must put style edits on the same stack**.

### Q4 — Analysis statistics live in memory, keyed by container identity

No sidecar files, no results in the project file. Scanning is not one cost but three, and only the
third needed solving:

| Tier                                  | Cost                                                          | Feeds      |
| ------------------------------------- | ------------------------------------------------------------- | ---------- |
| Metadata and real zoom range          | Free — `tile_pyramid()` reads the block index and is memoised | A6         |
| Tile sizes and coverage               | Index-only — all five readers override `tile_size_stream`     | B1, B4     |
| Tile contents (validation, breakdown) | Expensive, but `probe --sample PERCENT` bounds it             | B2, B3, B7 |

The first two are too cheap to be worth persisting. The third samples by default; a full scan is an
explicit, cancellable job (E7).

- **Not a sidecar** — containers are often read-only, remote (A2), or shared. Writing next to
  someone's data is sometimes impossible and always surprising.
- **Not the project file** — it would churn a file promised to be diffable, and a project can
  reference a container it does not own.
- **If measurement later demands persistence**, use a content-addressed cache in the OS cache
  directory, for full scans only.

**Design around:** probe computes and renders at once (`&mut PrettyPrint` in, `Result<()>` out), so
Studio aggregates over `layer_stats()` and `validate_tile()` instead. A compute/render split
upstream would give the CLI a `--json` probe for free.

### Q7 — No `planetiler` orchestration. E5 is dropped

Closed as **no**, permanently rather than deferred.

**Cost.** Java 21+, 0.5× the PBF size in RAM, 5–10× on disk, ~1 GB of auxiliary downloads before the
first run. Detecting an existing JVM makes the feature invisible to the audience that needs it;
bundling one adds 50–190 MB to ship, sign and update; Docker is absent in the public administrations
this targets. `shortbread-tilemaker` is no lighter — Lua config for a separate C++ binary.

**Instead:** document the CLI route. Planet-scale OSM builds run on servers, not on the laptop
Studio is installed on, and Studio opens and styles the result either way.

**What it costs us:** the catalogue called E5 "potentially the decisive feature for P2". That stays
untested. Revisit if P2 users say the OSM build is the blocker — with evidence, not a guess.

### Q12 — Cluster B stays out of release 1, but is cheaper than the catalogue says

Scope holds; the estimate behind it was wrong. `tile_breakdown.rs` already computes B2's per-layer
byte breakdown and `probe -ddd` aggregates it by zoom × layer. Only the **per-attribute** split and
a data-returning API are missing.

So B1, B2 and B3 after release 1 are mostly **visualisation over existing numbers**, not analysis —
which strengthens the case for taking them first. Not pulled in now because Q2 already flags four
clusters as a wide front and Q11 just added the node graph to it.

### Q8 — Release early under v0.x, aimed at the tile audience

Ship `v0.x` from stage 1; reserve the announcement for when all four milestones are in.

**Releasing early is house style.** Every versatiles repository that ships started small:
`versatiles-rs` v0.5.8 → v4.7.0 across 100 releases, `versatiles-style` 78, `versatiles-frontend`
46, `maplibre-versatiles-styler` 18. The only two with no releases are the two not yet usable.

**But the framing matters.** If the first public build is a viewer, Studio gets categorised as "a
tile viewer", and first categorisations stick. So:

- GitHub releases only, no announcement campaign.
- A `versatiles-choro`-style "under development" banner stating what works and what does not.
- Early audience is P3 and ourselves — they tolerate rough edges and file good bug reports.
- 1.0 and the announcement land together.

**Why not stay silent entirely:** the macOS Gatekeeper path (Q10) cannot be tested by reading our
own instructions, and malformed containers in the wild cannot be manufactured. Better to learn both
at v0.2 with sympathetic users. The funding agreement requires no public milestones, so this is our
call.

### Q6 — A project is a directory of real files with a YAML manifest

```text
MyProject/
  project.yaml     manifest: sources, views, references to the files below
  pipeline.vpl     a real VPL file
  style.json       a real MapLibre style
```

**Reference, do not embed.** The ecosystem already chose this: `versatiles serve` config lists
sources as `src: pipeline.vpl` and resolves relative paths against the config directory. So a Studio
pipeline runs unchanged under `versatiles convert`, and a Studio style loads unchanged in MapLibre.
Embedding VPL — a text DSL — in JSON would mean escaped newlines and unreadable diffs.

**YAML**, because `versatiles serve --config` already is. It permits comments, which matters for a
hand-editable file. TOML was rejected as a second format and awkward for nested source lists; JSON
for having no comments. YAML's footguns are accepted since Studio mostly reads its own output.

**`project.yaml` cannot double as a serve config:** `versatiles/src/config/main.rs` sets
`#[serde(deny_unknown_fields)]`, so any Studio key invalidates it. Studio exports a serve config as
a derived artefact instead (C7). _Worth raising upstream:_ an ignored `x-` namespace would let one
file serve both purposes.

**Design for:** a project is a folder, so sharing means sending one — offer zip/unzip and a
"Save As" that copies the whole directory.

### Q3 — Three planes: IPC for control, HTTP for data, Channels for events

| Plane       | Carries                                                      | Mechanism                |
| ----------- | ------------------------------------------------------------ | ------------------------ |
| **Control** | open a container, read metadata, list operations, start jobs | Tauri IPC commands       |
| **Data**    | tiles, glyphs, sprites                                       | the embedded HTTP server |
| **Events**  | job progress, warnings, log lines                            | Tauri Channels           |

**Forced, not stylistic.** Tauri serialises command returns as JSON and its own v2 docs warn this is
slow for large payloads, so tile bytes must not travel over IPC. Channels are Tauri's recommended
streaming mechanism, which is what the job runner (E7) needs. For a one-off blob — a raw tile for
A4 — `tauri::ipc::Response` returns an array buffer without JSON.

**The core sits below the commands:** a plain Rust library with no Tauri types, so it is testable
without a Tauri runtime. `versatiles_node` demonstrates the shape — `TileServer`, `TileSource` and a
`Progress` class carrying `onProgress`/`onMessage` map closely onto the control and event planes.
Mirror its vocabulary rather than inventing a second one.

**Types across the boundary:** [`tauri-specta`](https://github.com/specta-rs/tauri-specta) generates
TypeScript from the Rust definitions, for commands and events. Community-maintained, so hand-written
types are the fallback — but two hand-kept copies of the command surface is exactly the drift the
generated-UI principle exists to avoid.

**Consequence:** the embedded server is load-bearing, its lifecycle is a core service, loopback
only.

### Q10 — Release 1 ships Linux packages and a Homebrew cask; signing comes later

Windows and a paid Apple Developer identity are deferred — buying an early release for some macOS
friction, and keeping recurring costs and procurement lead times off the critical path.

**Linux.** No signing. Ship Tauri's outputs from GitHub releases — with an AppImage alongside the
`.deb`, since a `.deb` built against one WebKitGTK version may not install across distributions.

**macOS via our own tap.** Three things to design around:

- Homebrew's cask signing audit is **skipped for third-party taps** (`audit.rb` returns early unless
  the tap is official), so an unsigned cask in `versatiles-org/homebrew-versatiles` passes.
  Submitting to official `homebrew-cask` should wait until we notarise.
- Homebrew still **applies quarantine**, and as of 6.0.15 there is no `--no-quarantine` flag or
  opt-out variable. Users approve once under System Settings → Privacy & Security, or run
  `xattr -d com.apple.quarantine`.
- Tauri's ad-hoc signing must still be configured — on Apple Silicon a binary needs at least an
  ad-hoc signature to execute at all.

**Cost to accept:** macOS users meet a security dialog before first launch, and it lands hardest on
P1, who skew towards Macs. The plain-language install instructions are the deliverable here, not the
packaging.

**Revisit after release 1:** the Apple Developer account ($99/year; the lead time is approval, not
the money) and the Windows certificate route — OV, EV, or Azure Artifact Signing. Get quotes first;
certificates issued after 1 June 2023 need hardware-token or HSM storage, which complicates CI.

### Q2 — Scope of release 1 is set by the funding milestones

Analysis audience or creation audience first? Moot — the four milestones are funded, spanning
clusters A, D, E and C, and **cluster B is not in scope**, reversing the earlier roadmap. Four
independent sources agree with them:

- **Who uses VersaTiles** — of 76 showcase projects, 24 are tagged `journalism`, 16
  `data-visualisation`, 7 `storytelling`; at least 21 come from news organisations, 37 from Germany.
  Caveat: the gallery only records public web maps, so it under-counts tile operators.
- **What people ask for** — the documentation backlog is almost entirely creation workflows.
  Analysis demand is quieter and phrased as CLI ergonomics.
- **What gets used** — `@versatiles/style` sees 53,183 npm downloads a year, an order of magnitude
  above anything else. `versatiles-rs` has 13,294 release downloads; `versatiles-frontend` 6,367.
- **What it costs** — share of features per cluster building on existing machinery: B 89%, E 86%,
  F 86%, C 75%, A 63%, G 57%, D 56%. This measures whether an _engine_ exists, not total effort —
  cluster E's engines exist but its wizard UI is the expensive part.

**Risk to watch.** Four clusters is a wide front, and the two most expensive by reuse ratio (D 56%,
A 63%) are both in it. Hence the minimum reading of each milestone in the scope document.

### Q9 — Fonts and sprites are fetched per family, and never unpacked

`frontend-blank` is not used as a single bundle; `versatiles-fonts` already publishes one archive
per family. Three tiers instead ([numbers](ecosystem.md#map-assets-fonts-and-sprites)):

| Tier           | Contents                                        | Size         | When                               |
| -------------- | ----------------------------------------------- | ------------ | ---------------------------------- |
| **Bundled**    | Sprites (1.3 MB) + Latin-only Noto Sans (~1 MB) | ~2.5 MB      | in the installer                   |
| **On demand**  | One family from `versatiles-fonts` releases     | 1–45 MB each | when a style needs it              |
| **Everything** | `fonts.tar.gz`, all families                    | 107 MB       | explicit action, for offline/field |

- **Works offline from first launch** — no 109 MB wall before the user has seen a map, and the
  empty-glyph-tile trick renders non-Latin text blank rather than erroring.
- **Per-family beats all-or-nothing** — picking Roboto downloads 3 MB, not 109 MB.
- **Archives are served, never unpacked**, which is why each asset stays atomic to verify and
  delete.

Consequences:

- An **asset manifest** pinning version and checksum per family (G7) — and sprites come from a
  `versatiles-style` **prerelease** channel, so pin deliberately.
- B8 must distinguish "empty glyph tile by design" from "family not installed".
- G5 becomes "no network requirement _after_ the assets you chose are installed".
- F4 and F7 need the full tier, so the asset manager is their prerequisite.

Locally generated glyphs (D9) are complementary: they add fonts the releases lack, through the same
archive format, manifest and serving path.

### Q1 — VersaTiles Studio is a native Tauri application

Not a subcommand serving a browser UI. Native file dialogs, drag & drop, file type associations and
being findable as an application outweigh the alternative.

**In exchange:** signing and notarisation costs (G3), building auto-update ourselves (G4), no path
for running Studio on the remote server holding a very large file, and no UI reuse inside
`versatiles-frontend-dev`.

### Q5 — No Node runtime is shipped

Every JavaScript library Studio needs runs in the browser, so all of it is bundled into the webview
at build time. Node stays a build-time dependency (npm, Vite).

Checked individually: `@versatiles/style` and `maplibre-versatiles-styler` are browser libraries;
`@versatiles/svelte` is a Svelte component library; `@versatiles/svg-renderer` ships a UMD bundle
and a `/maplibre` subpath, so F6 runs in the webview.

**Consequence:** SVG export (F6) is bounded by what the webview can render. Headless or batch image
export has no path here — acceptable, since it is not a v1 goal.

### Build on the existing `versatiles-studio` repository

The previous contents were a Tauri 1 + Svelte 4 template from January 2024 with no substantive code.
Removed; the history remains in git. Repository name, GitHub project and `app-icon.png` were kept.

### Planning documents in English

Consistent with every other repository in versatiles-org, and readable by potential contributors.
Working discussions continue in German.
