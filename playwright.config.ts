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

const PORT = 1430;

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
	webServer: {
		command: `npm run build:worker && npx vite --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}/landing.html`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
