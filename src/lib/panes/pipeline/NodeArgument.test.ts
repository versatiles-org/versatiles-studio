// @vitest-environment jsdom

/**
 * The file picker behind a path parameter (S3.2).
 *
 * **Rendered rather than asserted as a function**, for the same reason the style pane is: what kept
 * going wrong here is not what a path *is* - `node-fields` covers that - but whether there is
 * anything on screen to click. A pathname someone has to type from memory is the one value in this
 * form the machine already knows every valid answer to.
 *
 * The dialog is the backend's, so it is stubbed: `plugin:dialog|open` is an ordinary command over
 * the same bridge - see `lib/testing/tauri.ts` for what that does and does not prove.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import NodeArgument from './NodeArgument.svelte';
import { stubTauri, type TauriStub } from '../../testing/tauri';
import { bboxField } from '../../state/bbox.svelte';
import { flushSync } from 'svelte';

/** `field_meta` for a parameter that names a file - the core's `Control::Path`. */
const PATH_FIELD = (name: string) => ({
	name,
	doc: '',
	required: false,
	sources: false,
	default: null,
	control: { kind: 'path' as const }
});

/** `field_meta` for a rectangle - the core's `Control::Bbox`. */
const BBOX_FIELD = {
	name: 'bbox',
	doc: '',
	required: false,
	sources: false,
	default: null,
	control: { kind: 'bbox' as const }
};

/** `field_meta` for a field with a short list of answers - the core's `Control::Choice`. */
const CHOICE_FIELD = (over: Record<string, unknown> = {}) => ({
	name: 'tile_size',
	doc: '',
	required: false,
	sources: false,
	default: null,
	control: { kind: 'choice' as const, options: ['256', '512'] },
	...over
});

/** `field_meta` for a colour - the core's `Control::Color`, in either spelling. */
const COLOR_FIELD = (hex: boolean) => ({
	name: 'color',
	doc: '',
	required: false,
	sources: false,
	default: null,
	control: { kind: 'color' as const, hex }
});

const CONTAINER = {
	id: 'container',
	label: 'Tile container',
	detail: 'A .versatiles, .mbtiles or .pmtiles file',
	extensions: ['versatiles', 'mbtiles', 'pmtiles'],
	operation: 'from_container',
	needs: []
};

let tauri: TauriStub;

beforeEach(() => {
	tauri = stubTauri();
});

afterEach(() => {
	cleanup();
	tauri.restore();
});

/** What the dialog will answer with - `null` stands for a cancelled picker. */
const picks = (path: string | null) => tauri.answer('plugin:dialog|open', path);

describe('which parameters offer a file picker', () => {
	it('offers one for a path field', () => {
		render(NodeArgument, { name: 'filename', field: PATH_FIELD('filename'), value: '', onCommit: () => {} });

		expect(screen.getByLabelText('Choose a file for filename')).toBeTruthy();
	});

	// The name is not what decides it - the core is. `raster_mask`'s `geojson` and `from_gdal_*`'s
	// `cutline` name files and look nothing like `*_file`, which is how a name test in here missed
	// them; a `layer_name` full of slashes is still not a path.
	it('offers one for a path field named nothing like a path', () => {
		render(NodeArgument, { name: 'geojson', field: PATH_FIELD('geojson'), value: '', onCommit: () => {} });

		expect(screen.getByLabelText('Choose a file for geojson')).toBeTruthy();
	});

	it('offers none for a field that is not a path', () => {
		render(NodeArgument, { name: 'layer_name', value: 'a/b', onCommit: () => {} });

		expect(screen.queryByLabelText('Choose a file for layer_name')).toBeNull();
	});

	// A field the operation does not declare has no metadata to read, and a guess is what this
	// stopped making.
	it('offers none for a parameter the operation does not declare', () => {
		render(NodeArgument, { name: 'filename', value: '', onCommit: () => {} });

		expect(screen.queryByLabelText('Choose a file for filename')).toBeNull();
	});

	// A number, a choice and a checkbox have their own controls, and none of them is a path.
	it('offers none for a field with a control of its own', () => {
		render(NodeArgument, {
			name: 'max_zoom_path',
			value: '4',
			field: {
				name: 'max_zoom_path',
				doc: '',
				required: false,
				sources: false,
				default: null,
				control: { kind: 'number', integer: true, min: null, max: null, minExclusive: false, maxExclusive: false }
			},
			onCommit: () => {}
		});

		expect(screen.queryByLabelText('Choose a file for max_zoom_path')).toBeNull();
	});
});

