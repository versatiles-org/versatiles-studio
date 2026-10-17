/**
 * Not a story: a walk through every surface, photographing each one, so the kit can be looked at
 * rather than only tested. Named `.shots.ts` so the suite's glob leaves it alone; run it on its own
 * with `npm run e2e:shots` (after `npm run e2e:build`), and the pictures land in `target/e2e-shots/`.
 * `STUDIO_SHOW=1` is what puts the windows on screen, which is what makes the map draw.
 */

import { browser, $, $$ } from '@wdio/globals';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { LAUNCHER, openPane, openProject, readAs, switchTo } from './support';

const SHOTS = resolve(import.meta.dirname, '../target/e2e-shots');

async function shot(name: string): Promise<void> {
	await browser.pause(400);
	await browser.saveScreenshot(resolve(SHOTS, `${name}.png`));
}

async function escape(): Promise<void> {
	await browser.keys('Escape');
	await browser.pause(150);
}

/** Clicks the one control of this kind whose text is exactly this. */
async function clickNamed(selector: string, text: string): Promise<void> {
	for (const element of await $$(selector)) {
		if ((await element.getText()).trim() === text) {
			await element.click();
			return;
		}
	}
	throw new Error(`no ${selector} reading exactly "${text}"`);
}

describe('every surface, photographed', () => {
	before(() => mkdirSync(SHOTS, { recursive: true }));

	it('the launcher and the remote dialog', async () => {
		await switchTo(LAUNCHER);
		await shot('01-launcher');
		await $('button.door*=Open a remote file').click();
		await $('input[aria-label="Address of a remote file"]').waitForDisplayed({
			timeout: 10_000,
			timeoutMsg: 'it never appeared'
		});
		await browser.pause(1500); // the catalogue
		await shot('02-launcher-remote-dialog');
		await $('button=Cancel').click();
	});

	it('the project window with every pane open', async () => {
		await openProject();
		await browser.pause(2000); // tiles
		for (const pane of ['Sources', 'Pipeline', 'Style', 'Layers', 'Inspector']) await openPane(pane);
		await readAs('vectorShortbread');
		await browser.pause(1500);
		await shot('03-workbench-all-panes');
	});

	it('the sources menu and the operation picker', async () => {
		await $('button*=+ new source…').click();
		await $('button*=From VPL node…').waitForDisplayed({ timeout: 10_000, timeoutMsg: 'it never appeared' });
		await shot('04-sources-menu');
		await $('button*=From VPL node…').click();
		await $('button*=from_debug').waitForDisplayed({ timeout: 10_000, timeoutMsg: 'it never appeared' });
		await shot('05-sources-menu-operations');
		// Escape reaches the list only while it holds focus, which the fix in `Menu` keeps there.
		await escape();
		await browser.waitUntil(async () => !(await $('button*=from_debug').isExisting()), {
			timeout: 5_000,
			timeoutMsg: 'the sources menu stayed open after Escape'
		});

		await $('button*=+ operation…').click();
		await $('input[placeholder="Filter operations…"]').waitForDisplayed({
			timeout: 10_000,
			timeoutMsg: 'it never appeared'
		});
		await browser.pause(300);
		try {
			const options = await $$('[role="option"]').getElements();
			await options[1].moveTo();
			await browser.pause(300);
		} catch {
			// hovering is a nice-to-have
		}
		await shot('06-pipeline-operation-picker');
		await $('input[placeholder="Filter operations…"]').click();
		await escape();
		await browser.waitUntil(async () => !(await $('input[placeholder="Filter operations…"]').isExisting()), {
			timeout: 5_000,
			timeoutMsg: 'the operation picker stayed open after Escape'
		});
	});

	it('the pipeline: parameters, crop, the VPL tab', async () => {
		const add = $('button*=+ parameter…');
		if (await add.isExisting()) {
			await add.click();
			await browser.pause(300);
			await shot('07-node-parameter-picker');
			await escape();
		}
		await clickNamed('button', 'Crop');
		await browser.pause(300);
		await shot('08-pipeline-crop-open');
		await $('button=Draw on map').click();
		await browser.pause(300);
		await shot('09-pipeline-crop-drawing');
		await $('button=Drawing…').click();
		await $('[role="tab"]=VPL').click();
		await browser.pause(300);
		await shot('10-pipeline-vpl-tab');
		await $('[role="tab"]=Graph').click();
	});

	it('the layers tree with a group open and a filter editor', async () => {
		const groups = await $$('button[aria-label^="Expand "]').getElements();
		if (groups.length > 0) {
			await groups[0].click();
			await browser.pause(300);
		}
		const funnels = await $$('button[aria-label^="Filter for "]').getElements();
		if (funnels.length > 0) {
			await funnels[0].click();
			await browser.pause(600);
		}
		await shot('11-layers-open-filter');
		if (funnels.length > 0) await funnels[0].click();
	});

	it('the export dialog', async () => {
		await $('button=Export tiles…').click();
		await $('button=Estimate size').waitForDisplayed({ timeout: 10_000, timeoutMsg: 'it never appeared' });
		await shot('12-export-dialog');
		await $('button=Estimate size').click();
		await browser.pause(4000);
		await shot('13-export-dialog-estimated');
		await $('button=Cancel').click();
	});

	it('the map controls: background, views, search, popup', async () => {
		await $('button[aria-label="Background map"]').click();
		await browser.pause(300);
		await shot('14-map-background-menu');
		await escape();

		await $('button[aria-label="Saved views"]').click();
		await browser.pause(300);
		await $('button*=Save this view').click();
		await browser.pause(300);
		await shot('15-map-views-naming');
		await escape();
		await escape();

		const search = $('input[role="combobox"]');
		await search.click();
		await browser.pause(700);
		await shot('16-map-search-hint');
		await search.setValue('52.52, 13.40');
		await browser.pause(700);
		await shot('17-map-search-results');
		await escape();
		await escape();

		await $('button[aria-label="Tile grid"]').click();
		await browser.pause(500);
		await shot('18-map-grid-stepper');

		const canvas = $('.maplibregl-canvas');
		await canvas.click();
		await browser.pause(800);
		await shot('19-map-feature-popup');
		const close = $('button[aria-label="Close"]');
		if (await close.isExisting()) await close.click();
	});

	it('the status bar panels', async () => {
		await $('button=Jobs').click();
		await browser.pause(300);
		await shot('20-jobs-panel');
		await $('button=Jobs').click();
		const problems = $('button*=Problems');
		if (await problems.isExisting()) {
			await problems.click();
			await browser.pause(300);
			await shot('21-problems-panel');
			await problems.click();
		}
	});

	it('the inspector with the TileJSON open', async () => {
		const tileJson = $('summary*=TileJSON');
		if (await tileJson.isExisting()) await tileJson.click();
		await browser.pause(300);
		await shot('22-inspector-tilejson');
	});
});
