/**
 * How the end-to-end tests reach a running Studio.
 *
 * **The embedded driver, on every platform.** `tauri-driver` cannot attach to a WKWebView, so it
 * would mean tests that run on a Linux runner and never on the Mac they were written on — the
 * arrangement where a suite quietly stops being run. The embedded provider puts a W3C server inside
 * the application instead, which works on WKWebView, WebKitGTK and WebView2 alike. It is compiled in
 * only under the `e2e` feature, and `guards.test.ts` keeps that out of anything that ships.
 *
 * **A debug binary, built beforehand.** Nothing here builds it: the Rust build takes minutes and
 * hiding that inside a test run makes a slow suite look like a flaky one. `npm run e2e` says what to
 * run first, and CI reuses the binary the bundle job already produced.
 *
 * **Plain WebDriver, not the service's `browser.tauri.*` helpers.** Those need `withGlobalTauri` and
 * a frontend package imported into the application, and buy nothing: `browser.execute` reaches
 * `window.__TAURI_INTERNALS__.invoke`, which is the bridge the webview itself uses. Studio ships no
 * test scaffolding in the product — see [the plan](docs/scope-e2e.md).
 */

import { existsSync } from 'node:fs';
import { platform } from 'node:process';

/**
 * The binary under test.
 *
 * The bare executable rather than the `.app`: Tauri runs unbundled, and a bundle would mean waiting
 * for a packaging step to test a code change.
 */
const BINARY = platform === 'win32' ? 'target/debug/versatiles-studio.exe' : 'target/debug/versatiles-studio';

if (!existsSync(BINARY)) {
	throw new Error(`no binary at ${BINARY} — run: cargo build -p versatiles-studio --features e2e`);
}

export const config: WebdriverIO.Config = {
	runner: 'local',
	specs: ['./e2e/**/*.e2e.ts'],
	maxInstances: 1,
	framework: 'mocha',
	reporters: ['spec'],
	// Long, because the first thing a window does is start a server and mount two archives. A
	// timeout that fires during start-up reports as a failed assertion, which is the least useful
	// way to be told the application was still opening.
	mochaOpts: { ui: 'bdd', timeout: 60_000 },
	// **`error`, not `warn`.** The service polls window state through its own `browser.tauri.*`
	// bridge, which Studio does not install, so every six seconds it warns that `core.invoke` is
	// missing. Nothing is wrong and nothing can be done about it from here, and a run that prints a
	// screen of warnings it wants ignored teaches people to ignore the output.
	logLevel: 'error',

	capabilities: [
		{
			browserName: 'tauri',
			'wdio:tauriServiceOptions': {
				appBinaryPath: BINARY,
				driverProvider: 'embedded',
				// The window the session attaches to, and it must be the one that opens first: the
				// service waits for this label and fails the session if nothing carries it.
				//
				// **Not `main`.** The service defaults to a window called `main`, and Studio has not had
				// one since it stopped declaring a window in `tauri.conf.json`: what opens with nothing
				// to open is the launcher (S7.7). Every other window is `window-N`, found by label.
				//
				// A file to open would go here as `appArgs`, and would change this to `window-1` —
				// arguments make Studio start in a project window rather than the launcher.
				windowLabel: 'window-launcher'
			}
		}
	],
	services: ['tauri']
};
