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
		render(NodeArgument, { name: 'filename', value: '', onCommit: () => {} });

		expect(screen.getByLabelText('Choose a file for filename')).toBeTruthy();
	});

	// By key rather than by value: `layer_name` is not a path however many slashes it holds.
	it('offers none for a field that is not a path', () => {
		render(NodeArgument, { name: 'layer_name', value: 'a/b', onCommit: () => {} });

		expect(screen.queryByLabelText('Choose a file for layer_name')).toBeNull();
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
				control: { kind: 'number', integer: true, min: null, max: null }
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
		render(NodeArgument, { name: 'filename', value: '', onCommit });

		screen.getByLabelText('Choose a file for filename').click();
		await vi.waitFor(() => expect(onCommit).toHaveBeenCalledWith('/tmp/berlin.versatiles'));
	});

	// Cancelling must not clear a value that is already there: an empty commit removes the
	// parameter from the document, which is a deletion nobody asked for.
	it('leaves the field alone when the dialog is cancelled', async () => {
		const onCommit = vi.fn();
		picks(null);
		render(NodeArgument, { name: 'filename', value: '/tmp/berlin.versatiles', onCommit });

		screen.getByLabelText('Choose a file for filename').click();
		await vi.waitFor(() => expect(tauri.calls.some((call) => call.cmd === 'plugin:dialog|open')).toBe(true));
		expect(onCommit).not.toHaveBeenCalled();
	});

	// The operation is what says which files are worth offering - the same catalogue File → Open
	// uses for it. One filter and no "All files" beside it: macOS flattens the list rather than
	// offering a menu, so a second entry would be a choice nobody could make there.
	it('filters to what the node reads', async () => {
		picks('/tmp/berlin.versatiles');
		render(NodeArgument, { name: 'filename', value: '', kind: CONTAINER, onCommit: () => {} });

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
		render(NodeArgument, { name: 'sprite_file', value: '', onCommit: () => {} });

		screen.getByLabelText('Choose a file for sprite_file').click();
		await vi.waitFor(() => expect(tauri.calls.some((call) => call.cmd === 'plugin:dialog|open')).toBe(true));

		const options = tauri.calls.find((call) => call.cmd === 'plugin:dialog|open')?.args.options as {
			filters?: unknown;
		};
		expect(options.filters).toBeUndefined();
	});
});
