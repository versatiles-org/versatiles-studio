// @vitest-environment jsdom

/**
 * What "＋ new graph…" offers ([Q50]).
 *
 * **Two doors, and a test that says two.** This was one card per import kind, and the way that went
 * wrong was not a broken card - it was the operations no card named. A count is the only assertion
 * that catches a sixth door arriving by habit.
 *
 * The backend is stubbed - see `lib/testing/tauri.ts` for what that does and does not prove.
 *
 * [Q50]: ../../../../docs/decisions.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import SourcesPane from './SourcesPane.svelte';
import { stubTauri, type TauriStub } from '../../testing/tauri';

const OPERATIONS = [
	{ name: 'from_container', kind: 'read', summary: 'reads a container', details: '', fields: [] },
	{ name: 'from_debug', kind: 'read', summary: 'draws its own tiles', details: '', fields: [] },
	{ name: 'raster_overview', kind: 'transform', summary: 'builds overviews', details: '', fields: [] }
];

let tauri: TauriStub;

const actions = () => ({ addNode: vi.fn(), openFile: vi.fn() });

/** The pane over an empty project, with the graph list's ＋ row showing. */
function open(extra: { addNode: () => void; openFile: () => void }) {
	render(SourcesPane, {
		operations: OPERATIONS as never,
		graphs: [],
		current: null,
		actions: {
			select: () => {},
			rename: () => {},
			remove: () => {},
			setEnabled: () => {},
			reorder: () => {},
			...extra
		}
	});
	screen.getByText('＋ new graph…').click();
}

beforeEach(() => {
	tauri = stubTauri();
	// jsdom has no layout, so it has no `scrollIntoView` - the picker keeps the active row in view.
	Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
	cleanup();
	tauri.restore();
});

describe('starting a graph', () => {
	it('offers two doors and no third', async () => {
		open(actions());

		expect(await screen.findByText('from VPL node…')).toBeTruthy();
		expect(screen.getByText('from VPL file…')).toBeTruthy();
		// The cards these replaced: a kind is not a way to start a graph any more.
		expect(screen.queryByText('Tile container')).toBeNull();
	});

	// Every operation a chain can begin with, including the three that open no file and so had no
	// card to be chosen from.
	it('offers every read operation behind the node door, and no transform', async () => {
		open(actions());

		(await screen.findByText('from VPL node…')).click();

		expect(await screen.findByText('from_container')).toBeTruthy();
		expect(screen.getByText('from_debug')).toBeTruthy();
		expect(screen.queryByText('raster_overview')).toBeNull();
	});

	it('starts a graph on the operation that was picked', async () => {
		const graphActions = actions();
		open(graphActions);

		(await screen.findByText('from VPL node…')).click();
		(await screen.findByText('from_debug')).click();

		expect(graphActions.addNode).toHaveBeenCalledWith('from_debug');
		expect(graphActions.openFile).not.toHaveBeenCalled();
	});

	it('opens a written pipeline through the other door', async () => {
		const graphActions = actions();
		open(graphActions);

		(await screen.findByText('from VPL file…')).click();

		expect(graphActions.openFile).toHaveBeenCalled();
		expect(graphActions.addNode).not.toHaveBeenCalled();
	});
});
