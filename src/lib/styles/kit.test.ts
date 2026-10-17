/**
 * Keeps the kit honest ([S12.8](../../../docs/history.md), [Q70](../../../docs/decisions.md),
 * [S13](../../../docs/history.md), [Q71](../../../docs/decisions.md)).
 *
 * The token test stops a raw value; this stops a raw *part*. Before the kit, a note under a control
 * was spelled `note`, `hint`, `empty`, `nothing` and `none` in five panes, each with a scoped rule of
 * its own, and nothing failed. A component now takes its notes, groups, fields and tabs from
 * `lib/common/`, its bar rows from `lib/shell/`, and its buttons, rows, chevrons and popovers from
 * the classes in `base.css`; writing one by hand is the drift this names, with the file and the
 * spelling.
 *
 * **Every component.** S12 held the panes and the pane frame; the dialogs, the map's controls, the
 * status bar's panels and the launcher had each grown their own tabs, notes, glyph buttons and
 * floating surfaces meanwhile - the same drift one level out. S13 put them on the kit, and this
 * holds them there. The files that *are* the kit are the only ones exempt from the rules about
 * restyling a part.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../', import.meta.url));

/** Every component under `lib/`, plus the two page roots. */
function components(dir = 'lib'): string[] {
	return readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((entry) => {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) return components(path);
		return entry.name.endsWith('.svelte') ? [path] : [];
	});
}

/** The parts themselves, which are where a part is allowed to be styled. */
const KIT = new Set([
	'lib/common/Group.svelte',
	'lib/common/Field.svelte',
	'lib/common/Note.svelte',
	'lib/common/Tabs.svelte',
	'lib/common/Icon.svelte',
	'lib/shell/BarPanel.svelte',
	'lib/shell/BarRow.svelte'
]);

