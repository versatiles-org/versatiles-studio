import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Tauri drives this dev server; the port is fixed so tauri.conf.json can point at it.
export default defineConfig({
	plugins: [svelte()],
	clearScreen: false,
	server: { port: 1420, strictPort: true },
	// Everything is bundled at build time — no Node runtime ships (Q5).
	build: {
		target: 'es2022',
		sourcemap: true,
		// MapLibre alone is ~800 kB. Code-splitting a desktop app that loads from disk buys nothing,
		// so the default 500 kB advisory is noise rather than a signal.
		chunkSizeWarningLimit: 1500
	}
});
