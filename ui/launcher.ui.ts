/**
 * The launcher, as a page: its doors, its footer, and what it looks like.
 */

import { expect, test } from '@playwright/test';
import { FakeCore } from './core';
import { SHOTS, expectAllAnswered, openLauncher } from './harness';

test('offers three doors and says what it is', async ({ page }) => {
	const core = await openLauncher(page, new FakeCore({ appVersion: () => '0.7.0' }));

	await expect(page.locator('button.door strong')).toHaveText([
		'Open a file',
		'Open a project folder',
		'New empty project'
	]);
	await expect(page.locator('footer')).toHaveText(/VersaTiles Studio 0\.7\.0 · beta/);
	await page.screenshot({ path: `${SHOTS}/launcher.png` });
	expectAllAnswered(core);
});
