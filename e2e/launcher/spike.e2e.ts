/**
 * What WebdriverIO can and cannot do with Studio ([phase 1](../../docs/scope-e2e.md)).
 *
 * **A spike, not a story.** It asserts the four things the rest of the suite depends on, so that a
 * suite built on a wrong assumption fails here — once, legibly — rather than later as a scattering
 * of timeouts. Everything it uses is plain WebDriver: `getWindowHandles`, `$`, and `execute`.
 */

import { browser, expect, $, $$ } from '@wdio/globals';
import { FIXTURE, LAUNCHER, fire, invoke, switchTo, waitForGone } from '../support';

describe('a WebdriverIO session against Studio', () => {
	it('opens on the launcher, and the window handle is the window label', async () => {
		expect(await browser.getWindowHandles()).toEqual([LAUNCHER]);
		await expect($('h1')).toBeExisting();
		expect(await $$('button.door strong').map((door) => door.getText())).toEqual([
			'Open a local file',
			'Open a remote file',
			'Open a project folder',
			'New empty project'
		]);
	});

	it('reaches the core over IPC, without the global Tauri object', async () => {
		const kinds = await invoke<{ id: string }[]>('import_kinds');
		expect(kinds.map((kind) => kind.id)).toContain('pipeline');
		expect(await browser.execute(() => typeof (window as { __TAURI__?: unknown }).__TAURI__)).toBe('undefined');
	});

	it('opens a project window, and the launcher closes behind it', async () => {
		await fire('open_in_new_window', { source: FIXTURE });
		await waitForGone(LAUNCHER);
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
