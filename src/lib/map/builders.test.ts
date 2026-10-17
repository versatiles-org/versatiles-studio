// @vitest-environment jsdom

/**
 * **In a browser, the builders resolve their defaults against the page.** Studio's page is
 * `tauri://localhost`, so a default left to the builder is a URL into Studio's own webview - the
 * satellite imagery was exactly that, and drew nothing. jsdom has a page origin too, which is why
 * this file runs there rather than in Node, where the library falls back to versatiles.org and
 * every one of these would pass without the fix. The imagery itself is the background's now
 * ([S11.1](../../../docs/history.md)), and `background.test.ts` checks its tiles the same way.
 */

import { describe, expect, it } from 'vitest';
import { osm } from '@versatiles/style';
import {
	BASE_PALETTES,
	RESEMBLES,
	build,
	buildCall,
	isTheme,
	PUBLIC_BASE,
	themeOrDefault,
	themesFor,
	tileset
} from './builders';

const TILES = tileset('shortbread', ['https://example.org/{z}/{x}/{y}']);

describe('the defaults a builder fills in', () => {
	it('are on versatiles.org, not on the page', () => {
		expect(location.origin).not.toBe(PUBLIC_BASE);
		const style = build('colorful', { tiles: TILES });
		expect(style.glyphs).toMatch(/^https:\/\/tiles\.versatiles\.org\//);
		expect(JSON.stringify(style.sprite)).toMatch(/tiles\.versatiles\.org/);
	});

	// The generated file leaves glyphs and sprites to the defaults, and runs wherever it is pasted -
	// a web page among them.
	it('are named in the call a file is written from', () => {
		const call = buildCall('colorful', 'shortbread', { tiles: 'https://example.org/{z}/{x}/{y}' });
		expect((call.options.urls as { base: string }).base).toBe(PUBLIC_BASE);
	});
});

/**
 * **Two claims about somebody else's package**, checked against the package (S11.3): which of its
 * themes are its own palettes, and what each of the others is after. A theme added upstream lands in
 * one of these lists or fails here - never as a blank entry in the dropdown.
 */
describe('the themes a builder offers', () => {
	it('lists every theme the builder has, each exactly once, in two groups', () => {
		for (const schema of ['shortbread', 'openmaptiles', 'protomaps'] as const) {
			const { palettes, lookalikes } = themesFor(schema);
			const listed = [...palettes, ...lookalikes].map((theme) => theme.id).sort();
			expect(listed, schema).toEqual([...osm.palettes].sort());
		}
	});

	it('pairs every palette of the library’s own with its dark partner', () => {
		const ids = themesFor('shortbread').palettes.map((theme) => theme.id);
		for (const palette of BASE_PALETTES) {
			expect(ids, palette).toContain(palette);
			expect(ids, palette).toContain(`${palette}-dark`);
		}
	});

	it('says what every lookalike is after, and names no lookalike the library lacks', () => {
		const { lookalikes } = themesFor('shortbread');
		for (const theme of lookalikes) expect(theme.resembles, theme.id).not.toBe(theme.id.replace(/-dark$/, ''));
		const families = new Set(lookalikes.map((theme) => theme.id.replace(/-dark$/, '')));
		expect(Object.keys(RESEMBLES).filter((name) => !families.has(name))).toEqual([]);
	});

	it('reads a dark theme as dark, suffix or not', () => {
		const { palettes, lookalikes } = themesFor('shortbread');
		const dark = (id: string) => [...palettes, ...lookalikes].find((theme) => theme.id === id)!.dark;
		expect(dark('gray-dark')).toBe(true);
		expect(dark('gray')).toBe(false);
		// `fnord` is dark with no suffix, which is why `isDarkPalette` is asked rather than the name.
		expect(dark('fnord')).toBe(true);
	});

	it('labels a theme for a person, from its name', () => {
		const { palettes, lookalikes } = themesFor('shortbread');
		expect(palettes.find((theme) => theme.id === 'colorful-dark')?.label).toBe('Colorful, dark');
		expect(lookalikes.find((theme) => theme.id === 'positrino')?.label).toBe('Positrino');
	});

	it('draws a name the builder does not know as the default', () => {
		expect(isTheme('shortbread', 'gray')).toBe(true);
		expect(isTheme('shortbread', 'graybeard')).toBe(false);
		expect(themeOrDefault('openmaptiles', 'graybeard')).toBe('colorful');
	});
});
