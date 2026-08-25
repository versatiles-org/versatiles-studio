/**
 * Choosing how a source is drawn, and watching it stick.
 *
 * The gesture is one press, and behind it is most of release 2: the preset goes into the recipe, the
 * recipe is rebuilt into a MapLibre style, the style is handed to a map that is already drawing, and
 * the pane redraws itself around what was chosen. Every step has unit tests; nothing until now has
 * run them in one window, in that order, against a real WebGL map.
 */

import { browser, expect, $ } from '@wdio/globals';
import { invoke, openPane, openProject } from '../support';

type Recipe = { sources: Record<string, { appearance?: { preset?: string } }> };

/** Which preset the recipe records for the fixture's only source, if any yet. */
async function presetOf(): Promise<string | undefined> {
	const recipe = await invoke<Recipe>('style');
	return recipe.sources.debug?.appearance?.preset;
}

describe('choosing how a source is drawn', () => {
	before(openProject);

	it('records nothing until someone chooses', async () => {
		// A source Studio has not been told anything about has no entry at all: the pane shows a
		// default, and a default is not a decision worth writing into a project file.
		expect(await presetOf()).toBe(undefined);
		await openPane('Style');
		await expect($('button=Neutrino')).toBeDisplayed();
	});

	it('records the preset that was pressed, and shows which one that was', async () => {
		await $('button=Neutrino').click();

		await browser.waitUntil(async () => (await presetOf()) === 'neutrino', {
			timeout: 10_000,
			timeoutMsg: 'the recipe never recorded the preset'
		});
		// The pane must agree, or the recipe changed and the window did not.
		await expect($('button=Neutrino')).toHaveAttribute('aria-pressed', 'true');
		await expect($('button=Colorful')).toHaveAttribute('aria-pressed', 'false');
	});

	it('restyles the map rather than breaking it', async () => {
		await expect($('.maplibregl-canvas')).toBeExisting();
		// MapLibre refuses a style it cannot parse and says so on the console, and every console
		// error reaches this log — so a restyle that was quietly rejected fails here rather than
		// turning up as a blank map later.
		const problems = await invoke<{ message: string }[]>('diagnostics');
		expect(problems.map((problem) => problem.message)).toEqual([]);
	});
});
