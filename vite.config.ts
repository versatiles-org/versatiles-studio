import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Tauri drives this dev server; the port is fixed so tauri.conf.json can point at it.
export default defineConfig({
	plugins: [svelte()],
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
		watch: {
			// **`target/` is not source.** Cargo's output directory holds ~250 000 files here, against
			// 61 under `src/`, and the watcher walks and re-stats every one of them: without
			// `fsevents` installed, chokidar polls, which is a `stat` per file per interval. That is
			// 4-and-a-half cores burnt and 1.4 GB of cached stat entries on an idle map — plus the
			// occasional page reload when a build script writes an HTML file into a GDAL output
			// directory, which is the visible half of the same bug.
			//
			// Vite merges this with its own list (`.git`, `node_modules`, the cache directory), so
			// naming one pattern here does not give the others up. `**/target/**` covers both the
			// workspace's and `src-tauri`'s.
			ignored: ['**/target/**']
		}
	},
	// Everything is bundled at build time — no Node runtime ships (Q5).
	build: {
		target: 'es2022',
		sourcemap: true,
		// MapLibre alone is ~800 kB. Code-splitting a desktop app that loads from disk buys nothing,
		// so the default 500 kB advisory is noise rather than a signal.
		chunkSizeWarningLimit: 1500
	}
});
