/**
 * What WebdriverIO can and cannot do with Studio ([phase 1](../docs/scope-e2e.md)).
 *
 * **A spike, not a story.** It asserts the four things the rest of the suite is about to depend on,
 * so that a suite built on a wrong assumption fails here — once, legibly — rather than later as a
 * scattering of timeouts. Everything it uses is plain WebDriver: `getWindowHandles`, `$`, and
 * `execute`. The service ships a `browser.tauri.*` helper API on top, and Studio deliberately does
 * not use it — see `wdio.conf.ts`.
 */

import { browser, expect, $, $$ } from '@wdio/globals';
import { resolve } from 'node:path';

const FIXTURE = resolve(import.meta.dirname, 'fixtures/debug.vpl');
const LAUNCHER = 'window-launcher';

/** Calls a Studio command over the real IPC bridge, from inside the focused window. */
async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
	return browser.execute(
		async (name: string, payload: Record<string, unknown>) =>
			(await (
				window as unknown as {
					__TAURI_INTERNALS__: { invoke(c: string, a?: unknown): Promise<unknown> };
				}
			).__TAURI_INTERNALS__.invoke(name, payload)) as never,
		command,
		args
	);
}

/**
 * Starts a command and does not wait for it.
 *
 * For the commands that close the window that called them: awaiting the reply means awaiting it in
 * a window that no longer exists, and WebDriver reports that as `no such window` rather than as
 * anything to do with the command. What is being waited for in those cases is the window, below.
 */
function fire(command: string, args: Record<string, unknown> = {}): Promise<void> {
	return browser.execute(
		(name: string, payload: Record<string, unknown>) => {
			// After this script has returned, so the window is still there to carry the reply.
			setTimeout(() => {
				void (
					window as unknown as {
						__TAURI_INTERNALS__: { invoke(c: string, a?: unknown): Promise<unknown> };
					}
				).__TAURI_INTERNALS__.invoke(name, payload);
			}, 50);
		},
		command,
		args
	);
}

/** Waits for a window with this label and switches to it. */
async function switchTo(label: string): Promise<void> {
	await browser.waitUntil(async () => (await browser.getWindowHandles()).includes(label), {
		timeout: 20_000,
		timeoutMsg: `no window labelled ${label}`
	});
	await browser.switchToWindow(label);
}

describe('a WebdriverIO session against Studio', () => {
	it('opens on the launcher, and the window handle is the window label', async () => {
		expect(await browser.getWindowHandles()).toEqual([LAUNCHER]);
		await expect($('h1')).toBeExisting();
		expect(await $$('button strong').map((door) => door.getText())).toEqual([
			'Open a local file',
			'Open a remote file',
			'Open a project folder'
		]);
	});

	it('reaches the core over IPC, without the global Tauri object', async () => {
		const kinds = await invoke<{ id: string }[]>('import_kinds');
		expect(kinds.map((kind) => kind.id)).toContain('pipeline');
		expect(await browser.execute(() => typeof (window as { __TAURI__?: unknown }).__TAURI__)).toBe('undefined');
	});

	it('opens a project window, and the launcher closes behind it', async () => {
		await fire('open_in_new_window', { source: FIXTURE });
		await browser.waitUntil(async () => !(await browser.getWindowHandles()).includes(LAUNCHER), {
			timeout: 20_000,
			timeoutMsg: 'the launcher stayed open'
		});
		const [project] = await browser.getWindowHandles();
		await browser.switchToWindow(project);
		await expect($('.maplibregl-canvas')).toBeExisting();
	});

	it('draws the map with a real WebGL context', async () => {
		const canvas = await browser.execute(() => {
			const element = document.querySelector<HTMLCanvasElement>('.maplibregl-canvas');
			if (!element) return null;
			const gl = element.getContext('webgl2') ?? element.getContext('webgl');
			return { width: element.width, height: element.height, renderer: gl ? 'webgl' : null };
		});
		expect(canvas?.renderer).toBe('webgl');
		expect(canvas?.width).toBeGreaterThan(0);
	});

	it('holds two windows at once, each addressable by label', async () => {
		await fire('open_launcher');
		await switchTo(LAUNCHER);
		expect(await browser.getWindowHandles()).toHaveLength(2);
		await expect($('h1')).toBeExisting();
	});
});
