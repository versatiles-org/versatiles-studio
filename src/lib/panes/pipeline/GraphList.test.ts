// @vitest-environment jsdom

/**
 * The eyes in the sources list ([Q49]).
 *
 * **This is the layers panel**, so the two questions it answers have to stay apart: the eye says
 * whether a source is drawn, the highlight says which one you are editing, and neither moves the
 * other. That independence is the whole model and it is invisible in the markup, so it is asserted
 * here rather than read.
 *
 * [Q49]: ../../../../docs/decisions.md
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import GraphList from './GraphList.svelte';
import type { GraphInfo } from '../../ipc/commands';

const graph = (over: Partial<GraphInfo> & { id: number; name: string }): GraphInfo =>
	({
		path: null,
		dirty: false,
		crop: { bbox: null, minZoom: null, maxZoom: null },
		enabled: true,
		disabled: [],
		nodes: 3,
		running: 3,
		...over
	}) as GraphInfo;

const noop = () => {};

function list(graphs: GraphInfo[], onToggle = vi.fn(), onSelect = vi.fn(), onReorder = vi.fn()) {
	render(GraphList, {
		graphs,
		current: graphs[0]?.id ?? null,
		onSelect,
		onToggle,
		onReorder,
		onRename: noop,
		onRemove: noop
	});
	return { onToggle, onSelect, onReorder };
}

afterEach(cleanup);

describe('the eye on a row', () => {
	it('offers to switch off a graph that is on, and on one that is off', () => {
		list([graph({ id: 1, name: 'basemap' }), graph({ id: 2, name: 'hillshade', enabled: false })]);

		expect(screen.getByLabelText('Switch off basemap')).toBeTruthy();
		expect(screen.getByLabelText('Switch on hillshade')).toBeTruthy();
	});

	it('switches the graph it belongs to', () => {
		const { onToggle } = list([graph({ id: 1, name: 'basemap' }), graph({ id: 2, name: 'hillshade' })]);

		screen.getByLabelText('Switch off hillshade').click();

		expect(onToggle).toHaveBeenCalledWith(2, false);
	});

	// **Selection and visibility are independent**, as in every layers panel: clicking the eye must
	// not select the row, and selecting a row must not draw it.
	it('does not change what is being edited', () => {
		const { onSelect } = list([graph({ id: 1, name: 'basemap' }), graph({ id: 2, name: 'hillshade' })]);

		screen.getByLabelText('Switch off hillshade').click();

		expect(onSelect).not.toHaveBeenCalled();
	});

	// A graph you cannot see is still one you can open and work on.
	it('leaves a switched-off graph selectable', () => {
		const { onSelect } = list([graph({ id: 1, name: 'basemap' }), graph({ id: 2, name: 'hillshade', enabled: false })]);

		screen.getByRole('button', { name: 'hillshade' }).click();

		expect(onSelect).toHaveBeenCalledWith(2);
	});
});

describe('what a row says about the nodes inside it', () => {
	// The chain is only on screen for the graph being edited, so without this the eyes inside one
	// graph would be invisible from every other row.
	it('says how much of a half-run graph runs', () => {
		list([graph({ id: 1, name: 'basemap', nodes: 5, running: 3, disabled: [[2]] })]);

		expect(screen.getByText('3/5')).toBeTruthy();
	});

	it('says nothing when all of it runs', () => {
		list([graph({ id: 1, name: 'basemap', nodes: 5, running: 5 })]);

		expect(screen.queryByText('5/5')).toBeNull();
	});

	// The eye already says so, and "0/5" beside it would be the same fact twice.
	it('says nothing when the graph itself is off', () => {
		list([graph({ id: 1, name: 'basemap', nodes: 5, running: 0, enabled: false })]);

		expect(screen.queryByText('0/5')).toBeNull();
	});
});

/**
 * **The row order is the draw order** ([Q50]). The style pane used to keep a second list for this,
 * over the sources that had built - so a graph that would not build had no way to be moved.
 */
describe('arranging the stack', () => {
	it('moves a graph up or down', () => {
		const { onReorder } = list([graph({ id: 1, name: 'labels' }), graph({ id: 2, name: 'basemap' })]);

		screen.getByLabelText('Move basemap up').click();
		expect(onReorder).toHaveBeenCalledWith(2, 1);

		screen.getByLabelText('Move labels down').click();
		expect(onReorder).toHaveBeenCalledWith(1, -1);
	});

	// At the ends there is nowhere to go. Disabled rather than hidden, so the controls in a row do
	// not shift under the pointer as a graph moves.
	it('offers no move past either end', () => {
		list([graph({ id: 1, name: 'labels' }), graph({ id: 2, name: 'basemap' })]);

		const disabled = (label: string) => (screen.getByLabelText(label) as HTMLButtonElement).disabled;
		expect(disabled('Move labels up')).toBe(true);
		expect(disabled('Move basemap down')).toBe(true);
		expect(disabled('Move labels down')).toBe(false);
	});

	// One source has no top to be on.
	it('offers no reordering at all for a single graph', () => {
		list([graph({ id: 1, name: 'only' })]);

		expect(screen.queryByLabelText('Move only up')).toBeNull();
	});
});

/**
 * **The case that had never been drawn.** Both sidebars were hidden while a project had no sources
 * ([Q54]), so an empty list was unreachable - and the way in is `＋ new graph…`, which lives in this
 * list. Hiding it for exactly as long as there was nothing to list left the File menu as the only
 * door.
 */
describe('a project with no sources', () => {
	// The way in is the caller's control, rendered at the foot of the list ([Q58]) - so what this
	// list owes is the place for it, whether or not there is anything above it.
	it('still keeps the place the way in goes', () => {
		render(GraphList, { graphs: [], current: null } as never);
		expect(document.querySelector('li.new')).toBeTruthy();
	});

	// An empty `<ul>` above a `＋` reads as a list that failed to load, not as one nobody has filled
	// in yet.
	it('says the list is empty rather than showing an empty list', () => {
		render(GraphList, { graphs: [], current: null } as never);
		expect(screen.getByText('No sources yet.')).toBeTruthy();
	});

	it('says nothing of the sort once there is a source', () => {
		render(GraphList, { graphs: [graph({ id: 1, name: 'berlin' })], current: 1 } as never);
		expect(screen.queryByText('No sources yet.')).toBeNull();
	});
});
