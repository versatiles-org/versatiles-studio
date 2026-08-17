/**
 * Keeps the token discipline honest.
 *
 * Consistency held up by good intentions decays: this codebase reached nine near-identical font
 * sizes, four radii and three different reds for the same error state before anyone counted. These
 * tests fail on the pull request instead, with the file and the value named.
 *
 * They are deliberately narrow — colour, type, radius and the font stacks. Everything else stays a
 * judgement call, because a rule nobody can justify is a rule people route around. See
 * docs/styling.md.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../../', import.meta.url).pathname;
const TOKENS = 'lib/styles/tokens.css';

/** Every source file, relative to `src/`. */
function sources(dir = ''): string[] {
	return readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((entry) => {
		const path = dir ? `${dir}/${entry.name}` : entry.name;
		if (entry.isDirectory()) return sources(path);
		return /\.(svelte|ts|css)$/.test(entry.name) ? [path] : [];
	});
}

/** The contents of each `<style>` block, or the whole file for plain CSS. */
function styleBlocks(path: string): string {
	const text = readFileSync(join(SRC, path), 'utf8');
	if (path.endsWith('.css')) return text;
	return [...text.matchAll(/<style>(.*?)<\/style>/gs)].map((m) => m[1]).join('\n');
}

/** Strips comments, so prose about a colour is not mistaken for one. */
const withoutComments = (css: string) => css.replace(/\/\*.*?\*\//gs, '');

const styled = sources().filter((path) => path !== TOKENS && styleBlocks(path).trim() !== '');

describe('design tokens', () => {
	it('has files to check', () => {
		expect(styled.length).toBeGreaterThan(5);
	});

	it('are the only place a raw colour is written', () => {
		const offenders = styled.flatMap((path) => {
			const hits = withoutComments(styleBlocks(path)).match(/#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g) ?? [];
			return hits.map((hit) => `${path}: ${hit}`);
		});
		expect(offenders, `use a token from ${TOKENS}, or add one if none fits`).toEqual([]);
	});

	it('are the only place a font size is written', () => {
		const offenders = styled.flatMap((path) => {
			const hits = withoutComments(styleBlocks(path)).match(/font-size:\s*[^;]*(?:rem|px|pt|em)\b[^;]*/g) ?? [];
			return hits.map((hit) => `${path}: ${hit.trim()}`);
		});
		expect(offenders, 'use --text-xs … --text-xl').toEqual([]);
	});

	it('are the only place a corner radius is written', () => {
		const offenders = styled.flatMap((path) => {
			const hits = withoutComments(styleBlocks(path)).match(/border-radius:\s*[^;]*\d(?:px|rem|em)[^;]*/g) ?? [];
			return hits.map((hit) => `${path}: ${hit.trim()}`);
		});
		expect(offenders, 'use --radius or --radius-lg').toEqual([]);
	});

	it('are the only place a font stack is written', () => {
		const offenders = styled.flatMap((path) => {
			const hits = withoutComments(styleBlocks(path)).match(/font-family:\s*[^;]+/g) ?? [];
			return hits.filter((hit) => !/var\(--font-(ui|mono)\)|inherit/.test(hit)).map((hit) => `${path}: ${hit.trim()}`);
		});
		expect(offenders, 'use --font-ui or --font-mono').toEqual([]);
	});

	/**
	 * A fallback is only reachable when the token is missing, which cannot happen — tokens.css is
	 * imported before the application mounts. They are dead code that drifts: this codebase carried
	 * `var(--ink-2, #667)` in one file and `var(--ink-2, #66716f)` in another.
	 */
	it('are referenced without fallbacks', () => {
		const offenders = styled.flatMap((path) => {
			const hits = withoutComments(styleBlocks(path)).match(/var\(--[\w-]+\s*,[^)]*\)/g) ?? [];
			return hits.map((hit) => `${path}: ${hit}`);
		});
		expect(offenders, 'drop the fallback; the token is always defined').toEqual([]);
	});

	/** Focus is one decision, made once in base.css. Components may only adjust the offset. */
	it('leave the focus ring to base.css', () => {
		const offenders = styled
			.filter((path) => !path.endsWith('styles/base.css'))
			.flatMap((path) => {
				const hits = withoutComments(styleBlocks(path)).match(/outline:\s*[^;]+/g) ?? [];
				return hits.map((hit) => `${path}: ${hit.trim()}`);
			});
		expect(offenders, 'set outline-offset if you must, but not the ring itself').toEqual([]);
	});

	/** Colours reaching MapLibre go through styles/tokens.ts, or the map cannot follow a theme. */
	it('are the only place a map colour is written', () => {
		const offenders = sources()
			.filter((path) => /\.(ts|svelte)$/.test(path) && !path.startsWith('lib/styles/'))
			.flatMap((path) => {
				const text = readFileSync(join(SRC, path), 'utf8').replace(/<style>.*?<\/style>/gs, '');
				const hits = withoutComments(text).match(/['"]#[0-9a-fA-F]{3,8}['"]/g) ?? [];
				return hits.map((hit) => `${path}: ${hit}`);
			});
		expect(offenders, "read it with token('--map-…') from lib/styles/tokens.ts").toEqual([]);
	});
});
