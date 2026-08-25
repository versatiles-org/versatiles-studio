# Contributing

How to build, check and release VersaTiles Studio. What the application is and how to install it are
in the [README](README.md); why it is built the way it is, in [`docs/`](docs/).

## Building

**Prerequisites**

|       |                                                                    |
| ----- | ------------------------------------------------------------------ |
| Rust  | 1.94 or newer (edition 2024, and what `versatiles-rs` needs)       |
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
npm run bundle           # → target/release/bundle/
```

## Checking

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

## Sample containers

Some Rust tests need sample containers, which are not vendored — `berlin.versatiles` alone is 25 MB.
They are found automatically if a `versatiles-rs` checkout sits beside this one, or via
`STUDIO_TESTDATA=/path/to/containers`; without either they skip rather than fail. Tests marked
`#[ignore]` need the network — run them with `cargo test -- --ignored`.

## Pinned assets

```sh
npm run assets:check     # fails if a pin is stale, or a digest moved under an unchanged tag
npm run assets:update    # move the pins deliberately
```

Both are metadata-only, so neither downloads anything.

## Releasing

```sh
npm run release -- minor       # or patch, major, or an explicit 0.2.0
npm run release -- minor --dry-run
```

It refuses to start on a dirty tree, off `main`, out of sync with `origin`, on a tag that already
exists, or on a commit CI has not passed. That last one means pushing and letting CI finish before
releasing — the guarantee rather than a side effect, since the local checks run on whatever machine
you are sitting at and a Linux-only failure would otherwise be tagged and published.

Then it runs every check, bumps the version in `package.json`, `src-tauri/tauri.conf.json`, the
workspace `Cargo.toml` and both lockfiles, writes a `CHANGELOG.md` section from the commits since
the last tag, and commits and tags. The notes are generated, not opened for editing: turning a
commit list into prose is a normal commit afterwards, not something to do with a release waiting.

**Then it stops and asks once** — `y/N`, defaulting to no. Everything to that point is local and the
prompt says how to undo it. Past it there are no more questions: it pushes, then watches
[`release.yml`](.github/workflows/release.yml) build the `.deb`s, the AppImages and both `.dmg`s —
shown as one row per platform and a clock rather than a full job tree.

**The workflow publishes, not the script.** It drafts the release, checks that every URL in
`latest.json` names an asset that actually exists, and only then marks it published and _latest_ —
which is what the updater reads. So a tag pushed by hand finishes too, rather than stopping at a
draft nobody is told about. The other side of that: a tag pushed by accident is a release.

Each bundle is smoke-tested before it is attached: the binary is asked `--version`, which proves it
starts at all, and the bundled tier is checked to be inside it. "An installer was produced" and "the
binary runs" are different claims when GDAL is linked statically.

The Homebrew cask updates itself: publishing triggers `update_cask.yml` in
[versatiles-org/homebrew-versatiles](https://github.com/versatiles-org/homebrew-versatiles), whose
`bin/make_cask.sh` reads the release's own assets. Nothing about the cask is written here.

`workflow_dispatch` runs the same build on any branch and creates no release, which is how a
packaging change is tested without spending a version number.

The updater signs with `TAURI_SIGNING_PRIVATE_KEY` from the repository secrets; its public half is
in `tauri.conf.json` and is compiled into the app, so a compromised release page cannot install
anything we did not sign. There is deliberately no `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the key
has none, and an unset secret expands to the empty string that means exactly that.
