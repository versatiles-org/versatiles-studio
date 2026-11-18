/**
 * The workbench, with a project of one source: OpenStreetMap from download.versatiles.org, drawn
 * through the suite's own `versatiles serve` (see `playwright.config.ts`).
 */

import { expect, test, type Page } from '@playwright/test';
import { FakeCore, OSM_PROJECT, type Answers } from './core';
import { SHOTS, expectAllAnswered, open } from './harness';

test.skip(!!process.env.OFFLINE, 'draws tiles from download.versatiles.org');

/** Opens the workbench on the OSM project, and waits until the map has drawn tiles from the server. */
async function openWorkbench(page: Page, answers: Answers = {}): Promise<FakeCore> {
	const core = new FakeCore({ ...OSM_PROJECT, ...answers });
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

// A document that arrived after the map was built by `mountAll` alone, which settles nothing: the bar
// said "Opening osm.versatiles…" for as long as the window was open. With a slow open too, which is
// what a remote source is, and with the source built once rather than twice.
for (const delay of [0, 1500]) {
	test(`settles the status bar once the source is open and drawn, opening in ${delay} ms`, async ({ page }) => {
		const core = new FakeCore({
			...OSM_PROJECT,
			openContainer: async (args) => {
				await new Promise((resolve) => setTimeout(resolve, delay));
				return OSM_PROJECT.openContainer!(args);
			}
		});
		await open(page, '/', 'window-1', core);
		await expect(page.locator('.maplibregl-canvas')).toBeVisible();
		// Seen on the way only when the open takes long enough to: an instant one may have settled
		// before the map is up, and the slow one is what proves the bar says it at all.
		if (delay > 0) await expect(page.getByText(/Opening osm\.versatiles/)).toBeVisible();
		await expect(page.getByText(/Opening osm\.versatiles/)).toBeHidden({ timeout: 10_000 });
		expect(core.argsOf('mountGraph')).toHaveLength(1);
		expectAllAnswered(core);
	});
}

// The bar's button is not always there to close a panel with - the problem count's goes once the
// list is cleared - so each carries an × in its top right corner, which stays there however far the
// list under it has scrolled, and hands the keyboard back to the bar.
test('closes a status bar panel with the × in its corner, scrolled or not', async ({ page }) => {
	const done = Array.from({ length: 30 }, (_, index) => ({
		id: index + 1,
		label: `Converting part-${index + 1}.mbtiles`,
		lane: 'queued' as const,
		state: { kind: 'finished' as const },
		fraction: 1,
		done: null,
		total: null,
		rate: null,
		etaSeconds: null,
		message: '',
		logLines: 0
	}));
	const core = await openWorkbench(page, { subscribeJobs: () => done as never });
	const jobs = page.getByRole('button', { name: 'Jobs', exact: true });
	await jobs.click();
	const panel = page.getByRole('region', { name: 'Jobs' });
	const close = panel.getByRole('button', { name: 'Close Jobs' });
	await expect(close).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/status-bar-jobs.png` });

	const corner = async () => {
		const [box, button] = await Promise.all([panel.boundingBox(), close.boundingBox()]);
		return { top: button!.y - box!.y, right: box!.x + box!.width - (button!.x + button!.width) };
	};
	const before = await corner();
	expect(before.top).toBeLessThan(16);
	expect(before.right).toBeLessThan(32);
	await panel.evaluate((element) => element.scrollTo(0, element.scrollHeight));
	expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	expect(await corner()).toEqual(before);

	await close.click();
	await expect(panel).toBeHidden();
	await expect(jobs).toBeFocused();
	expectAllAnswered(core);
});
