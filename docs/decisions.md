# Decisions

Two lists: questions still open, and decisions already taken. When a question is answered, move it
down with a date and a short rationale.

---

## Open questions

### Q4 · Where do analysis statistics live?

Scanning a large container is expensive and users will re-open the same files. On-demand with an
in-memory cache, a persisted sidecar file next to the container, or results in the project file?

Lower priority now that cluster B is out of release 1, but not gone: opening a large container and
showing its metadata and actual zoom range (A6) hits the same question.

### Q7 · Scope of `planetiler` orchestration (E5)

Requires a JVM. Do we detect and drive an existing installation, download one, or leave this out?
Potentially the decisive feature for P2, and the largest single dependency we would take on.

### Q8 · Do we ship anything before all four commitments land?

Release 1 is defined ([Q2](decisions.md)), but the stages that lead to it are individually useful:
stage 1 alone is a working tile viewer. Do we put previews in front of users as we go — early
feedback, early bug reports, but a public impression formed by an incomplete tool — or stay quiet
until the committed scope is complete?

---

## Decided

### 2026-08-16 · Q6 — A project is a directory of real files, described by a YAML manifest

```
MyProject/
  project.yaml     Studio's manifest: sources, views, references to the files below
  pipeline.vpl     a real VPL file
  style.json       a real MapLibre style
```

**Reference, do not embed.** The decisive evidence is that the ecosystem already made this choice:
the `versatiles serve` configuration lists tile sources as `src: pipeline.vpl` — a path to a
sibling `.vpl` file — and resolves relative paths against the config file's directory. Following
that convention means a Studio pipeline is a file the CLI can run unchanged
(`versatiles convert pipeline.vpl out.versatiles`), and a Studio style is a file MapLibre can load
unchanged. That is the "nothing only exists inside Studio" principle made concrete rather than
merely asserted, and it makes C7 nearly free.

It also avoids the alternative's real ugliness: VPL is a text DSL, not a data format. Embedding it
in JSON means escaped newlines and unreadable diffs.

**YAML for the manifest**, because `versatiles serve --config` is already YAML, so this is one
format in the user's head rather than two. YAML also permits comments, which matters for a file
people will hand-edit, and is a JSON superset should embedding ever be wanted. The known YAML
footguns (the Norway problem, indentation sensitivity) are accepted: Studio writes this file and
mostly reads its own output. TOML was rejected as a second format in an ecosystem that already
chose YAML, and as awkward for nested source lists; JSON was rejected for having no comments.

**A constraint found while checking, which rules out the tidier idea.** It is tempting to make
`project.yaml` simply _be_ a `versatiles serve` config with extra keys, so that
`versatiles serve project.yaml` just works. It cannot: `versatiles/src/config/main.rs` declares
`#[serde(deny_unknown_fields)]` on `Config`, so any Studio-specific key makes the file invalid for
the server.

So instead, **Studio exports a serve config as a derived artefact** — one more output alongside the
CLI command and CI snippet of C7. Same end result for the user, no upstream change required.

**Worth raising upstream, but not blocking:** an ignored extension namespace (say an `x-` prefix,
or a single opaque `extra` map) in `versatiles-rs`'s `Config` would let one file serve both
purposes. Small change, real payoff, and Studio is a good reason to ask.

**Consequence to design for.** A project is a folder, not a single file, so sharing one means
sending a folder. Studio should offer zip/unzip of a bundle for that, and a "Save As" that copies
the whole directory rather than just the manifest.

### 2026-08-16 · Q3 — Three planes: IPC for control, HTTP for data, Channels for events

| Plane       | Carries                                                                          | Mechanism                |
| ----------- | -------------------------------------------------------------------------------- | ------------------------ |
| **Control** | open a container, read metadata, list VPL operations, start a job, manage assets | Tauri IPC commands       |
| **Data**    | tiles, glyphs, sprites                                                           | the embedded HTTP server |
| **Events**  | job progress, warnings, log lines                                                | Tauri Channels           |

**Why the split is forced, not stylistic.** Tauri serialises command return values as JSON, and the
Tauri v2 documentation explicitly warns this is slow for large payloads. Tile bytes therefore must
not travel over IPC. Channels are Tauri's own recommended mechanism for streaming, which is what
the job runner (E7) needs. Where a single binary blob is genuinely wanted — a raw tile for the MVT
inspector (A4) — `tauri::ipc::Response` returns an array buffer without JSON, so not every such
case needs its own HTTP route.

**The core sits below the commands.** The earlier sub-question was whether to keep a thin interface
underneath the IPC handlers so the core stays testable without a Tauri runtime. Yes. The core is a
plain Rust library containing no Tauri types; `#[tauri::command]` functions are a thin binding over
it. `versatiles_node` already demonstrates the shape — the same core exposed through napi instead
of IPC, with `TileServer` (`addTileSource`, `addStaticSource`, `start`, `stop`), `TileSource`
(`getTile`, `tileJson`, `metadata`, `convertTo`) and a `Progress` class carrying `onProgress` and
`onMessage`. That is close to Studio's control plane and event plane already, and it is worth
mirroring for naming and granularity rather than inventing a second vocabulary.

