// Lint for the TypeScript and Svelte halves of Studio.
//
// The Rust side has had `clippy -D warnings` from the start; this is the other half of that
// symmetry. `svelte-check` already covers types and Svelte's own a11y and reactivity warnings, so
// what is added here is what a typechecker cannot see: unused code, unsafe `any` flowing through a
// boundary, promises nobody awaited.
//
// Deliberately narrow. Style is Prettier's job — anything about formatting belongs there, not in a
// lint rule that would then disagree with it.

import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import svelteConfig from './svelte.config.js';

export default ts.config(
	{
		// Generated or vendored — the same set `.prettierignore` skips, for the same reason: the
		// bundled MapLibre worker is someone else's output, and everything under `target/` is a
		// build artefact, including the JavaScript Tauri's codegen emits.
		ignores: [
			'dist/',
			'node_modules/',
			'target/',
			'src-tauri/target/',
			'src-tauri/gen/',
			// Generated coverage reports; the HTML one carries third-party JS.
			'coverage/',
			'public/maplibre-gl-worker.js'
		]
	},

	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,

	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		},
		rules: {
			// An unused import or variable is either a leftover or a mistake; both are worth seeing.
			// Names starting with `_` are the escape hatch for a deliberately ignored argument.
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
		}
	},

	{
		// Generated, and not ours to fix: tauri-specta emits `any` in its error-unwrapping helper and
		// for opaque JSON. Linting a file nobody edits only produces noise a reader has to learn to
		// ignore — the file's correctness is the generator's job, and the staleness test is what
		// guards it.
		files: ['src/lib/ipc/bindings.ts'],
		rules: { '@typescript-eslint/no-explicit-any': 'off' }
	},

	{
		// Svelte components are parsed by `svelte-eslint-parser`, which needs the same config the
		// compiler uses or it disagrees about runes.
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parserOptions: { parser: ts.parser, svelteConfig }
		}
	},

	{
		// Build scripts run under `tsx` in Node, where reaching for the filesystem and the network is
		// the point rather than a smell.
		files: ['scripts/**/*.ts'],
		languageOptions: { globals: globals.node }
	}
);
