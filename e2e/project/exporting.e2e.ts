/**
 * Writing tiles to disk, and being told how it is going.
 *
 * **The only story that crosses every layer at once**: a dialog in the webview starts work in the
 * core, the core reports progress from a worker thread, the shell forwards it as events, the status
 * bar animates, and a file appears. Unit tests cover the writer and the job registry; what has never
 * been checked is that the events survive the trip and that the bar someone watches is the one the
 * job is driving.
 */

import { browser, expect, $ } from '@wdio/globals';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { invoke, openProject } from '../support';

const TARGET = join(mkdtempSync(join(tmpdir(), 'studio-e2e-')), 'export.versatiles');

describe('exporting a graph', () => {
	before(openProject);

	it('offers the export dialog for the graph being looked at', async () => {
		await $('button=Export…').click();
		await expect($('h2=Export debug')).toBeDisplayed();
		await expect($('button=Estimate size and time')).toBeDisplayed();

		// The dialog asks for a destination through the operating system's save panel, which
		// WebDriver cannot see, so the rest of the story supplies one the way that panel would.
		await $('button=Cancel').click();
	});

	it('runs, and says so in the status bar while it does', async () => {
		const [graph] = await invoke<{ id: number }[]>('graphs');
		await invoke('export_graph', {
			graph: graph.id,
			target: TARGET,
			// Bounded on purpose, and not only to keep the test short. `from_debug` declares a complete
			// pyramid to level 30, and an export that took it at its word would write 10^18 tiles — the
			// bug that cost a machine, and the reason `Bounds` exists at all.
			//
			// The whole world to level 6 is five thousand tiles: long enough that the progress below is
			// something to watch rather than something to catch.
			bounds: { bbox: [-180, -85, 180, 85], minZoom: 0, maxZoom: 6 }
		});

		// Quickly, because this is the one assertion with a job racing it.
		await browser.waitUntil(async () => $('[role=progressbar]').isDisplayed(), {
			interval: 50,
			timeout: 20_000,
			timeoutMsg: 'the status bar never showed the export running'
		});
	});

	it('finishes, lists the job, and leaves a file behind', async () => {
		await $('button=Jobs').click();
		const row = $('.panel .row');
		await row.waitForExist({ timeout: 20_000, timeoutMsg: 'the job never reached the panel' });
		await expect(row.$('.label')).toHaveText(expect.stringContaining('export'));

		await browser.waitUntil(async () => (await row.$('.dot').getAttribute('data-state')) === 'finished', {
			timeout: 60_000,
			timeoutMsg: 'the export never finished'
		});

		expect(existsSync(TARGET) ? TARGET : 'nothing was written').toBe(TARGET);
		expect(statSync(TARGET).size).toBeGreaterThan(0);
	});

	it('wrote it without recording a problem', async () => {
		const problems = await invoke<{ message: string }[]>('diagnostics');
		expect(problems.map((problem) => problem.message)).toEqual([]);
	});
});
