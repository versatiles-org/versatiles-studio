// @vitest-environment jsdom

/**
 * What "+ new graph…" offers ([Q50]), and that it offers it in a popup ([Q58]).
 *
 * **Three doors, and a test that counts them.** This was one card per import kind, and the way that
 * went wrong was not a broken card - it was the operations no card named. Only a count catches a
 * fourth door arriving by habit, so this counts rather than naming the three and hoping; the comment
 * here claimed a count for two releases while the test below checked two labels and a card.
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

const actions = () => ({ addNode: vi.fn(), openSource: vi.fn(), openPipeline: vi.fn() });

/** The pane over an empty project, with the graph list's + row showing. */
function open(extra: { addNode: () => void; openSource: () => void; openPipeline: () => void }) {
	render(SourcesPane, {
		operations: OPERATIONS as never,
		graphs: [],
		current: null,
		actions: {
			select: () => {},
			rename: () => {},
			remove: () => {},
			setEnabled: () => {},
			...extra
		}
	});
	screen.getByText('+ new graph…').click();
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
	it('offers three doors and no fourth', async () => {
		open(actions());

		expect(await screen.findByText('From a file…')).toBeTruthy();
		expect(screen.getByText('From VPL node…')).toBeTruthy();
		expect(screen.getByText('From VPL file…')).toBeTruthy();
		expect(screen.getAllByRole('menuitem')).toHaveLength(3);
		// The cards these replaced: a kind is not a way to start a graph any more.
		expect(screen.queryByText('Tile container')).toBeNull();
	});

	/**
	 * **The data door names no format.** It was a card per kind once, and the failure was the kinds no
	 * card named; a door per format is the same mistake spelled differently, and three formats wear
	 * `.json` besides - which one a file is is the catalogue's answer, from the file (S3.2).
	 */
	it('does not offer a door per format', async () => {
		open(actions());
		await screen.findByText('From a file…');

		for (const format of ['GeoJSON', 'CSV', 'GeoTIFF', 'PMTiles', 'Tile container']) {
			expect(screen.queryByText(format), `${format} should not be a door`).toBeNull();
		}
	});

	/// The one this door is for: pick any file and let Studio read it, the way a dropped file is read.
	it('opens any file Studio can read through the first door', async () => {
		const graphActions = actions();
		open(graphActions);

		(await screen.findByText('From a file…')).click();

		expect(graphActions.openSource).toHaveBeenCalled();
		expect(graphActions.openPipeline).not.toHaveBeenCalled();
		expect(graphActions.addNode).not.toHaveBeenCalled();
	});

	/**
	 * **The doors are not in the layout until they are asked for.** They used to be revealed in flow,
	 * which pushed the pane below them down - so the choices moved while you read them, and sat in the
	 * list they had appeared under as though they were part of it.
	 */
	it('shows nothing at all until the menu is opened', () => {
		render(SourcesPane, {
			operations: OPERATIONS as never,
			graphs: [],
			current: null,
			actions: {
				select: () => {},
				rename: () => {},
				remove: () => {},
				setEnabled: () => {},
				...actions()
			}
		});

		expect(screen.queryByText('From VPL node…')).toBeNull();
		expect(screen.getByText('+ new graph…')).toBeTruthy();
	});

	// Every operation a chain can begin with, including the three that open no file and so had no
	// card to be chosen from.
	it('offers every read operation behind the node door, and no transform', async () => {
		open(actions());

		(await screen.findByText('From VPL node…')).click();

		expect(await screen.findByText('from_container')).toBeTruthy();
		expect(screen.getByText('from_debug')).toBeTruthy();
		expect(screen.queryByText('raster_overview')).toBeNull();
	});

	// A door that leads to another list leaves the menu where it is, rather than closing and
	// reopening under the same button.
	it('stays open while walking into the operations', async () => {
		open(actions());

		(await screen.findByText('From VPL node…')).click();
		await screen.findByText('from_container');

		expect(screen.getByRole('menu')).toBeTruthy();
		expect(screen.queryByText('From VPL file…')).toBeNull();
	});

	it('starts a graph on the operation that was picked', async () => {
		const graphActions = actions();
		open(graphActions);

		(await screen.findByText('From VPL node…')).click();
		(await screen.findByText('from_debug')).click();

		expect(graphActions.addNode).toHaveBeenCalledWith('from_debug');
		expect(graphActions.openPipeline).not.toHaveBeenCalled();
	});

	it('opens a written pipeline through the other door', async () => {
		const graphActions = actions();
		open(graphActions);

		(await screen.findByText('From VPL file…')).click();

		expect(graphActions.openPipeline).toHaveBeenCalled();
		expect(graphActions.openSource).not.toHaveBeenCalled();
		expect(graphActions.addNode).not.toHaveBeenCalled();
	});

	// Reopening on a list somebody had walked into would answer a question they had not asked again.
	it('comes back to the doors after it has been closed', async () => {
		open(actions());
		(await screen.findByText('From VPL node…')).click();

		screen.getByText('+ new graph…').click();
		screen.getByText('+ new graph…').click();

		expect(await screen.findByText('From VPL node…')).toBeTruthy();
	});
});
