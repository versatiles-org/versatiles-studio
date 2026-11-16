/**
 * The file dialog as a page shows it: where the focus goes, what is faded, what is readable, and
 * the order the keyboard walks it in. The unit tests (`FileDialog.test.ts`) know what it does; only
 * a browser knows what it looks like.
 */

import { expect, test, type Page } from '@playwright/test';
import { FakeCore, type Answers } from './core';
import { SHOTS, expectAllAnswered, openLauncher } from './harness';

const KINDS = [
	{
		id: 'container',
		label: 'Tile container',
		detail: '',
		extensions: ['versatiles', 'pmtiles', 'mbtiles'],
		operation: 'from_container',
		needs: []
	}
];

const file = (name: string, size: number) => ({
	name,
	folder: false,
	size,
	modified: 1_790_000_000,
	location: `/home/anna/${name}`
});
const folder = (name: string) => ({
	name,
	folder: true,
	size: null,
	modified: 1_790_000_000,
	location: `/home/anna/${name}`
});

/** A home folder long enough to scroll, which is what squeezed the column headers once. */
const HOME = {
	path: '/home/anna',
	parent: '/home',
	entries: [
		...Array.from({ length: 30 }, (_, index) => folder(`folder-${String(index).padStart(2, '0')}`)),
		file('berlin.versatiles', 12_345_678),
		file('notes.txt', 2_048)
	]
};

async function openDialog(page: Page, answers: Answers = {}): Promise<FakeCore> {
	const core = await openLauncher(
		page,
		new FakeCore({ importKinds: () => KINDS, browseLocal: () => HOME, ...answers })
	);
	await page.getByRole('button', { name: /Open a file/ }).click();
	await expect(page.getByRole('dialog', { name: 'Open a Source' })).toBeVisible();
	return core;
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name });
const openButton = (page: Page) => page.getByRole('button', { name: 'Open', exact: true });