describe('what the picker does with what it gets', () => {
	it('commits the picked path the same way a typed one is committed', async () => {
		const onCommit = vi.fn();
		picks('/tmp/berlin.versatiles');
		render(NodeArgument, { name: 'filename', field: PATH_FIELD('filename'), value: '', onCommit });

		screen.getByLabelText('Choose a file for filename').click();
		await vi.waitFor(() => expect(onCommit).toHaveBeenCalledWith('/tmp/berlin.versatiles'));
	});

	// Cancelling must not clear a value that is already there: an empty commit removes the
	// parameter from the document, which is a deletion nobody asked for.
	it('leaves the field alone when the dialog is cancelled', async () => {
		const onCommit = vi.fn();
		picks(null);
		render(NodeArgument, {
			name: 'filename',
			field: PATH_FIELD('filename'),
			value: '/tmp/berlin.versatiles',
			onCommit
		});

		screen.getByLabelText('Choose a file for filename').click();
		await vi.waitFor(() => expect(tauri.calls.some((call) => call.cmd === 'plugin:dialog|open')).toBe(true));
		expect(onCommit).not.toHaveBeenCalled();
	});

	// The operation is what says which files are worth offering - the same catalogue File → Open
	// uses for it. One filter and no "All files" beside it: macOS flattens the list rather than
	// offering a menu, so a second entry would be a choice nobody could make there.
	it('filters to what the node reads', async () => {
		picks('/tmp/berlin.versatiles');
		render(NodeArgument, {
			name: 'filename',
			field: PATH_FIELD('filename'),
			value: '',
			kind: CONTAINER,
			onCommit: () => {}
		});

		screen.getByLabelText('Choose a file for filename').click();
		await vi.waitFor(() => expect(tauri.calls.some((call) => call.cmd === 'plugin:dialog|open')).toBe(true));

		const options = tauri.calls.find((call) => call.cmd === 'plugin:dialog|open')?.args.options as {
			filters: { name: string; extensions: string[] }[];
		};
		expect(options.filters).toEqual([{ name: 'Tile container', extensions: CONTAINER.extensions }]);
	});

	// A field nothing is known about is a field nothing is claimed about: a `*_file` on a transform
	// may want a stylesheet, a CSV or something Studio has never heard of.
	it('offers every file when the node is not a way in', async () => {
		picks('/tmp/anything.txt');
		render(NodeArgument, { name: 'sprite_file', field: PATH_FIELD('sprite_file'), value: '', onCommit: () => {} });

		screen.getByLabelText('Choose a file for sprite_file').click();
		await vi.waitFor(() => expect(tauri.calls.some((call) => call.cmd === 'plugin:dialog|open')).toBe(true));

		const options = tauri.calls.find((call) => call.cmd === 'plugin:dialog|open')?.args.options as {
			filters?: unknown;
		};
		expect(options.filters).toBeUndefined();
	});
});

/**
 * The map behind a bbox parameter ([Q53]).
 *
 * Four degrees typed by hand are four chances to put a digit in the wrong place, and no way to see
 * that you did until the pipeline runs over the wrong part of the world. The map already draws
 * rectangles; this is the field reaching it.
 */
describe('which parameters offer the map', () => {
	const open = (value = '', onCommit: (raw: string) => void = () => {}) =>
		render(NodeArgument, { name: 'bbox', field: BBOX_FIELD, value, onCommit });

	const button = () => screen.getByLabelText('Draw bbox on the map');

	it('offers a rectangle for a bbox field', () => {
		open();
		expect(button()).toBeTruthy();
	});

	it('offers none for four numbers that are not a rectangle', () => {
		render(NodeArgument, {
			name: 'rgb',
			field: { ...BBOX_FIELD, name: 'rgb', control: { kind: 'numbers' as const, count: 4 } },
			value: '',
			onCommit: () => {}
		});
		expect(screen.queryByLabelText('Draw rgb on the map')).toBeNull();
	});

	it('says what to type when the field is empty', () => {
		open();
		expect(screen.getByPlaceholderText('west, south, east, north')).toBeTruthy();
	});

	// Focusing is enough to see it: no button press to find out where in the world the value is.
	it('puts what the field holds on the map when it is focused', () => {
		open('[13, 52.3, 13.8, 52.7]');
		screen.getByRole('textbox').focus();
		flushSync();
		expect(bboxField.shown).toEqual([13, 52.3, 13.8, 52.7]);
	});

	it('asks the map to draw, and marks the button while it is', () => {
		open();
		button().click();
		flushSync();
		expect(bboxField.drawing).toBe(true);
		expect(button().getAttribute('aria-pressed')).toBe('true');
	});

	it('writes a drawn rectangle into the field', () => {
		const onCommit = vi.fn();
		open('', onCommit);
		button().click();
		flushSync();

		bboxField.finish([13, 52.3, 13.8, 52.7]);
		expect(onCommit).toHaveBeenCalledWith('13, 52.3, 13.8, 52.7');
	});

	// A node closed while its rectangle was on screen would otherwise leave it there with nothing
	// left to edit it.
	it('gives the map back when the row goes', () => {
		const view = open('[13, 52.3, 13.8, 52.7]');
		screen.getByRole('textbox').focus();
		flushSync();
		expect(bboxField.shown).not.toBeNull();

		view.unmount();
		flushSync();
		expect(bboxField.shown).toBeNull();
	});
});

