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

	/**
	 * The `font` shorthand hid nine raw sizes from the check above, because it is neither
	 * `font-size:` nor `font-family:`. `font: inherit` is fine — it carries no value of its own.
	 */
	it('are not bypassed by the font shorthand', () => {
		const offenders = styled.flatMap((path) => {
			const hits = withoutComments(styleBlocks(path)).match(/\bfont:\s*[^;]+/g) ?? [];
			return hits.filter((hit) => /\d/.test(hit)).map((hit) => `${path}: ${hit.trim()}`);
		});
		expect(offenders, 'write font-size and font-family separately, using tokens').toEqual([]);
	});

	/**
	 * `--text-md` is the document default, set once on `body`. A component that writes it is
	 * declaring the size it would already have inherited.
	 *
	 * That sounds harmless and is not: before the rule, 27 components overrode the default to a
	 * smaller size, so the real body size was 12px while the token said 14px and every new component
	 * had to guess which of the two to copy. Writing the default is how the default stops being one.
	 *
	 * **Components only.** `base.css` is where the default legitimately comes from.
	 */
	it('are not restated where they would be inherited', () => {
		const offenders = styled
			.filter((path) => path.endsWith('.svelte'))
			.flatMap((path) => {
				const hits = withoutComments(styleBlocks(path)).match(/font-size:\s*var\(--text-md\)/g) ?? [];
				return hits.map((hit) => `${path}: ${hit.trim()}`);
			});
		expect(offenders, 'delete it — --text-md is what body already gives you').toEqual([]);
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

	/**
	 * The root element must not carry a font size.
	 *
	 * A `rem` on `html` resolves against the browser's initial 16px, and every other `rem` in the
	 * document then resolves against the result — so `html { font-size: 0.875rem }` silently
	 * rescales every token by 0.875, which is how 13px text ended up rendering at 11.4px.
	 */
	it('leave the root font size alone', () => {
		const base = readFileSync(join(SRC, 'lib/styles/base.css'), 'utf8');
		const root = withoutComments(base).match(/(^|\})[^{}]*\bhtml\b[^{}]*\{[^{}]*\}/g) ?? [];
		const offenders = root.filter((rule) => /font-size\s*:/.test(rule));
		expect(offenders, 'set the base size on body — a rem on html rescales every other rem').toEqual([]);
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

	/**
	 * Every colour must exist in both themes.
	 *
	 * The failure this catches is quiet and easy to ship: add a colour to `:root`, forget the dark
	 * block, and it keeps its light value on a dark ground — often still readable enough in a
	 * screenshot to pass review, and wrong. Non-colour tokens are deliberately exempt; a spacing
	 * step does not change with the theme.
	 */
	it('define every colour in both themes', () => {
		const css = readFileSync(join(SRC, TOKENS), 'utf8');
		const dark = css.slice(css.indexOf('prefers-color-scheme: dark'));
		const light = css.slice(0, css.indexOf('prefers-color-scheme: dark'));

		const names = (block: string) => new Set([...block.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]));
		const isColour = (name: string, block: string) => new RegExp(`${name}:\\s*(#|rgba?\\(|hsla?\\()`).test(block);

		const missing = [...names(light)]
			.filter((name) => isColour(name, light) && !name.includes('shadow'))
			.filter((name) => !names(dark).has(name));
		expect(missing, 'add these to the @media (prefers-color-scheme: dark) block').toEqual([]);

		const stray = [...names(dark)].filter((name) => !names(light).has(name));
		expect(stray, 'a token defined only in the dark theme is unreachable in the light one').toEqual([]);
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

	/// A button carries no box unless it asks for one with `.button` (see `base.css`).
	///
	/// The default used to run the other way, and seventeen rules began by undoing it. This is what
	/// stops that coming back: a component re-declaring the box is either duplicating `.button` or
	/// fighting it, and both end with two definitions of what a button looks like.
	///
	/// A control that is *not* a button — a card, a chip, a popover — draws its own box freely, so
	/// this looks only at rules whose selector names `button`. It also looks only for `.button`'s own
	/// face, `--chrome`: the map's controls float above the map on `--float-bg` with a shadow, which
	/// is a different surface rather than a second copy of this one.
	it('leave the button box to base.css', () => {
		const offenders = styled.flatMap((path) => {
			const css = withoutComments(styleBlocks(path));
			return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
				.filter(([, selector, body]) => {
					if (!/\bbutton\b/.test(selector) || selector.includes('.button')) return false;
					const flat = body.replace(/\s/g, '');
					return /border:1px/.test(flat) && /background:var\(--chrome\)/.test(flat);
				})
				.map(([, selector]) => `${path}: ${selector.trim()}`);
		});
		expect(offenders, 'add `class="button"` rather than re-declaring the box').toEqual([]);
	});

	/// Rule 6: a rule that extends another is nested inside it.
	///
	/// Flat, everything about one element is spread over rules that can drift apart or be edited in
	/// isolation. This catches the flat form returning — a top-level selector that another top-level
	/// selector is a prefix of, which is exactly what `&` exists for.
	///
	/// Top level only: a nested rule's `&` prefix means the parser below never sees the compound
	/// form, and `@media` and multi-selector rules are left alone deliberately.
	///
	/// **Components only.** Svelte flattens nesting at build time, so a component's shipped CSS is
	/// `.chip.svelte-hash.on` and there is no browser-support question. `base.css` ships as written,
	/// where nesting would be a runtime dependency rather than a source convention — so it stays
	/// flat, deliberately.
	it('nest a rule that extends another', () => {
		const flat: string[] = [];
		for (const path of styled.filter((p) => p.endsWith('.svelte'))) {
			const css = withoutComments(styleBlocks(path)).replace(/@[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
			const selectors = [...css.matchAll(/(^|\})\s*([^{}@]+)\{/g)]
				.map((m) => m[2].trim())
				.filter((s) => s && !s.startsWith('&') && !s.includes(',') && !s.includes(':global'));
			for (const sel of selectors) {
				for (const other of selectors) {
					if (other === sel || other.includes(' ') || !sel.startsWith(other)) continue;
					const rest = sel.slice(other.length);
					if (rest && ':.[ '.includes(rest[0])) flat.push(`${path}: \`${sel}\` extends \`${other}\``);
				}
			}
		}
		expect([...new Set(flat)], 'nest it with `&` instead — see docs/styling.md rule 6').toEqual([]);
	});

	/// Rule 6, the other half: `&` means *this same element*.
	///
	/// A descendant is a different element, so it is written bare — `.message`, not `& .message`.
	/// With the redundant `&` gone, the character itself says which of the two a rule is, so this
	/// catches the form that would blur the distinction again.
	///
	/// A combinator keeps its `&` (`& + li`), because it is not a descendant and `+ li` reads as a
	/// typo — so only a space followed by a plain selector is an offence.
	it('drop `&` for a descendant', () => {
		const offenders: string[] = [];
		for (const path of styled.filter((p) => p.endsWith('.svelte'))) {
			for (const [, sel] of withoutComments(styleBlocks(path)).matchAll(/^[ \t]*(& [^{}]*)\{/gm)) {
				if (!/^& [>+~]/.test(sel)) offenders.push(`${path}: \`${sel.trim()}\``);
			}
		}
		expect(offenders, 'write it bare — see docs/styling.md rule 6').toEqual([]);
	});
});
