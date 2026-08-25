# End-to-End Testing

Studio has thorough unit tests — the core, the state modules, the components — and no test that has
ever opened a window. Everything between the webview and the binary is unverified: window opening,
the menu, drag-and-drop, the IPC bridge, whether the map draws at all.

This document is the plan for closing that gap with [WebdriverIO](https://webdriver.io), and the
record of what the spike found.

## What this is for, and what it is not for

- **For** — the handful of paths where the seam _is_ the feature: a window opens, a file becomes a
  project, the map draws, a job runs to completion, the menu does what it says.
- **Not for** — anything a unit test can already reach. An end-to-end test costs a minute of wall
  clock and fails for reasons unrelated to the change under test; spending that on logic that
  `vitest` covers in milliseconds buys nothing and erodes trust in the suite.
- **The bar for adding one** — it would have caught a bug that shipped, and no cheaper test would.

## How it runs

| Piece        | Choice                                       | Why                                                                    |
| ------------ | -------------------------------------------- | ---------------------------------------------------------------------- |
| Driver       | `@wdio/tauri-service`, **embedded** provider | `tauri-driver` cannot attach to a WKWebView — see below                |
| Binary       | `tauri build --debug --no-bundle`            | Real bundled assets, no dev server, no packaging step                  |
| Feature gate | `--features e2e`                             | The W3C server is compiled in only for tests                           |
| Fixture      | `e2e/fixtures/debug.vpl`                     | `from_debug` needs no data on disk, so CI downloads nothing            |
| Isolation    | `STUDIO_DATA_DIR`, wiped per run             | Recents and views are the tester's own, and a suite must not edit them |

**The embedded provider, not `tauri-driver`.** `tauri-driver` speaks to WebKitGTK and WebView2 and
has nothing to attach to on macOS, so it would have meant a suite that runs on the Linux runner and
never on the machine it was written on — the arrangement where a suite quietly stops being run. The
embedded provider puts the W3C server inside the application, which works on all three webviews.

**The `e2e` feature never ships.** `guards.test.ts` asserts it exists, is not in the default feature
set, and appears in no script that builds a release.

## Phase 1 — the spike · done

One question the plan could not answer from documentation: what can the driver actually do? The
answers are asserted by `e2e/launcher/spike.e2e.ts`, which fails if any of them stops being true.

| Question                              | Answer                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Does a session attach on macOS?       | Yes, to the WKWebView, with the embedded provider                                                                      |
| Are window handles usable?            | Yes — **the handle is the Tauri window label**, so `window-launcher` is addressable by name                            |
| Can it pass arguments to the binary?  | Only to the instance the service spawns before a run, not to the one a spec is handed — so the suite does not use them |
| Two windows as separate handles?      | Yes, and `switchToWindow` moves between them                                                                           |
| Does WebGL work — does MapLibre draw? | Yes: a real `webgl` context on a canvas with non-zero size                                                             |

Two findings shaped everything after it:

- **Plain WebDriver is enough, and better.** The service also ships a `browser.tauri.*` helper API,
  which needs `withGlobalTauri` and a frontend package imported into the application. Studio uses
  neither: `browser.execute` plus `window.__TAURI_INTERNALS__.invoke` reaches every command over the
  same bridge the webview uses. **No test scaffolding is imported into the product** — the entire
  cost of being testable is one Cargo feature.
- **A command that closes its own window must not be awaited.** `open_in_new_window` closes the
  caller, so the reply has no window to return through and WebDriver reports `no such window` —
  which looks nothing like what happened. `fire()` in the spike defers the call past the script's
  return; what the test then waits for is the window, not the command.

## Phase 2 — the stories · done

Six specs, each covering a seam nothing cheaper covers. Every one starts at the launcher, opens
`e2e/fixtures/debug.vpl` and works from there; `support.ts` holds the handful of moves they share.

| Spec                       | What it covers                                                                   |
| -------------------------- | -------------------------------------------------------------------------------- |
| `launcher/opening.e2e.ts`  | Launcher → project window → map; the file is remembered and reopens on one click |
| `launcher/spike.e2e.ts`    | The driver's own capabilities (phase 1)                                          |
| `project/chrome.e2e.ts`    | The design tokens resolve in a real cascade                                      |
| `project/styling.e2e.ts`   | A preset press reaches the recipe and comes back to the pane                     |
| `project/exporting.e2e.ts` | Export dialog → job → progress in the status bar → a file on disk                |
| `project/saving.e2e.ts`    | Save to a directory, reopen it in a fresh window, style intact                   |

The whole suite is 22 tests in about a minute.

### What it found

Three defects, every one of them invisible to the tests that already existed:

- **The style pane did nothing.** `style.focus()` — which tells the pane _which_ graph it is editing
  — was called from unit tests and from nowhere in the application, so `graph` stayed `null` and
  every control in the pane wrote to nothing. It looked right, because what it showed was the
  unstyled default, which is also what an untouched source shows. Fixed by pointing the pane at the
  current graph in `App.svelte`.
- **Six design tokens resolved to nothing.** A search-and-replace had left `--accent: var(--accent)`
  in a component; a cycle is invalid at computed-value time, so `--ink`, `--surface`, `--chrome`,
  `--rule`, `--accent` and everything derived from them were empty at `:root`. The map drew the crop
  in the deliberately-hideous magenta `token()` falls back to and logged the reason 858 times in a
  session. `tokens.test.ts` reads the token file as text and jsdom has no cascade, so neither could
  see it.
- **The launcher's third door was broken.** Opening a project folder hands the directory to a new
  window over the same queue a double-clicked container arrives on, and the window sent everything it
  was handed down the import path — where a directory has no read node. It opened an empty window
  saying "Studio has no way to open …". Fixed by routing a project directory to the project opener,
  with unit tests on the new path.

### What the driver cannot do

Findings that shaped the stories, each verified rather than assumed:

- **`<select>` cannot be operated.** `selectByAttribute`, a click on the `<option>` and arrow keys all
  leave the element on its old value, and none of them fails — a story using them would pass while
  changing nothing. `choose()` dispatches the event the browser would have sent; it cannot tell that
  a control is reachable, so the stories assert that separately.
- **Native dialogs are invisible.** File pickers and save panels are windows of the operating system.
  Where a story needs one, it supplies the answer the panel would have given, through the command the
  dialog would have called, and says so.
- **A command that closes its own window must not be awaited** — see phase 1.
- **The application outlives its session.** Ending a session closes nothing, and Studio deliberately
  does not quit when its windows go, so each spec ends by stopping the process holding the driver
  port and waiting for that port to be free. Without it a spec is handed the previous spec's windows,
  and the suite passes one file at a time while failing as a whole.
- **App-wide state persists between specs**, because it is app-wide: the panes one spec opened are
  still open for the next. `openPane` is idempotent for that reason.

## Phase 3 — CI · done

A job of its own in `ci.yml`, on `ubuntu-latest`, on pull requests as well as `main`. **Not on the
Bundle job**, as the plan first assumed: that job builds a release, and these tests need a binary
with the `e2e` feature — a second build either way, so it belongs beside the others rather than
inside one.

**On pull requests, unlike `bundle`.** Bundling proves that packaging works, which is a question
about the release machinery and rarely about the commit. These stories prove the change under review
still opens a window, draws a map and writes a file, which is a question about exactly this commit.

**Verified, not assumed.** The whole suite was run against WebKitGTK on Linux under Xvfb before the
job was written — 22 tests, all passing, in the same minute they take on macOS. What that settled:

- `WEBKIT_DISABLE_DMABUF_RENDERER=1` is enough. The usual advice is
  `WEBKIT_DISABLE_COMPOSITING_MODE=1`, which takes WebGL with it — a suite asserting the map draws
  would then be asserting it against a webview that cannot draw one. It is not needed.
- **WebGL works** on Mesa's software rasteriser (`LIBGL_ALWAYS_SOFTWARE=1`), so the map draws and
  the spike's assertion holds on both platforms.
- Xvfb, `lsof` and the Mesa DRI drivers are what the runner has to have; the job checks for each and
  installs only what is missing.

On failure the application's problem log and the driver's logs are kept as an artefact for a week —
a failure here is rarely about the assertion, and those two are what say which side broke.

**Only Linux runs in CI.** macOS would cover WKWebView, where the webview genuinely differs — the
`<select>` finding above is one such difference — but it is a second full debug build for a platform
every contributor to this project already runs the suite on by hand. Worth adding if that stops
being true.

## Phase 4 — keeping it honest

- Screenshots and the application's own problem log kept as artefacts on failure.
- A failing story must name the seam it broke, not just the assertion.
- Any story that goes flaky is deleted rather than retried: a suite this small has no room for a
  test nobody believes.
