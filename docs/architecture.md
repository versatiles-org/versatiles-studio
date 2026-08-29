# Architecture

## The central idea

```mermaid
flowchart LR
  subgraph shell["Tauri shell - native dialogs · drag and drop · menus · auto-update"]
    ui["UI (webview)<br/>Svelte · MapLibre GL · all JS bundled at build time<br/>layer stack · node graph · style editor · charts"]
    core["Studio core (Rust)<br/>project model · VPL document model · job runner<br/>analysis services · asset manager and glyph generation · server manager"]
    server["Embedded server<br/>tiles from the live pipeline<br/>glyphs and sprites, served straight from their archives"]
    crates["versatiles-rs crates<br/>container · pipeline · geometry · image"]
  end

  ui -->|"IPC commands<br/>control plane"| core
  server -->|"HTTP<br/>data plane"| ui
  core -->|"starts and reconfigures"| server
  core --> crates
  server --> crates
```

Costs to watch: cache invalidation on every pipeline edit, and binding a free loopback port without tripping firewall prompts.

## Three planes

| Plane       | Carries                                                       | Mechanism                            |
| ----------- | ------------------------------------------------------------- | ------------------------------------ |
| **Control** | open a container, read metadata, list operations, start a job | Tauri IPC commands, typed end to end |
| **Data**    | tiles, glyphs, sprites                                        | the embedded HTTP server             |
| **Events**  | job progress, warnings, log lines                             | Tauri Channels                       |

Settled by [Q3](decisions.md). The UI reaches the core three ways, chosen by what is being moved.

