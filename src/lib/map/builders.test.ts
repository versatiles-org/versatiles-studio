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
import { build, buildCall, PUBLIC_BASE, tileset } from './builders';

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
