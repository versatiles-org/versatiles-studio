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

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import { platform } from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * The binary under test.
 *
 * The bare executable rather than the `.app`: Tauri runs unbundled, and a bundle would mean waiting
 * for a packaging step to test a code change.
 */
const BINARY = platform === 'win32' ? 'target/debug/versatiles-studio.exe' : 'target/debug/versatiles-studio';

if (!existsSync(BINARY)) {
	throw new Error(`no binary at ${BINARY} — run: npm run e2e:build`);
}

/**
 * The recents, named views and saved layout for a run, thrown away before each one.
 *
 * **Not the tester's own.** Studio keeps app-wide state in one directory, and a suite that opens
 * files would otherwise fill a real projects list with fixtures and leave it that way. `data_dir`
 * in `lib.rs` reads this, and only a binary built with the `e2e` feature reads it at all.
 */
const DATA = resolve(import.meta.dirname, 'target/e2e-data');

/**
 * Where a failure leaves its evidence, and what CI uploads.
 *
 * A story fails on a runner nobody is watching, and the assertion is rarely the interesting part: a
 * map that did not draw and a map that drew the wrong thing fail the same line. A picture of the
 * window, and what the application itself was complaining about at that moment, are what tell them
 * apart.
 */
const LOGS = resolve(import.meta.dirname, 'target/e2e-logs');

/**
 * The port the embedded driver listens on, and the reason sessions have to queue for it.
 *
 * Every spec file gets its own session and therefore its own copy of Studio, and each one binds
 * this port. A session that starts while the last one's application is still shutting down reaches
 * *that* application instead — which is holding whatever windows the last spec left, and reports the
 * confusing `no window could be found` rather than anything about ports.
 */
const PORT = 4445;

/** Whether something is still listening, i.e. whether the previous copy of Studio has really gone. */
function listening(): Promise<boolean> {
	return new Promise((settle) => {
		const socket = connect({ port: PORT, host: '127.0.0.1' })
			.on('connect', () => {
				socket.destroy();
				settle(true);
			})
			.on('error', () => settle(false));
	});
}

/**
 * Ends the copy of Studio that was listening on `PORT`.
 *
 * **The service does not.** Ending a session closes nothing, and Studio is built not to quit when
 * its windows go — the launcher comes back instead (Q48) — so without this every spec leaves an
 * application running, and the next spec's session reaches that one rather than its own.
 *
 * By port rather than by name: `target/debug/versatiles-studio` is also what `npm run tauri dev`
 * runs, and a suite that kills whatever is called Studio would close the window someone is working
 * in. Only the process holding the driver port belongs to the tests.
 */
function stopStudio(): void {
	if (platform === 'win32') return; // Windows is not a target of this suite — see the plan.
	const found = spawnSync('lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
	// Loudly, because the alternative is every spec after the first being handed the previous one's
	// windows and reporting `no window could be found`, which says nothing about a missing tool.
	if (found.error) throw new Error(`cannot find what holds port ${PORT}: install lsof (${found.error.message})`);
	for (const pid of found.stdout.split('\n').filter(Boolean)) {
		try {
			process.kill(Number(pid), 'SIGKILL');
		} catch {
			// Already gone, which is the outcome this wanted.
		}
	}
}

/**
 * Whether the windows stay off the screen.
 *
 * **Locally yes, in CI no**, which is not a compromise but the two places wanting opposite things. A
 * run opens and closes a dozen windows: on the machine someone is working at that is a minute of
 * stolen focus, and nobody is looking at them anyway. On a runner nobody is looking at all — and a
 * window that never appears is never composited, so the screenshot `afterTest` keeps shows the panes
 * and an empty square where the map is. The UI is captured either way; only the map is not.
 *
 * `STUDIO_SHOW=1 npm run e2e:run` puts them back on screen here, which is how to watch a story that
 * only misbehaves when you are not watching.
 */
const HIDDEN = !process.env.CI && !process.env.STUDIO_SHOW;

/** How every session finds and starts Studio. Both variables are read only by an `e2e` build. */
const service = {
	appBinaryPath: BINARY,
	driverProvider: 'embedded',
	env: HIDDEN ? { STUDIO_DATA_DIR: DATA, STUDIO_HIDDEN: '1' } : { STUDIO_DATA_DIR: DATA }
} as const;

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
	// Somewhere to upload from when this fails on a runner nobody can watch. Under `target/`, which
	// is already ignored, and beside the application's own problem log.
	outputDir: LOGS,

	capabilities: [
		{
			browserName: 'tauri',
			'wdio:tauriServiceOptions': {
				...service,
				// The window the session attaches to, and it must be the one that opens first: the
				// service waits for this label and fails the session if nothing carries it.
				//
				// **Not `main`.** The service defaults to a window called `main`, and Studio has not had
				// one since it stopped declaring a window in `tauri.conf.json`: what opens with nothing
				// to open is the launcher (S7.7). Every other window is `window-N`, found by label.
				//
				// **Always the launcher, so every spec starts the same way.** Studio can be started on
				// a file instead — it is what the Finder does — but the service only passes arguments
				// to an instance it spawns before the run, not to the one a spec gets, so a spec that
				// relied on them would silently be handed an empty launcher. `openProject` in
				// `support.ts` opens the fixture from here instead, which is a path a person has too.
				windowLabel: 'window-launcher'
			}
		}
	],

	services: ['tauri'],

	/** A run starts with no recents and no saved views, whatever the last one left behind. */
	onPrepare() {
		rmSync(DATA, { recursive: true, force: true });
	},

	/**
	 * Keeps a picture of the window and whatever the application was complaining about.
	 *
	 * Best effort on purpose: this runs after a test has already failed, and a hook that threw here
	 * would replace the failure being reported with one about the reporting.
	 */
	async afterTest(test: { parent: string; title: string }, _context: unknown, result: { passed: boolean }) {
		if (result.passed) return;
		const name = `${test.parent} ${test.title}`
			.replace(/[^a-z0-9]+/gi, '-')
			.toLowerCase()
			.slice(0, 100);
		mkdirSync(LOGS, { recursive: true });
		try {
			await browser.saveScreenshot(resolve(LOGS, `${name}.png`));
		} catch {
			// A window that has already gone is exactly when there is nothing to photograph.
		}
		try {
			const problems = await browser.execute(
				async () =>
					await (
						window as unknown as { __TAURI_INTERNALS__: { invoke(c: string): Promise<unknown> } }
					).__TAURI_INTERNALS__.invoke('diagnostics')
			);
			writeFileSync(resolve(LOGS, `${name}.problems.json`), JSON.stringify(problems, null, 2));
		} catch {
			// No window, or no bridge in it yet.
		}
	},

	/**
	 * Leaves nothing running, and does not return until that is true — see `stopStudio` and `PORT`.
	 *
	 * **Here rather than before the next session**, which is where this started: the service decides
	 * whether to spawn an application before a config hook of the next worker gets to run, so a spec
	 * that waited for the port at its own start had already been handed the previous spec's window.
	 * The suite passed one spec at a time and failed as a whole, which is the worst way for it to
	 * fail — so the waiting belongs to the spec that is leaving, not to the one arriving.
	 */
	async afterSession() {
		stopStudio();
		for (let waited = 0; waited < 30_000 && (await listening()); waited += 100) await sleep(100);
	},

	/** And nothing running for the machine, when the last spec is the one that failed. */
	onComplete() {
		stopStudio();
	}
};
