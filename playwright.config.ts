/**
 * The UI suite: Studio's pages in a browser, the Rust core replaced by `ui/core.ts`.
 *
 * Not the end-to-end suite (`wdio.conf.ts`), which drives the real application and its windows.
 * This one is for what a page looks like and how it behaves - screenshots, the accessibility tree,
 * computed styles, the keyboard - in seconds, without building the application.
 *
 * **WebKit**, the engine of the macOS webview Studio runs in. **Its own port**, so it can run beside
 * `npm run tauri dev`, which holds 1420.
 */

import { defineConfig } from '@playwright/test';
import { TILES_PORT } from './ui/tiles';

const PORT = 1430;

/**
 * **Real tiles, through a real server.** The map fetches its tiles over HTTP, not over IPC, so the
 * one part of the core a page cannot do without is replaced by the thing it is: `versatiles serve`,
 * reading OpenStreetMap from download.versatiles.org in ranges, and serving Studio's own bundled
 * glyphs and sprites at the paths its embedded server does.
 */
const TILES = [
	'versatiles serve',
	`--port ${TILES_PORT}`,
	'--cache-control no-cache',
	'-s "[/assets/glyphs]src-tauri/resources/glyphs.tar.gz"',
	'-s "[/assets/sprites]src-tauri/resources/sprites.tar.gz"',
	'"[osm]https://download.versatiles.org/osm.versatiles"'
].join(' ');

export default defineConfig({
	testDir: 'ui',
	testMatch: '**/*.ui.ts',
	outputDir: 'target/ui-results',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	reporter: 'list',
	use: {
		baseURL: `http://localhost:${PORT}`,
		browserName: 'webkit',
		viewport: { width: 1280, height: 800 },
		colorScheme: 'light'
	},
	webServer: [
		{
			command: `npm run build:worker && npx vite --port ${PORT} --strictPort`,
			url: `http://localhost:${PORT}/landing.html`,
			reuseExistingServer: !process.env.CI,
			timeout: 120_000
		},
		{
			command: TILES,
			url: `http://localhost:${TILES_PORT}/tiles/osm/tiles.json`,
			reuseExistingServer: !process.env.CI,
			timeout: 60_000
		}
	]
});