/**
 * Fields with a short list of answers ([Q56]).
 *
 * A `tile_size` is a `u32` by type and "256 or 512" by meaning. Offered as a number box it accepts
 * 400 and the operation refuses it later; offered as a list it cannot be got wrong.
 */
describe('a field with a set of answers', () => {
	const open = (over: Record<string, unknown> = {}, value = '', onCommit: (raw: string) => void = () => {}) =>
		render(NodeArgument, { name: 'tile_size', field: CHOICE_FIELD(over), value, onCommit });

	it('offers the set rather than a box to type in', () => {
		open();
		const select = screen.getByRole('combobox') as HTMLSelectElement;
		expect([...select.options].map((option) => option.value)).toContain('256');
		expect([...select.options].map((option) => option.value)).toContain('512');
	});

	/**
	 * A `<select>` shows its first entry when nothing matches, so an unset parameter displayed as
	 * `256` while the document said nothing - and the first interaction wrote a value nobody chose.
	 */
	it('shows a field the document does not set as unset', () => {
		open({ default: '512' });
		const select = screen.getByRole('combobox') as HTMLSelectElement;
		expect(select.value).toBe('');
		expect(select.options[0].textContent).toContain('512');
	});

	it('says only that it is unset when there is no default to name', () => {
		open();
		expect((screen.getByRole('combobox') as HTMLSelectElement).options[0].textContent).toContain('—');
	});

	it('shows the value the document does set', () => {
		open({}, '256');
		expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('256');
	});

	// Clearing is what an empty box does everywhere else in this form.
	it('can be put back to unset', () => {
		const onCommit = vi.fn();
		open({}, '256', onCommit);
		const select = screen.getByRole('combobox') as HTMLSelectElement;
		select.value = '';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		expect(onCommit).toHaveBeenCalledWith('');
	});

	// A required field that already has a value has nothing to be unset to.
	it('offers no empty entry for a required field that is set', () => {
		open({ required: true }, '512');
		const select = screen.getByRole('combobox') as HTMLSelectElement;
		expect([...select.options].map((option) => option.value)).not.toContain('');
	});
});

/**
 * The swatch beside a colour parameter ([Q57]).
 *
 * **Beside, not instead**: `RRGGBBAA` has an alpha a native colour input cannot express, so the field
 * stays and the swatch is the way to choose rather than the only way to say.
 */
describe('a colour field', () => {
	const open = (hex: boolean, value = '', onCommit: (raw: string) => void = () => {}) =>
		render(NodeArgument, { name: 'color', field: COLOR_FIELD(hex), value, onCommit });

	const swatch = () => screen.getByLabelText('Colour for color') as HTMLInputElement;

	it('offers a swatch, and keeps the field beside it', () => {
		open(true, 'ff8800');
		expect(swatch().type).toBe('color');
		expect(screen.getByRole('textbox')).toBeTruthy();
	});

	it('shows what the field holds, in either spelling', () => {
		open(true, 'ff8800');
		expect(swatch().value).toBe('#ff8800');
		cleanup();
		open(false, '255, 136, 0');
		expect(swatch().value).toBe('#ff8800');
	});

	// An input defaulting to black would say the parameter is set to black.
	it('says it has nothing to show rather than showing black', () => {
		open(true);
		expect(swatch().classList.contains('empty')).toBe(true);
		expect(swatch().title).toMatch(/not set/);
	});

	it('writes hex without the # the operation does not want', () => {
		const onCommit = vi.fn();
		open(true, '000000', onCommit);
		const input = swatch();
		input.value = '#ff8800';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		expect(onCommit).toHaveBeenCalledWith('ff8800');
	});

	it('writes three numbers for the operation that takes them', () => {
		const onCommit = vi.fn();
		open(false, '0, 0, 0', onCommit);
		const input = swatch();
		input.value = '#ff8800';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		expect(onCommit).toHaveBeenCalledWith('255, 136, 0');
	});

	it('says how the field is written when it is empty', () => {
		open(true);
		expect(screen.getByPlaceholderText('RRGGBB')).toBeTruthy();
		cleanup();
		open(false);
		expect(screen.getByPlaceholderText('r, g, b')).toBeTruthy();
	});

	it('offers none for a field that is not a colour', () => {
		render(NodeArgument, { name: 'layer_name', value: 'roads', onCommit: () => {} });
		expect(screen.queryByLabelText('Colour for layer_name')).toBeNull();
	});
});