**Type safety across the boundary.** Use [`tauri-specta`](https://github.com/specta-rs/tauri-specta)
to generate TypeScript types for commands and events from the Rust definitions. It supports Tauri
v2 and covers events as well as commands. It is community-maintained, so the fallback is
hand-written types — but hand-maintaining two copies of the command surface is exactly the kind of
drift the generated-UI principle exists to avoid.

**Consequence for the embedded server.** It is now load-bearing for the data plane rather than
merely convenient, and its lifecycle is a core service (server manager). Bind to loopback only.

### 2026-08-16 · Q10 — Release 1 ships Linux packages and a Homebrew cask; signing comes later

Release 1 targets **Linux** and **macOS via a Homebrew cask**. Windows and a paid Apple Developer
identity are deferred to a later release. This buys an early release for the price of some macOS
friction, and defers both recurring costs and the long procurement lead times.

**Linux.** No signing required. Ship the Tauri outputs from GitHub releases. Note the caveat that a
`.deb` built against one WebKitGTK version may not install across distribution releases, so an
AppImage alongside it is the pragmatic way to actually cover "Ubuntu, Debian, …".

**macOS via our own tap.** Feasible, with two things to design around:

- Homebrew's cask signing audit is **skipped for third-party taps** — `audit.rb` returns early
  unless the tap is official. So an unsigned cask in `versatiles-org/homebrew-versatiles` will not
  be rejected. Submitting to the official `homebrew-cask` repository would be a different matter,
  and should wait until we notarise.
- Homebrew still **applies quarantine**, and as of Homebrew 6.0.15 there is **no `--no-quarantine`
  flag and no environment variable to opt out** — the historical escape hatch is gone. macOS users
  will therefore have to approve the app once under System Settings → Privacy & Security, or strip
  the attribute by hand with `xattr -d com.apple.quarantine`.
- Tauri's ad-hoc "pseudo-identity" signing must still be configured. On Apple Silicon a binary
  needs at least an ad-hoc signature to execute at all — this is not optional even without a
  Developer ID.

**Consequences to accept and document.** macOS users in release 1 meet a security dialog before
their first launch, and the install instructions have to walk them through it in plain language.
That friction lands hardest on P1, the journalism audience the funded scope targets, who skew
towards Macs — so this is the main cost of the decision, not the packaging work.

**Revisit after release 1:** the Apple Developer account ($99/year, where the lead time is account
approval rather than the money), and the Windows certificate route — OV, EV, or Azure Artifact
Signing. Get real quotes before budgeting Windows; the Tauri docs give none, and certificates
issued after 1 June 2023 need hardware-token or HSM key storage, which complicates CI.

### 2026-08-16 · Q2 — Scope of release 1 is set by the funding commitment

Q2 asked whether to build for the analysis audience or the creation audience first. It is moot:
VersaTiles Studio is funded, and four features are committed for the first release.

1. Open and preview all supported tile container formats.
2. Create your own map style.
3. Convert image and vector data into map tiles.
4. Edit VPL and instantly see the result.

These span clusters A, D, E and C. **Cluster B (analysis) is not in the funded scope**, which
reverses the roadmap proposed earlier. See [Release 1 Scope](scope-release-1.md) for the mapping
from commitments to feature IDs.

**The evidence supports the commitment.** An analysis run on 2026-08-16 across four independent
sources pointed at creation and styling, which is what was funded:

- _Who uses VersaTiles_ — of 76 showcase projects, 24 are tagged `journalism`, 16
  `data-visualisation`, 7 `storytelling`. At least 21 come from news organisations (SWR 8, NDR 5,
  Berliner Morgenpost 3, datajournal.org 2, Thüringer Allgemeine 2, taz 1). 37 are from Germany.
  Caveat: the gallery only records public web maps, so it under-counts tile operators by
  construction.
- _What people ask for_ — the documentation backlog is almost entirely creation workflows:
  GeoJSON → vector tiles, mbtiles → versatiles, "put 1000 points on a map", complex geometries,
  own fonts, hillshades and terrain, data-visualisation overlays, QGIS interop. Analysis demand
  exists but is quieter and phrased as CLI ergonomics (`versatiles dev measure-tile-sizes`,
  pretty-printed probe metadata).
- _What gets used_ — `@versatiles/style` sees 53,183 npm downloads a year, an order of magnitude
  more than anything else in the ecosystem. `versatiles-rs` has 13,294 release downloads and 315
  stars; `versatiles-frontend` 6,367; the remaining npm packages 2–3k each.
- _What it costs_ — share of features per cluster that build on existing machinery rather than new
  construction: B 89%, E 86%, F 86%, C 75%, A 63%, G 57%, D 56%. Note that this measures whether an
  _engine_ exists, not total effort: cluster E's engines exist but its wizard UI is the expensive
  part. Cluster D is the most expensive cluster we have, and it is committed.

**What we give up.** Cluster B drops out of release 1, including B2 (byte breakdown), which the
feature catalogue names as the strongest differentiator. B1 and B3 remain nearly free by-products
of `probe` and are the obvious first additions after release 1.

**Risk to watch.** Four clusters in one release is a wide front, and the two most expensive
clusters by reuse ratio (D at 56%, A at 63%) are both in it. The scope document defines a minimum
reading of each commitment for exactly this reason.

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
