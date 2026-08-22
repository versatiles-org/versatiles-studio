[![CI](https://img.shields.io/github/actions/workflow/status/versatiles-org/versatiles-studio/ci.yml?branch=main&label=CI)](https://github.com/versatiles-org/versatiles-studio/actions/workflows/ci.yml)
[![Rust coverage](https://img.shields.io/codecov/c/github/versatiles-org/versatiles-studio?flag=rust&label=rust%20coverage)](https://codecov.io/gh/versatiles-org/versatiles-studio?flags[0]=rust)
[![TypeScript coverage](https://img.shields.io/codecov/c/github/versatiles-org/versatiles-studio?flag=typescript&label=typescript%20coverage)](https://codecov.io/gh/versatiles-org/versatiles-studio?flags[0]=typescript)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

# VersaTiles Studio

A cross-platform desktop application for working with map tiles: open them, inspect them, build
processing pipelines, design styles, and produce new tile sets — without a terminal and without a
full GIS.

Built on [Tauri](https://tauri.app) and [versatiles-rs](https://github.com/versatiles-org/versatiles-rs).

> **Status: early implementation.** Planning is complete — see the
> [decision log](docs/decisions.md). Stages S0 (foundation), S1 (open & explore) and S2 (pipeline
> editing) are done apart from two stretch items; S3 (import & convert) is under way, with export the
> item in progress. Studio
> opens containers, previews a pipeline live, edits VPL as a node chain or as text, and imports
> vector, tabular and raster data. Milestones M2 (style) and the rest of M3 are still ahead, so it
> is not yet useful end to end. [Release 1 Scope](docs/scope-release-1.md) tracks this per item;
> everything in [`docs/`](docs/) remains a draft and up for discussion.

## Release 1

Studio is funded against four milestones:

|        | Milestone                                             | Delivered in |
| ------ | ----------------------------------------------------- | ------------ |
| **M1** | Open and preview all supported tile container formats | stage S1     |
| **M2** | Create your own map style                             | stage S4     |
| **M3** | Convert image and vector data into map tiles          | stage S3     |
| **M4** | Edit VPL and instantly see the result                 | stage S2     |

The stage order is derived from dependencies, not from the milestone numbering. Release 1 targets
**Linux and macOS**; Windows builds and Apple notarisation are deferred, which keeps certificate
procurement off the critical path ([Q10](docs/decisions.md)).

See [Release 1 Scope](docs/scope-release-1.md) for the feature mapping and the work-item breakdown.

## Installing

There is no release yet. When there is, it will be on the
[releases page](https://github.com/versatiles-org/versatiles-studio/releases) and these are the
instructions.

### Linux

A `.deb` for Debian and Ubuntu, and an AppImage for everything else:

```sh
sudo dpkg -i versatiles-studio_*_amd64.deb
# or
chmod +x VersaTiles*.AppImage && ./VersaTiles*.AppImage
```

Both are offered because a `.deb` is built against one WebKitGTK version and may not install across
distributions ([Q10](docs/decisions.md)).

### macOS

```sh
brew install --cask versatiles-org/versatiles/versatiles-studio
```

or download the `.dmg` — `aarch64` for Apple Silicon, `x86_64` for Intel.

**macOS will refuse to open it the first time.** This is not a broken download. Release 1 is
deliberately not notarised: an Apple Developer identity costs $99 a year and, more to the point, has
an approval lead time we chose to keep off the critical path ([Q10](docs/decisions.md)). Every build
_is_ ad-hoc signed, which is the minimum a binary needs to run on Apple Silicon at all — what is
missing is Apple's counter-signature saying they have seen it.

Either way round it:

- **Open System Settings → Privacy & Security.** Under _Security_ there will be a line naming
  VersaTiles Studio and an **Open Anyway** button. Press it, then open the app again. Once per
  installed version.
- **Or clear the quarantine flag** yourself, which is the same decision made in one line:

  ```sh
  xattr -d com.apple.quarantine "/Applications/VersaTiles Studio.app"
  ```

Homebrew applies the quarantine flag too, and as of 6.0.15 has no `--no-quarantine` flag or opt-out
variable — so a cask install meets the same dialog as a `.dmg` install.

### Windows

Not yet. Deferred with notarisation, for the same reason ([Q10](docs/decisions.md)).

## Building

**Prerequisites**

|       |                                                                    |
| ----- | ------------------------------------------------------------------ |
| Rust  | 1.88 or newer (edition 2024, plus a patched `serde_with`)          |
| Node  | 24 or newer                                                        |
| macOS | Xcode Command Line Tools                                           |
| Linux | `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf` |

**Run it**

```sh
npm install
npm run assets:fetch     # bundled sprites and glyphs — see below
npm run tauri dev
```

`assets:fetch` is **not optional.** The bundled asset tier is generated from the pinned versions in
`assets/manifest.json` rather than committed, so without it a Tauri build fails with
`resource path ... doesn't exist`. Run it again after any `git clean`.

**Package it**

```sh
npm run bundle           # → src-tauri/target/release/bundle/
```

**The scripts**

Every script is `{action}` or `{action}:{context}`, and a bare `{action}` runs its whole group —
`npm run check` runs every `check:*`, in the order `package.json` lists them. It finds them rather
than naming them ([`scripts/run.ts`](scripts/run.ts)), so a script added to a group cannot be
forgotten out of it. `guards.test.ts` holds the convention up.

```
check                    the one command before a commit
├── check:format         prettier · cargo fmt --check
├── check:types          svelte-check over src/, tsc over scripts/
├── check:lint           eslint · clippy -D warnings
└── check:test           vitest with coverage · cargo test

fix                      the writing counterparts
├── fix:format           prettier --write · cargo fmt
└── fix:lint             eslint --fix

coverage                 coverage:web · coverage:rust
build                    build:worker · build:web
generate                 what is generated and checked in — generate:bindings
```

Where the two toolchains differ, the group goes one level deeper: `check:lint:web` is eslint alone
and `check:lint:rust` is clippy alone. That is what lets CI run the Node half on a runner with no
cargo and the cargo half on one with no browser, without either restating the command.

`assets:*` is deliberately the exception — noun-first, and with no aggregate. The three are
alternatives rather than a set, and `assets:check` asks GitHub whether a newer upstream release
exists; sweeping a network call and an unrelated release into the command run before every commit is
how a check teaches people to ignore it.

**Coverage**

```sh
npm run coverage         # both halves, with a summary of each
npm run coverage:rust    # cargo llvm-cov over the workspace
```

`check:test:web` already writes `coverage/lcov.info`, so the frontend half costs nothing extra. Both are
uploaded to [Codecov](https://codecov.io/gh/versatiles-org/versatiles-studio) under separate
**flags** — `rust` and `typescript` — because one number over two codebases is an average of two
unrelated facts. [`codecov.yml`](codecov.yml) splits them further into components: the Rust core is
held to 90%, and the `src-tauri` command layer is reported but never enforced, since it is
`#[tauri::command]` glue that needs a running application to call ([Q3](docs/decisions.md)).

Uploading needs a `CODECOV_TOKEN` repository secret. Pull requests from forks skip the upload rather
than failing on a secret they cannot have.

Some Rust tests need sample containers, which are not vendored — `berlin.versatiles` alone is 25 MB.
They are found automatically if a `versatiles-rs` checkout sits beside this one, or via
`STUDIO_TESTDATA=/path/to/containers`; without either they skip rather than fail. Tests marked
`#[ignore]` need the network — run them with `cargo test -- --ignored`.

**Keeping the pinned assets current**

```sh
npm run assets:check     # fails if a pin is stale, or a digest moved under an unchanged tag
npm run assets:update    # move the pins deliberately
```

Both are metadata-only, so neither downloads anything.

**Cutting a release**

```sh
npm run release -- minor       # or patch, major, or an explicit 0.2.0
npm run release -- minor --dry-run
```

It refuses to start on a dirty tree, off `main`, out of sync with `origin`, or on a tag that already
exists. Then it runs every check, bumps the version in `package.json`,
`src-tauri/tauri.conf.json`, the workspace `Cargo.toml` and both lockfiles, writes a `CHANGELOG.md`
section from the commits since the last tag and opens it in `$EDITOR`, and commits and tags.

**Then it stops and asks once.** Everything up to that point is local, and the prompt says so along
with what is about to become public. Past it there are no more questions: it pushes, watches
[`release.yml`](.github/workflows/release.yml) build the `.deb`, the AppImage and both `.dmg`s,
publishes the release, and fills in the Homebrew cask from the assets that now exist.

The one thing left by hand is copying `packaging/versatiles-studio.rb` into
`versatiles-org/homebrew-versatiles` — a second repository is a second decision.

`workflow_dispatch` runs the same build on any branch and creates no release, which is how a
packaging change is tested without spending a version number.

The updater signs with `TAURI_SIGNING_PRIVATE_KEY` from the repository secrets; its public half is
in `tauri.conf.json` and is compiled into the app, so a compromised release page cannot install
anything we did not sign. There is deliberately no `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the key
has none, and an unset secret expands to the empty string that means exactly that.

## Planning documents

| Document                                   | Contents                                                   |
| ------------------------------------------ | ---------------------------------------------------------- |
| [Vision & Scope](docs/vision.md)           | What Studio is, what it deliberately is not                |
| [Target Audiences](docs/audiences.md)      | Who we build for, and what each group needs                |
| [Feature Catalogue](docs/features.md)      | The full idea pool, grouped and individually referenceable |
| [Release 1 Scope](docs/scope-release-1.md) | Milestones, stages, and the work items in each             |
| [Ecosystem Inventory](docs/ecosystem.md)   | What already exists in versatiles-org and can be reused    |
| [Architecture](docs/architecture.md)       | How the pieces fit together                                |
| [UI Concept](docs/ui.md)                   | How the features are organised on screen, stage by stage   |
| [Styling](docs/styling.md)                 | Design tokens, and the rules that keep the CSS consistent  |
| [Svelte Components](docs/components.md)    | The component inventory, and what to reuse as reference    |
| [Decision Log](docs/decisions.md)          | Every question raised, and how it was settled              |
| [Roadmap](docs/roadmap.md)                 | Release 1 at a glance, and what comes after                |

## Privacy

Studio has **no telemetry, no analytics dependency and no account**. Nothing is sent anywhere you did
not ask it to be sent, and after the map assets you chose are installed it needs no network at all
(G5, [Q9](docs/decisions.md)). This is a design constraint, not a setting — there is nothing to turn
off, because there is nothing there.

## Identifiers

Five schemes, all single-letter-plus-number so they cannot be confused. Letters are reserved:

| Prefix  | Means                              | Example                                      |
| ------- | ---------------------------------- | -------------------------------------------- |
| `A`–`G` | Feature clusters                   | `C1` — bidirectional node graph              |
| `M`     | Funding milestones                 | `M4` — edit VPL and instantly see the result |
| `P`     | Target audiences                   | `P1` — data journalists and NGOs             |
| `Q`     | Questions/decisions                | `Q11` — the node graph is in release 1       |
| `S`     | Stages, and work items within them | `S2.1` — lossless VPL syntax tree            |

Two rules that cost nothing now and save confusion later:

- **A new feature cluster takes the next free letter, `H` onward, and must stop before `M`.**
  `M`, `P`, `Q` and `S` are taken.
- **Retired identifiers are never reused.** A3, E5 and F1 are dropped; if something else ever became
  "A3", every old issue and commit message would silently lie.

Milestone numbers are the funder's and are never renumbered. Work-item numbers are identity rather
than order — `S2.1` is not necessarily done before `S2.2` — so inserting work never renumbers
anything.

## License

[MIT](LICENSE) — Copyright (c) 2024-2026 Michael Kreil
