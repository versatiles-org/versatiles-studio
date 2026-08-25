/**
 * Opening a file — the seam between the launcher, a new window, and the map.
 *
 * Nothing below the window is new here: the core reads containers under unit test all day. What is
 * only ever exercised by a person is *this* — a gesture in one window opening a different window
 * that then has to build a style, start a server and draw something.
 */

import { browser, expect, $, $$ } from '@wdio/globals';
import { FIXTURE, LAUNCHER, fire, invoke, switchTo, waitForGone } from '../support';

describe('opening a file', () => {
	it('offers three doors and nothing else', async () => {
		await expect($('h1')).toHaveText('VersaTiles Studio');
		expect(await $$('button.card strong').map((door) => door.getText())).toEqual([
			'Open a local file',
			'Open a remote file',
			'Open a project folder'
		]);
	});

	it('opens the file in a window of its own, and the launcher gets out of the way', async () => {
		// What the local-file door does once the file picker has answered. The picker itself is a
		// window of the operating system and WebDriver cannot see it, so the answer is supplied here.
		await fire('open_in_new_window', { source: FIXTURE });
		await waitForGone(LAUNCHER);

		const [project] = await browser.getWindowHandles();
		await browser.switchToWindow(project);
		await expect($('.maplibregl-canvas')).toBeExisting();
		// The graph is named after the file it came from, and it is what the Sources pane lists.
		await expect($('button=debug')).toBeExisting();
	});

	it('remembers it, and the launcher opens it again on one click', async () => {
		await fire('open_launcher');
		await switchTo(LAUNCHER);

		const recent = $('button.recent');
		await recent.waitForExist({ timeout: 10_000, timeoutMsg: 'the file was not remembered' });
		expect(await recent.getAttribute('title')).toBe(FIXTURE);

		// The whole path this time: a click on a real control, no command standing in for a dialog.
		await recent.click();
		await waitForGone(LAUNCHER);
		await switchTo((await browser.getWindowHandles())[0]);
		await expect($('button=debug')).toBeExisting();
	});

	it('opened it without recording a problem', async () => {
		const problems = await invoke<{ message: string }[]>('diagnostics');
		expect(problems.map((problem) => problem.message)).toEqual([]);
	});
});
