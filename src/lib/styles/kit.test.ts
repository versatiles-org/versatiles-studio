/**
 * Keeps the kit honest ([S12.8](../../../docs/history.md), [Q70](../../../docs/decisions.md)).
 *
 * The token test stops a raw value; this stops a raw *part*. Before the kit, a note under a control
 * was spelled `note`, `hint`, `empty`, `nothing` and `none` in five panes, each with a scoped rule of
 * its own, and nothing failed. A pane now takes its notes, groups and fields from `lib/common/` and
 * its buttons, rows and chevrons from the classes in `base.css`; writing one by hand is the drift
 * this names, with the file and the spelling.
 *
 * **The panes and the pane frame only.** The dialogs, the map's controls and the launcher share the
 * tokens and `.button` but are not on the kit yet - see "Not in this stage" under S12.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../', import.meta.url));

/** Every component under `lib/panes/`, plus the frame a pane sits in - minus the dialogs. */
function panes(dir = 'lib/panes'): string[] {
	return readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((entry) => {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) return panes(path);
		return entry.name.endsWith('.svelte') && !entry.name.endsWith('Dialog.svelte') ? [path] : [];
	});
}

const files = [...panes(), 'lib/shell/Pane.svelte'];
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');
const markup = (text: string) => text.replace(/<style>.*?<\/style>/gs, '').replace(/<!--.*?-->/gs, '');
const styles = (text: string) =>
	[...text.matchAll(/<style>(.*?)<\/style>/gs)]
		.map((m) => m[1])
		.join('\n')
		.replace(/\/\*.*?\*\//gs, '');

/** The spellings a note went by, and the elements they were written on. */
const NOTE_WORDS = 'note|hint|empty|nothing|none|problem|error|unsupported';
/** The spellings a quiet or glyph button went by. */
const BUTTON_WORDS = 'reset|edit|step|nudge|ghost|fold|drop|browse|clear';

describe('the kit', () => {
	it('has panes to check', () => {
		expect(files.length).toBeGreaterThan(5);
	});

	/// A paragraph of secondary text in a pane is a `Note` with a tone, not a `<p>` with a class.
	it('is where every note comes from', () => {
		const offenders = files.flatMap((path) =>
			[...markup(read(path)).matchAll(new RegExp(`<p[^>]*class="[^"]*\\b(?:${NOTE_WORDS})\\b`, 'g'))].map(
				(m) => `${path}: ${m[0]}`
			)
		);
		expect(offenders, 'use <Note tone="…">').toEqual([]);
	});

	/// A heading inside a pane is a `Group`, in sentence case. The uppercase label is the pane
	/// title's, in the header the frame draws - the one file allowed to write it.
	it('keeps the uppercase label for the pane title alone', () => {
		const offenders = files
			.filter((path) => path !== 'lib/shell/Pane.svelte')
			.filter((path) => /section-label/.test(markup(read(path))))
			.map((path) => path);
		expect(offenders, 'use <Group title="…"> - the uppercase label is the pane header’s').toEqual([]);
	});

	/// A button that is a word in the accent is `.quiet`; a glyph is `.icon`. Neither is a class of
	/// the pane's own.
	it('is where every quiet and glyph button comes from', () => {
		const offenders = files.flatMap((path) =>
			[...markup(read(path)).matchAll(new RegExp(`<button[^>]*class="(?:${BUTTON_WORDS})(?: [^"]*)?"`, 'g'))].map(
				(m) => `${path}: ${m[0].slice(0, 60)}`
			)
		);
		expect(offenders, 'use class="quiet" for a word, class="icon" for a glyph').toEqual([]);
	});

	/// A pane may style what is its own; it may not restyle a part. A `Note` that is a different grey
	/// in one pane is exactly the drift this exists to stop.
	it('is never restyled by a pane', () => {
		const parts =
			'note|hint|empty|nothing|reset|section-label|toolbar|list-row|icon|quiet|chevron|pane-body|field|group';
		const offenders = files.flatMap((path) =>
			[...styles(read(path)).matchAll(new RegExp(`^\\s*\\.(?:${parts})\\b[^{]*\\{`, 'gm'))].map(
				(m) => `${path}: ${m[0].trim()}`
			)
		);
		expect(offenders, 'the part is styled once, in lib/common or base.css').toEqual([]);
	});

	/// The label column is one width. A pane that sets its own has decided something the kit decided.
	it('lays every label column out at --label-width', () => {
		const offenders = files.flatMap((path) =>
			[...styles(read(path)).matchAll(/grid-template-columns:\s*\d[\d.]*rem/g)].map((m) => `${path}: ${m[0]}`)
		);
		expect(offenders, 'use var(--label-width)').toEqual([]);
	});
});