The split is forced, not stylistic - [Q3](decisions.md#q3---three-planes-ipc-http-channels) has the reasoning. The consequence to remember here is that tile bytes must never travel over IPC, and that a one-off blob is the exception: `tauri::ipc::Response` returns an array buffer without JSON, which is how A4 reads a raw tile.

### Paths across the control plane

Tauri treats the webview as the less-trusted side, so a filesystem path arriving over IPC is tainted by construction - and static analysis says so, repeatedly and correctly. Every such path in Studio is one of five things, and knowing which is what decides whether anything needs doing:

| Kind                             | Where it comes from                        | What constrains it                                        |
| -------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| **Test fixture**                 | `crate::testing`, inside the crate         | Never crosses the boundary at all                         |
| **Application data**             | `app_data_dir()` plus a module constant    | The webview cannot name it ([Q21](decisions.md))          |
| **Chosen destination**           | a native save dialog, passed back over IPC | The command checks the extension, not the dialog's filter |
| **Source named by the document** | a `filename` in the VPL being edited       | Nothing - and deliberately so                             |
| **Assembled from data**          | a manifest id, an entry inside a `.tar.gz` | [`paths`](../crates/studio-core/src/paths.rs) - a guard   |

Only the last row is a bug when it goes unguarded, and it has been twice: on 2026-08-22 `rust/path-injection` found a font id that deleted files outside the asset directory and a zip slip in the style bundle. **So the rule stays on.** Turning it off would buy a quiet list and keep both.

**What is told to the scanner, and what is dismissed.** A dismissal does not survive the scanner: CodeQL 2.26.4 took the Rust alerts from 86 to 147, and 31 of those were locations already triaged, re-raised under new numbers because their fingerprints moved. So the guards are declared as data instead - [`.github/codeql/`](../.github/codeql/) models `paths::within`, `assets::archive_path` and the test helper as barriers, which is re-evaluated every scan and cannot be quietly undone by an upgrade. Default setup reads it; it did not always, which is why an earlier attempt at this switched to advanced setup and was reverted.

## Layers

**UI (web).** Svelte 5, matching the rest of the org, with MapLibre GL for the canvas. All JavaScript is bundled at build time; **no Node runtime ships** ([Q5](decisions.md)). Components are written from scratch rather than imported from `@versatiles/svelte` ([Q18](decisions.md)) - see the [component inventory](components.md).

**Studio core (Rust).** The part worth designing carefully:

## Repository layout

```text
versatiles-studio/
├── Cargo.toml                  workspace: crates/* + src-tauri
├── package.json                Vite · Svelte 5 · TypeScript - build-time only (Q5)
├── index.html                  the workbench                                (Q22)
├── landing.html                the launcher - its own page, no map          (Q48)
│
├── crates/
│   └── studio-core/
│       └── src/
│           ├── vpl/            document model; several named graphs      (Q11, Q32)
│           ├── project.rs      project.yaml, load and save a directory   (G1, Q6)
│           ├── bundle.rs       a copy that runs elsewhere: folder or zip (G1)
│           ├── archive.rs      writing either of those; both bundles use it
│           ├── graphs.rs       the set of graphs a project holds         (Q32)
│           ├── history.rs      one undo stack across all of them         (G6)
│           ├── jobs.rs         runner, progress, cancellation, log       (E7)
│           ├── diagnostics.rs  what went wrong, for a user to copy out   (S6.8)
│           ├── preview.rs      running a graph so the map can show it    (C3)
│           ├── export.rs       writing the result to a container         (F2)
│           ├── estimate.rs     what that write will cost, before it runs (C6)
│           ├── style/          the recipe, and the bundle a style ships in (Q36, D8)
│           ├── import.rs       the catalogue of ways in, and what a .json    (E1-E3)
│           │                    turns out to hold
│           ├── tabular.rs      a delimited file's header                 (E2)
│           ├── suggest.rs      values a field could take                 (E2)
│           ├── analysis.rs     probe stats, in-memory per container      (Q4)
│           ├── assets.rs       install, pin, verify; glyph generation    (G7, D9)
│           ├── paths.rs        the guard on a path assembled from data
│           ├── store.rs        recents and named views, outliving a window (A7, Q21)
│           └── server.rs       embedded server lifecycle, named mounts   (Q16)
│
├── src-tauri/                  deliberately thin
│   ├── tauri.conf.json         · tauri.macos.conf.json - one name each way
│   ├── capabilities/
│   ├── icons/                  generated from app-icon.png
│   ├── resources/              bundled tier, shipped as archives         (Q9)
│   │   ├── sprites.tar.gz
│   │   └── glyphs.tar.gz
│   └── src/
│       ├── main.rs             the entry point
│       ├── commands/           #[tauri::command] bindings - control plane
│       ├── events/             Channels - event plane                    (Q3)
│       ├── menu.rs             the native menu; a choice becomes an event (S0.1)
│       ├── windows.rs          project windows and the launcher     (Q16, Q48)
│       ├── opened.rs           files the OS asks Studio to open          (S0.1)
│       ├── assets.rs           locating the bundled tier                 (S0.6)
│       ├── bindings.rs         generating bindings.ts from the commands  (S0.3)
│       └── state.rs            state owned by the Tauri process
│
├── public/
│   └── maplibre-gl-worker.js   generated, not hand-written               (Q18)
│
├── src/                        the webview
│   ├── main.ts                 · landing.ts - one entry point per page
│   ├── App.svelte              · Launcher.svelte - one root per page
│   └── lib/
│       ├── shell/              the frame: AppShell · Sidebar · Pane · bars
│       ├── panes/<pane>/       each pane and its own parts               (Q31)
│       ├── map/                its components, its helpers, and what it draws
│       ├── common/             used by more than one owner
│       ├── ipc/                bindings.ts (generated) + typed wrappers
│       ├── state/              view state, mirrors of the core's, and the
│       │                      sequencing that keeps them agreeing      (Q16)
│       ├── styles/             tokens, base, and reading tokens from JS
│       └── vpl/                parsing and highlighting, for the editor
│
├── scripts/                    tooling, not shipped
│   ├── bundle_worker.ts        MapLibre 6 worker fix                     (S1.4)
│   ├── fetch-assets.ts         · update-assets.ts - the pinned tier      (S0.6, S0.12)
│   ├── upgrade-deps.sh         · prune-build-dirs.sh - housekeeping
│   ├── docs-pdf.sh             every planning document as one PDF
│   ├── run.ts                  every `{action}:*` script, for one action
│   ├── bundle-local.ts         one command for an installer on this machine
│   ├── spawn.ts                starting a child process portably
│   ├── release.ts              check, bump, tag, push, publish            (S5.6)
│   ├── latest-json.ts          the manifest the updater reads           (S5.8)
│   ├── docs.test.ts            · guards.test.ts - what these documents promise
│   └── spawn.test.ts           the Windows spawn rules, asserted from any platform
├── e2e/                        stories, run against a real window
│   ├── launcher/               what opens with nothing open - and the spike
│   ├── project/                the workbench: style, export, save and reopen
│   ├── support.ts              the moves every story shares
│   └── fixtures/               `from_debug`, so CI downloads nothing
├── wdio.conf.ts                the embedded driver, and how it starts Studio
├── codecov.yml                 one flag per codebase, components within
├── .github/
│   ├── codeql/extensions/      the guards, as data the scanner reads
│   ├── workflows/              ci.yml, release.yml - Linux, macOS, Windows (S0.7, S5.6, S5.9)
│   ├── actions/tauri-deps      the Linux packages, from a cache          (S0.7)
│   └── actions/sqlite3         the tool PROJ builds `proj.db` with       (S5.9)
└── docs/
```

Which component lives in which of those folders, and why, is [Svelte Components](components.md).

**`resources/` holds archives, not directories.** [Q9](decisions.md) is emphatic that assets are never unpacked, and a `resources/sprites/` tree would quietly undo that at build time.

**And a new revision is a swap, not a new source.** The webview owns the other half of that: handing MapLibre a whole style makes its diff take a source whose tile URL changed off the map and put it back, discarding every rendered tile to fetch the same squares again. `map/tile-swap.ts` recognises the case where a change is nothing but tile URLs and calls `setTiles`, which reloads each tile in view while it keeps drawing the one it has. Everything else - a layer added, a preset, a source arriving or leaving, a background - still goes through `setStyle`, because the rule is _when in doubt, full_: mistaking a real change for a swap would leave the map wrong, mistaking a swap for a real change only costs the flash it used to cost anyway.

**And a reorder is neither.** The style specification's diff has no `moveLayer` command, so putting one category of a preset above another source comes out as dozens of removes and adds - and re-adding a layer that was just removed makes MapLibre re-tessellate every tile of that source. `map/reorder.ts` is `tile-swap.ts`'s sibling under the same rule: it recognises the same layers in a different order and issues the fewest moves that produce it ([Q65](decisions.md)).

## Principles

**The text is the source of truth.** The VPL text, the style JSON and the project file are the real artefacts; the node graph, style panels and layer tree are views onto them. This is what makes projects diffable, reviewable and handable to a CLI user.

Taken seriously it has teeth: a view that edits the text must edit it **surgically**, never reformatting, reordering parameters or dropping comments as a side effect. That is why the node graph needs a lossless syntax tree rather than a parse-and-print round trip ([Q11](decisions.md)).

**When the knowledge lives upstream, so does the question.** Anything Studio has to _know_ about VPL - which parameter is a file, what a `tile_size` accepts, which transforms fit a source - is a fact about versatiles-rs, and a copy of it here is a second implementation that agrees until it does not. The reverse test: **when Studio finds itself maintaining a list about upstream, the bug is upstream's missing metadata, not the list.** Applied, it has removed far more than it added - Studio's own parser ([Q23](decisions.md)), its copy of the validation rules ([vt#224]), its table of what fits what ([vt#235]), and 67 entries recording what each argument means ([vt#260]), which took `semantics.rs` with them.

Two things keep it honest. A list that must exist meanwhile is **held against the registry, not a memory of it**, so it fails when upstream moves rather than going quietly wrong. And a rule that loses its last subject is **deleted, not left passing**: a check matching nothing reads as coverage.

The cost is a roadmap partly dependent on someone else's, and releases that change what a form draws without a line changing here. A growing pile of guesses about a moving language is worse.

[vt#224]: https://github.com/versatiles-org/versatiles-rs/issues/224
[vt#235]: https://github.com/versatiles-org/versatiles-rs/issues/235
[vt#260]: https://github.com/versatiles-org/versatiles-rs/issues/260

## Settled questions

| Question | Answer                                                                                   |
| -------- | ---------------------------------------------------------------------------------------- |
| **Q1**   | Native Tauri application, not a subcommand serving a browser UI                          |
| **Q3**   | Three planes - IPC for control, HTTP for data, Channels for events                       |
| **Q4**   | Analysis statistics in memory, keyed by container; no sidecars, none in the project file |
| **Q5**   | No Node runtime ships; all JavaScript is bundled into the webview at build time          |
| **Q6**   | A project is a directory of real files described by a YAML manifest                      |
| **Q11**  | The node graph is in release 1, and needs a lossless VPL syntax tree                     |
| **Q16**  | One application instance, one window per project, one embedded server with named mounts  |
| **Q48**  | A window _is_ a project, and the launcher is a window of its own                         |

See the [decision log](decisions.md) for the reasoning.
