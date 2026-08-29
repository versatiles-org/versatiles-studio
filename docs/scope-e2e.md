# End-to-End Testing

Studio has thorough unit tests - the core, the state modules, the components - and no test that has
ever opened a window. Everything between the webview and the binary is unverified: window opening,
the menu, drag-and-drop, the IPC bridge, whether the map draws at all.

This document is the plan for closing that gap with [WebdriverIO](https://webdriver.io), and the
record of what building it found - three defects it caught on the way in, and the handful of things
the driver turned out not to be able to do.

## What this is for, and what it is not for

- **For** - the handful of paths where the seam _is_ the feature: a window opens, a file becomes a project, the map draws, a job runs to completion, the menu does what it says.
- **Not for** - anything a unit test can already reach. An end-to-end test costs a minute of wall clock and fails for reasons unrelated to the change under test; spending that on logic that `vitest` covers in milliseconds buys nothing and erodes trust in the suite.
- **The bar for adding one** - it would have caught a bug that shipped, and no cheaper test would.

## How it runs

**The embedded provider, not `tauri-driver`.** `tauri-driver` speaks to WebKitGTK and WebView2 and has nothing to attach to on macOS, so it would have meant a suite that runs on the Linux runner and never on the machine it was written on - the arrangement where a suite quietly stops being run. The embedded provider puts the W3C server inside the application, which works on all three webviews.

**The `e2e` feature never ships.** `guards.test.ts` asserts it exists, is not in the default feature set, and appears in no script that builds a release.

**A workspace build invalidates the binary the suite needs.** `cargo build`, `cargo run` and `npm run tauri dev` all write `target/debug/versatiles-studio` _without_ `--features e2e` - the same path `e2e:build` uses - so one of those between building the suite and running it leaves a binary with no driver in it. Measured: 223 MB becomes 212 MB, and the plugin's name goes with the difference.

**`npm run check` is not one of them**, though it was the natural suspect: `cargo test` builds the binary as a test harness into `deps/` and leaves this path alone. Checked, having first written down the opposite.

The file is still there and only its contents are wrong, so `wdio.conf.ts` reads it for the driver plugin's name rather than only asking whether a binary exists - a stale build now fails at once and names the command to run, instead of timing out on a port nothing is listening on. `npm run e2e` does both steps in order.

## Phase 1 - the spike · done

One question the plan could not answer from documentation: what can the driver actually do? The answers are asserted by `e2e/launcher/spike.e2e.ts`, which fails if any of them stops being true.

Two findings shaped everything after it:

## Phase 2 - the stories · done

Six specs, each covering a seam nothing cheaper covers. Every one starts at the launcher, opens `e2e/fixtures/debug.vpl` and works from there; `support.ts` holds the handful of moves they share.

The whole suite is 22 tests in about a minute.

### What it found

Three defects, every one of them invisible to the tests that already existed:

### What the driver cannot do

Findings that shaped the stories, each verified rather than assumed:

## Phase 3 - CI · done

A job of its own in `ci.yml`, on `ubuntu-latest`, on pull requests as well as `main`. **Not on the Bundle job**, as the plan first assumed: that job builds a release, and these tests need a binary with the `e2e` feature - a second build either way, so it belongs beside the others rather than inside one.

**On pull requests, unlike `bundle`.** Bundling proves that packaging works, which is a question about the release machinery and rarely about the commit. These stories prove the change under review still opens a window, draws a map and writes a file, which is a question about exactly this commit.

## Phase 4 - keeping it honest · done

Three rules, two of them enforced by `guards.test.ts` rather than by intention.

**Every wait says what it was waiting for.** Without a message a timeout reports the wait's own source, which names the helper and not the seam - "waitUntil condition timed out" reads the same whether the window never opened or the export never finished. A guard checks every `waitUntil`, `waitForExist`, `waitForDisplayed` and `waitForClickable` in `e2e/` for a `timeoutMsg`.
