/**
 * Saving a project, and finding it again in a window that never knew about it.
 *
 * **The round trip is the point.** Each half has unit tests — the writer produces a directory, the
 * reader turns a directory back into graphs — and neither can tell whether the second understands
 * what the first wrote. Only a second window, started from nothing, can say that.
 */

import { browser, expect, $ } from '@wdio/globals';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAUNCHER, fire, invoke, openPane, openProject, switchTo, waitForGone } from '../support';

const DIR = mkdtempSync(join(tmpdir(), 'studio-e2e-project-'));

type Recipe = { sources: Record<string, { appearance?: { preset?: string } }> };

describe('saving a project and opening it again', () => {
	before(openProject);

	it('writes a manifest and a pipeline anyone could read', async () => {
		// Something worth having survived, so that reopening can be about more than "a window opened".
		await openPane('Style');
		await $('button=Shadow').click();
		await browser.waitUntil(
			async () => (await invoke<Recipe>('style')).sources.debug?.appearance?.preset === 'shadow',
			{ timeout: 10_000, timeoutMsg: 'the preset was never recorded, so there is nothing to save' }
		);

		// Where the folder picker would have pointed. A project is a directory of plain files (G1),
		// which is why these are checked by name rather than through the application.
		await invoke('save_project', { dir: DIR, style: null });
		expect(existsSync(join(DIR, 'project.yaml'))).toBe(true);
		expect(existsSync(join(DIR, 'debug.vpl'))).toBe(true);
	});

	it('knows where it now lives', async () => {
		// What tells Save from Save As…, and the one piece of state a save leaves in the window.
		expect(await invoke<string | null>('project_path')).toBe(DIR);
	});

	it('opens in a fresh window with its graph and its style intact', async () => {
		await fire('open_launcher');
		await switchTo(LAUNCHER);
		// The handle exists as soon as the window does, which is before its page has loaded — and a
		// command fired into a page with no bridge yet goes nowhere and says nothing.
		await $('h1').waitForExist({ timeout: 20_000, timeoutMsg: 'the launcher never finished loading' });

		// Taken before, because the window that saved the project stays open: the reopened one is the
		// handle that was not there a moment ago, and picking "the last one" quietly checked the old
		// window instead — which passed while the new window was showing an error.
		const before = await browser.getWindowHandles();
		await fire('open_in_new_window', { source: DIR });
		await waitForGone(LAUNCHER);

		const isNew = (handle: string) => !before.includes(handle);
		await browser.waitUntil(async () => (await browser.getWindowHandles()).some(isNew), {
			timeout: 20_000,
			timeoutMsg: 'no second window opened for the project'
		});
		await switchTo((await browser.getWindowHandles()).find(isNew)!);
		await expect($('button=debug')).toBeExisting();

		const recipe = await invoke<Recipe>('style');
		expect(recipe.sources.debug?.appearance?.preset).toBe('shadow');
	});

	it('reopened it without recording a problem', async () => {
		const problems = await invoke<{ message: string }[]>('diagnostics');
		expect(problems.map((problem) => problem.message)).toEqual([]);
	});
});
