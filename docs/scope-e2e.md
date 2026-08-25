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

| Piece        | Choice                                       | Why                                                         |
| ------------ | -------------------------------------------- | ----------------------------------------------------------- |
| Driver       | `@wdio/tauri-service`, **embedded** provider | `tauri-driver` cannot attach to a WKWebView — see below     |
| Binary       | `tauri build --debug --no-bundle`            | Real bundled assets, no dev server, no packaging step       |
| Feature gate | `--features e2e`                             | The W3C server is compiled in only for tests                |
| Fixture      | `e2e/fixtures/debug.vpl`                     | `from_debug` needs no data on disk, so CI downloads nothing |

**The embedded provider, not `tauri-driver`.** `tauri-driver` speaks to WebKitGTK and WebView2 and
has nothing to attach to on macOS, so it would have meant a suite that runs on the Linux runner and
never on the machine it was written on — the arrangement where a suite quietly stops being run. The
embedded provider puts the W3C server inside the application, which works on all three webviews.

**The `e2e` feature never ships.** `guards.test.ts` asserts it exists, is not in the default feature
set, and appears in no script that builds a release.

## Phase 1 — the spike · done

One question the plan could not answer from documentation: what can the driver actually do? The
answers are asserted by `e2e/spike.e2e.ts`, which fails if any of them stops being true.

| Question                              | Answer                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Does a session attach on macOS?       | Yes, to the WKWebView, with the embedded provider                                                            |
| Are window handles usable?            | Yes — **the handle is the Tauri window label**, so `window-launcher` is addressable by name                  |
| Can it pass arguments to the binary?  | Yes, as `wdio:tauriServiceOptions.appArgs` — _not_ `tauri:options.args`, which the embedded provider ignores |
| Two windows as separate handles?      | Yes, and `switchToWindow` moves between them                                                                 |
| Does WebGL work — does MapLibre draw? | Yes: a real `webgl` context on a canvas with non-zero size                                                   |

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

## Phase 2 — the stories · next

Four, chosen because each covers a seam and nothing cheaper covers it:

1. **Open a file** — launcher → project window, map draws, launcher closes.
2. **Style a source** — change a preset, the map restyles, the recipe records it.
3. **Export** — run a small export to a temporary directory, the job reaches 100%, the file exists.
4. **Save and reopen** — save a project, close the window, reopen it, the view is restored.

## Phase 3 — CI

On the existing Bundle job on Linux, which already produces a debug-capable build. WebKitGTK needs a
display: `xvfb-run`, plus `WEBKIT_DISABLE_COMPOSITING_MODE=1` for software rendering — the one
place where the two platforms genuinely differ, and the reason the map assertion is
"a GL context exists" rather than a pixel comparison.

## Phase 4 — keeping it honest

- Screenshots and the application's own problem log kept as artefacts on failure.
- A failing story must name the seam it broke, not just the assertion.
- Any story that goes flaky is deleted rather than retried: a suite this small has no room for a
  test nobody believes.
