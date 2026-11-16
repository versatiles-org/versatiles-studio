/**
 * The workbench, with a project of one source: OpenStreetMap from download.versatiles.org, drawn
 * through the suite's own `versatiles serve` (see `playwright.config.ts`).
 */

import { expect, test, type Page } from '@playwright/test';
import { FakeCore, OSM_PROJECT } from './core';
import { SHOTS, expectAllAnswered, open } from './harness';

test.skip(!!process.env.OFFLINE, 'draws tiles from download.versatiles.org');

/** Opens the workbench on the OSM project, and waits until the map has drawn tiles from the server. */
async function openWorkbench(page: Page): Promise<FakeCore> {
	const core = new FakeCore(OSM_PROJECT);
	const tiles = page.waitForResponse(
		(response) => /\/tiles\/osm\/\d+\/\d+\/\d+/.test(response.url()) && response.ok(),
		{
			timeout: 30_000
		}
	);
	await open(page, '/', 'window-1', core);
	await tiles;
	await expect(page.getByRole('heading', { name: /INSPECTOR/i })).toBeVisible();
	return core;
}

/** A computed style of the first element a locator finds. */
const styleOf = (page: Page, selector: string, property: string) =>
	page
		.locator(selector)
		.first()
		.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

/** A design token, as the browser resolves it. */
const token = (page: Page, name: string) =>
	page.evaluate((variable) => {
		const probe = document.body.appendChild(document.createElement('i'));
		probe.style.color = `var(${variable})`;
		const colour = getComputedStyle(probe).color;
		probe.remove();
		return colour;
	}, name);

test('opens a project and draws its tiles, asking nothing the core could not answer', async ({ page }) => {
	const core = await openWorkbench(page);
	await expect(page.locator('.maplibregl-canvas')).toBeVisible();
	await page.waitForTimeout(1000); // the rest of the first tiles
	await page.screenshot({ path: `${SHOTS}/workbench.png` });
	expectAllAnswered(core);
});

// Q70: the pane title is the strongest text in a pane, a group heading next, an item the regular
// weight - by size, weight, case and band, and never by grey.
test('reads top down: a pane title over a group heading over an item', async ({ page }) => {
	await openWorkbench(page);
	const title = 'section h2 .section-label';
	expect(await styleOf(page, title, 'font-weight')).toBe('700');
	expect(await styleOf(page, title, 'text-transform')).toBe('uppercase');
	expect(await styleOf(page, title, 'color')).toBe(await token(page, '--ink'));
	expect(await styleOf(page, 'section h2 button', 'background-color')).toBe(await token(page, '--pane-band'));

	const group = page.getByRole('heading', { name: 'Result', level: 3 });
	await expect(group).toHaveCSS('font-weight', '600');
	await expect(group).toHaveCSS('color', await token(page, '--ink'));

	const item = page.getByRole('heading', { name: 'osm', level: 4, exact: true });
	await expect(item).toHaveCSS('font-weight', '400');
});

for (const scheme of ['light', 'dark'] as const) {
	test(`photographs every side pane open, ${scheme}`, async ({ page }) => {
		await page.emulateMedia({ colorScheme: scheme });
		const core = await openWorkbench(page);
		// By name, case aside: the capitals are the stylesheet's, and the accessible name is the text's.
		for (const pane of ['Style', 'Layers', 'Analysis']) {
			const header = page.getByRole('button', { name: new RegExp(`^${pane}\\b`, 'i') });
			if ((await header.getAttribute('aria-expanded')) === 'false') await header.click();
		}
		await page.waitForTimeout(1000);
		await page.screenshot({ path: `${SHOTS}/workbench-panes-${scheme}.png` });
		expectAllAnswered(core);
	});
}