const files = [...components(), 'App.svelte', 'Launcher.svelte'];
const users = files.filter((path) => !KIT.has(path));
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');
const markup = (text: string) => text.replace(/<style>.*?<\/style>/gs, '').replace(/<!--.*?-->/gs, '');
const styles = (text: string) =>
	[...text.matchAll(/<style>(.*?)<\/style>/gs)]
		.map((m) => m[1])
		.join('\n')
		.replace(/\/\*.*?\*\//gs, '');

/** The spellings a note went by, and the elements they were written on. */
const NOTE_WORDS = 'note|hint|empty|nothing|none|problem|error|unsupported|lead|verdict|err|message|said|drop';
/** The spellings a quiet, glyph, link or add button went by. */
const BUTTON_WORDS =
	'reset|edit|step|nudge|ghost|fold|drop|browse|clear|remove|close|forget|confirm|repository|trigger';

describe('the kit', () => {
	it('has components to check', () => {
		expect(users.length).toBeGreaterThan(30);
	});

	/// A paragraph of secondary text is a `Note` with a tone, not a `<p>` with a class.
	it('is where every note comes from', () => {
		const offenders = users.flatMap((path) =>
			[...markup(read(path)).matchAll(new RegExp(`<p[^>]*class="[^"]*\\b(?:${NOTE_WORDS})\\b`, 'g'))].map(
				(m) => `${path}: ${m[0]}`
			)
		);
		expect(offenders, 'use <Note tone="…">').toEqual([]);
	});

	/// A heading inside a pane or a dialog is a `Group`, in sentence case. The uppercase label is a
	/// title's: the pane header the frame draws, and the launcher's two columns - the one window
	/// with no panes, whose columns are its panes.
	it('keeps the uppercase label for a title alone', () => {
		const offenders = users
			.filter((path) => path !== 'lib/shell/Pane.svelte' && path !== 'lib/common/LandingScreen.svelte')
			.filter((path) => /section-label/.test(markup(read(path))))
			.map((path) => path);
		expect(offenders, 'use <Group title="…"> - the uppercase label is a title’s').toEqual([]);
	});

	/// A button that is a word in the accent is `.quiet`, a glyph is `.icon`, a word that goes
	/// somewhere is `.link`, and the "+ …" that adds something is `.add`. None is a class of the
	/// component's own.
	it('is where every quiet, glyph, link and add button comes from', () => {
		const offenders = users.flatMap((path) =>
			[...markup(read(path)).matchAll(new RegExp(`<button[^>]*class="(?:${BUTTON_WORDS})(?: [^"]*)?"`, 'g'))].map(
				(m) => `${path}: ${m[0].slice(0, 60)}`
			)
		);
		expect(offenders, 'use class="quiet", "icon", "link" or "add"').toEqual([]);
	});

	/// A tab strip is `Tabs`: one look, and the arrow keys everywhere. Three components had drawn
	/// their own, at three sizes and with two ARIA patterns.
	it('is where every tab strip comes from', () => {
		const offenders = users.filter((path) => /role="tab(?:list)?"/.test(markup(read(path))));
		expect(offenders, 'use <Tabs items={…}>').toEqual([]);
	});

	/// A glyph is drawn by `Icon`, not typed. A × in the UI font is a different weight on every
	/// platform, and two components had pasted the power switch's SVG.
	it('is where every glyph comes from', () => {
		// A glyph standing alone as an element's content - `>×<` - or a pasted SVG. Not a glyph inside
		// a word: `×3` after a repeated problem is a count, and reads as one.
		const GLYPHS = /[>}]\s*[×✎↑↓↺↻¶▭⋮◉○▸▾]\s*<\/|<svg\b/;
		const offenders = users.filter((path) => GLYPHS.test(markup(read(path)).replace(/\/\/.*$/gm, '')));
		expect(offenders, 'use <Icon name="…">').toEqual([]);
	});

	/// A component may style what is its own; it may not restyle a part. A `Note` that is a
	/// different grey in one pane is exactly the drift this exists to stop.
	it('is never restyled', () => {
		const parts =
			'note|hint|empty|nothing|reset|section-label|toolbar|list-row|icon|quiet|chevron|pane-body|field|group|' +
			'popover|tabs|tab|add|facts|figures|link|button';
		const offenders = users.flatMap((path) =>
			[...styles(read(path)).matchAll(new RegExp(`^\\s*\\.(?:${parts})\\b[^{]*\\{`, 'gm'))].map(
				(m) => `${path}: ${m[0].trim()}`
			)
		);
		expect(offenders, 'the part is styled once, in lib/common, lib/shell or base.css').toEqual([]);
	});

	/// The label column is one width. A component that sets its own has decided something the kit
	/// decided.
	it('lays every label column out at --label-width', () => {
		const offenders = users.flatMap((path) =>
			[...styles(read(path)).matchAll(/grid-template-columns:\s*\d[\d.]*rem/g)].map((m) => `${path}: ${m[0]}`)
		);
		expect(offenders, 'use var(--label-width)').toEqual([]);
	});

	/// A floating surface is `.popover`, and the blur that lifts it off the map is part of that face.
	/// The tooltip is the one quieter exception - a caption beside a field, not a surface - and keeps
	/// its own.
	it('floats everything on the one popover face', () => {
		const offenders = users
			.filter((path) => path !== 'lib/map/Tooltip.svelte')
			.filter((path) => /backdrop-filter/.test(styles(read(path))));
		expect(offenders, 'add class="popover" and drop the face rules').toEqual([]);
	});

	/// Disabled is one fade, `--disabled-opacity`. A component writing a number of its own is how
	/// four components came to four values.
	it('fades a disabled control by the one token', () => {
		const offenders = users.flatMap((path) =>
			[...styles(read(path)).matchAll(/:disabled[^{]*\{[^}]*opacity:\s*0?\.\d+/g)].map((m) => `${path}: ${m[0].trim()}`)
		);
		expect(offenders, 'use opacity: var(--disabled-opacity)').toEqual([]);
	});

	/// Native controls take the accent from `base.css`, once.
	it('leaves the accent of native controls to base.css', () => {
		const offenders = users.filter((path) => /accent-color/.test(styles(read(path))));
		expect(offenders, 'base.css sets accent-color for every checkbox, radio and range').toEqual([]);
	});
});
