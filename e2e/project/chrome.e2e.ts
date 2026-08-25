/**
 * The window's own colours, checked where they are actually resolved.
 *
 * **Only a real webview can answer this.** `tokens.test.ts` reads the token file as text, and jsdom
 * has no cascade to compute, so between them a token can be *written* correctly and still arrive
 * empty - which is what happened: a search-and-replace left `--accent: var(--accent)` in a component,
 * a cycle is invalid at computed-value time, and six tokens quietly resolved to nothing. The map
 * drew the crop in the deliberately-hideous magenta `token()` falls back to and logged the reason
 * 858 times, and no test anywhere could see it. This one can.
 */

import { browser, expect } from '@wdio/globals';
import { invoke, openProject } from '../support';

describe('the design tokens', () => {
	before(openProject);

	it('resolve to real values in the webview', async () => {
		const values = await browser.execute(() => {
			const root = getComputedStyle(document.documentElement);
			const names = ['--ink', '--ink-2', '--rule', '--surface', '--chrome', '--accent', '--map-crop-edge'];
			return Object.fromEntries(names.map((name) => [name, root.getPropertyValue(name).trim()]));
		});

		// Named rather than counted: a token that resolved to nothing must say which one it was, or
		// the failure sends the reader back to the same six lines of CSS this test was meant to spare
		// them.
		const empty = Object.entries(values)
			.filter(([, value]) => !/^#[0-9a-f]{3,8}$|^rgb/i.test(value))
			.map(([name, value]) => `${name}: ${JSON.stringify(value)}`);
		expect(empty).toEqual([]);
	});

	it('leave the map with nothing to complain about', async () => {
		// `token()` reports a missing token to the problem log, so an empty log is the second half of
		// the assertion above - and covers the tokens this test does not name.
		const problems = await invoke<{ message: string }[]>('diagnostics');
		expect(problems.map((problem) => problem.message)).toEqual([]);
	});
});