test('opens on this computer, with the place it starts in listed', async ({ page }) => {
	const core = await openDialog(page);
	await expect(tab(page, 'This computer')).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByRole('option', { name: /berlin\.versatiles/ })).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/file-dialog-local.png` });
	expectAllAnswered(core);
});

// A focused tab reads as the chosen one, so the focus must never be on another: the dialog opens on
// one tab and switches to the tab it was last on once that has loaded.
test('puts the focus on the tab it was last on, not the first', async ({ page }) => {
	const core = await openDialog(page, { browsing: () => ({ tab: 'remote', folder: null, servers: [] }) });
	await expect(tab(page, 'SFTP server')).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('Tab');
	await page.keyboard.press('Shift+Tab');
	await expect(tab(page, 'SFTP server')).toBeFocused();
	await expect(tab(page, 'This computer')).not.toBeFocused();
	expectAllAnswered(core);
});

// The ring is where the keyboard is, in its own colour; the accent says what is chosen.
test('draws the focus ring in the focus colour, not the accent', async ({ page }) => {
	await openDialog(page);
	const selected = tab(page, 'This computer');
	await selected.focus();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowLeft');
	const ring = await selected.evaluate((element) => getComputedStyle(element).outlineColor);
	const [focus, accent] = await page.evaluate(() =>
		['--focus', '--accent'].map((token) => {
			// A token as the browser resolves it, so it compares with a computed colour.
			const probe = document.body.appendChild(document.createElement('i'));
			probe.style.color = `var(${token})`;
			const colour = getComputedStyle(probe).color;
			probe.remove();
			return colour;
		})
	);
	expect(ring).toBe(focus);
	expect(ring).not.toBe(accent);
});

// A disabled Open was full accent with dark text: the look of the one button to press.
test('fades Open while there is nothing to open', async ({ page }) => {
	await openDialog(page);
	await expect(openButton(page)).toBeDisabled();
	await expect(openButton(page)).toHaveCSS('opacity', '0.4');
	await page.getByRole('option', { name: /berlin\.versatiles/ }).click();
	await expect(openButton(page)).toBeEnabled();
	await expect(openButton(page)).toHaveCSS('opacity', '1');
});

// A long folder took all but a few pixels of the headers' height.
test('keeps the column headers readable above a long folder', async ({ page }) => {
	await openDialog(page);
	const name = page.getByRole('button', { name: /^Name/ });
	await expect(name).toBeVisible();
	const box = await name.boundingBox();
	expect(box?.height ?? 0).toBeGreaterThan(14);
});

// **WebKit's Tab, which is the app's**: as in Safari, Tab stops at form fields and at what sets its
// own `tabindex`, and passes plain buttons by - they are reached with macOS's Keyboard navigation
// setting on. So what matters is that the three stops a default Mac gives come in reading order:
// the chosen tab, where to go, and the list.
test('walks the dialog in reading order with the Tab key', async ({ page }) => {
	await openDialog(page);
	await expect(page.getByRole('option', { name: /berlin\.versatiles/ })).toBeVisible();
	await tab(page, 'This computer').focus();
	const order: string[] = [];
	for (let step = 0; step < 3; step++) {
		order.push(
			await page.evaluate(
				() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? ''
			)
		);
		await page.keyboard.press('Tab');
	}
	expect(order).toEqual(['This computer', 'Folder', 'Files on this computer']);
});

test('offers the download catalogue on the Web address tab', async ({ page }) => {
	test.skip(!!process.env.OFFLINE, 'reads the catalogue from download.versatiles.org');
	const core = await openDialog(page, {
		importOpening: () => ({ kind: { label: 'Tile container' }, refused: null }) as never
	});
	await tab(page, 'Web address').click();
	// The group the catalogue's entries are listed under - not the text, which "Loading the
	// catalogue of download.versatiles.org…" already contains.
	await expect(page.getByRole('heading', { name: 'download.versatiles.org' })).toBeVisible({ timeout: 15_000 });
	await expect(page.getByText('Loading the catalogue')).toBeHidden();
	await page.screenshot({ path: `${SHOTS}/file-dialog-web-address.png` });
	expectAllAnswered(core);
});

test.describe('in the dark theme', () => {
	test.use({ colorScheme: 'dark' });

	test('looks right', async ({ page }) => {
		await openDialog(page);
		await expect(page.getByRole('option', { name: /berlin\.versatiles/ })).toBeVisible();
		await page.screenshot({ path: `${SHOTS}/file-dialog-local-dark.png` });
	});
});

// With no server saved, the form starts where the dialog's content does: a column kept for the
// list of servers left the form pushed halfway across an empty dialog.
test('lays the sign-in form across the dialog when no server is saved yet', async ({ page }) => {
	await openDialog(page);
	await tab(page, 'SFTP server').click();
	const host = page.getByLabel('Host');
	await expect(host).toBeVisible();
	const [tabs, form] = await Promise.all([
		page.getByRole('tablist', { name: 'Where the file is' }).boundingBox(),
		page.locator('form.server-form').boundingBox()
	]);
	expect(Math.abs((form?.x ?? 0) - (tabs?.x ?? 0))).toBeLessThan(2);
	await page.screenshot({ path: `${SHOTS}/file-dialog-sftp-empty.png` });
});

test('lists the servers used before beside the form', async ({ page }) => {
	await openDialog(page, {
		browsing: () => ({
			tab: 'remote',
			folder: null,
			servers: [{ server: { host: 'box.example.org', port: 23, user: 'anna', identity: null }, folder: '/home' }]
		})
	});
	await expect(page.getByRole('button', { name: 'anna@box.example.org:23', exact: true })).toBeVisible();
	const [list, form] = await Promise.all([
		page.getByRole('region', { name: 'Servers used before' }).boundingBox(),
		page.locator('form.server-form').boundingBox()
	]);
	expect((form?.x ?? 0) - (list?.x ?? 0)).toBeGreaterThan(100);
	await page.screenshot({ path: `${SHOTS}/file-dialog-sftp-servers.png` });
});
