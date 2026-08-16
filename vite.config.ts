import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Tauri drives this dev server; the port is fixed so tauri.conf.json can point at it.
export default defineConfig({
	plugins: [svelte()],
	clearScreen: false,
	server: { port: 1420, strictPort: true },
	// Everything is bundled at build time — no Node runtime ships (Q5).
	build: { target: 'es2022', sourcemap: true }
});
