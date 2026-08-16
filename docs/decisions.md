# Decisions

Two lists: questions still open, and decisions already taken. When a question is answered, move it
down with a date and a short rationale.

---

## Open questions

### Q2 · Which audience do we build for first?

Not a question of value but of construction order.

- **Analysis first.** Weeks rather than months, because `probe` already does the work.
  Serves us immediately, generates community feedback, and builds the foundation — map canvas,
  layer stack, container abstraction — that the pipeline editor and style generator sit on. Small
  audience.
- **Creation first.** Much larger audience and the stronger story, but far more work, a
  higher polish bar, and direct competition with QGIS, Felt and Mapbox Studio.

**Proposal.** Analysis first, explicitly as the foundation for creation later — not as a change of
target audience.

### Q3 · How does the UI talk to the core?

Reframed now that Q1 is settled: with Tauri fixed, IPC is a legitimate default rather than a
lock-in risk.

**Proposal — split the two planes:**

- _Control plane_ (open a container, run analysis, edit a pipeline, start a job) → Tauri IPC
  commands. Typed, no port to bind, no CORS, no authentication problem.
- _Data plane_ (tiles, glyphs, sprites) → the embedded HTTP server. MapLibre stays completely
  standard, and static assets are served straight from their archives.

Open sub-question: this makes the core hard to drive from tests without a Tauri runtime. Do we
care enough to keep a thin command interface that both an IPC handler and a test harness can call?
(Probably yes, and it is cheap if decided now.)

### Q4 · Where do analysis statistics live?

Scanning a large container is expensive and users will re-open the same files. On-demand with an
in-memory cache, a persisted sidecar file next to the container, or results in the project file?
Determines whether cluster B feels instant or sluggish.

### Q6 · Project file format

TOML, YAML or JSON — and does it embed the pipeline and style, or reference sibling files?
Embedding makes a project one shareable artefact; referencing keeps `.vpl` and `style.json`
editable by other tools and produces cleaner diffs.

### Q7 · Scope of `planetiler` orchestration (E5)

Requires a JVM. Do we detect and drive an existing installation, download one, or leave this out?
Potentially the decisive feature for P2, and the largest single dependency we would take on.

### Q8 · What is the smallest thing worth releasing?

Related to Q2 but distinct: what does v0.1 have to do for someone to install it a second time?

---

## Decided

### 2026-08-16 · Q9 — Fonts and sprites are fetched per family, and never unpacked

`frontend-blank` is not used as a single bundle. Three tiers instead, drawing on the fact that
`versatiles-fonts` already publishes one archive per font family. See the
[inventory](ecosystem.md#map-assets-fonts-and-sprites) for the numbers.

| Tier           | Contents                                                   | Size         | When                                           |
| -------------- | ---------------------------------------------------------- | ------------ | ---------------------------------------------- |
| **Bundled**    | Sprites (1.3 MB) + Latin-only Noto Sans glyphs (~1 MB)     | ~2.5 MB      | in the installer                               |
| **On demand**  | One font family at a time from `versatiles-fonts` releases | 1–45 MB each | when a style needs it                          |
| **Everything** | `fonts.tar.gz`, all families                               | 107 MB       | one explicit action, for offline and field use |

Why:

- **The app works offline from first launch.** No first-run download wall, no "please wait 109 MB"
  before the user has seen a map. Latin coverage handles the overwhelming majority of first
  sessions, and the empty-glyph-tile trick means non-Latin text renders blank rather than erroring.
- **Per-family granularity beats all-or-nothing.** A user who picks Roboto downloads 3 MB, not
  109 MB. `frontend-blank` only exists as a single bundle; the underlying releases are already
  split per family, so this costs us nothing but a manifest.
- **Serve archives directly, never extract.** `versatiles serve -s` reads `.tar`, `.tar.gz` and
  `.tar.br`. Avoiding 47,360 loose files matters most on Windows, and makes each asset atomic to
  verify, replace and delete.

Consequences to design for:

- We need an **asset manifest** pinning versions and checksums per family (G7). The frontend build
  pins `v${version}` per source; Studio must do the same rather than always fetching "latest".
  Note that sprites come from a `versatiles-style` **prerelease** channel — pin deliberately.
- B8 (glyph coverage check) must distinguish "empty glyph tile by design" from "family not
  installed", or it will report false problems.
- G5 (no network requirement) becomes "no network requirement _after_ the assets you chose are
  installed" — worth stating honestly rather than claiming more than we deliver.
- F7 (offline package) and F4 (static site export) both need the full-tier download, so the asset
  manager is a prerequisite for them, not an optional extra.

Locally generated glyphs (D9) are **complementary, not an alternative**: they add fonts the
releases do not carry, and they share the same archive format, the same manifest and the same
serving path as downloaded families.

### 2026-08-16 · Q1 — VersaTiles Studio is a native Tauri application

Not a subcommand serving a browser UI. Native file dialogs, drag & drop, file type associations
and being findable as an application outweigh the alternative.

**What we accept in exchange:** code signing and notarisation for macOS and Windows, with the cost
and ongoing effort that implies (G3); building auto-update ourselves (G4); no usable path for
running Studio on the remote server that holds a very large file; and no reuse of the UI inside
`versatiles-frontend-dev`.

### 2026-08-16 · Q5 — No Node runtime is shipped

Every JavaScript library Studio needs runs in the browser, so all of it is bundled into the
webview at build time. Node remains a build-time dependency only (npm, Vite).

Checked individually: `@versatiles/style` and `maplibre-versatiles-styler` are browser libraries;
`@versatiles/svelte` is a Svelte component library; `@versatiles/svg-renderer` documents browser
usage explicitly and ships a UMD bundle plus a `/maplibre` control subpath, so F6 runs in the
webview.

**Consequence:** SVG export (F6) is bounded by what the webview can render. A headless or batch
image export would have no path under this decision — acceptable, since it is not a v1 goal.

### 2026-08-16 · Build on the existing `versatiles-studio` repository

The previous contents were a Tauri 1 + Svelte 4 template from January 2024 with no substantive
code. Removed; the history remains in git. Repository name, GitHub project and `app-icon.png` were
kept.

### 2026-08-16 · Planning documents in English

Consistent with every other repository in versatiles-org, and readable by potential contributors
on a public repository. Working discussions continue in German.
