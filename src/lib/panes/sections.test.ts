// @vitest-environment jsdom

/**
 * The connected half of every pane (S8.10).
 *
 * Each `*Section` reads the state modules and hands its pane data and actions - which is the wiring
 * that used to be one arm of `App.svelte`, where it could only be checked by opening the application.
 * What is asserted here is the thread they all hang from: the selection, named once as
 * `workbench.selected`, reaches each pane that follows it.
 *
 * The backend is stubbed - see `lib/testing/tauri.ts` for what that does and does not prove.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tick } from 'svelte';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { DocumentView, GraphInfo } from '../ipc/commands';
import { document } from '../state/document.svelte';
import { graphs } from '../state/graphs.svelte';
import { workbench } from '../state/workbench.svelte';
import { stubTauri, type TauriStub } from '../testing/tauri';
import { PANES, type PaneId } from './registry';

const graph = (id: number, name: string): GraphInfo => ({
	id,
	name,
	path: null,
	dirty: false,
	crop: { bbox: null, minZoom: null, maxZoom: null },
	enabled: true,
	disabled: [],
	nodes: 1,
	running: 1
});

const doc = (id: number, name: string): DocumentView =>
	({
		graph: id,
		name,
		text: 'from_debug',
		pipeline: {
			nodes: [
				{
					name: 'from_debug',
					nameSpan: { start: 0, end: 10 },
					properties: [],
					sources: [],
					sourcesSpan: null,
					span: { start: 0, end: 10 }
				}
			],
			span: { start: 0, end: 10 }
		},
		tokens: [],
		diagnostics: [],
		canUndo: false,
		canRedo: false,
		path: null,
		dirty: false
	}) as unknown as DocumentView;

let tauri: TauriStub;

beforeEach(() => {
	tauri = stubTauri({ graphs: [], field_suggestions: [] });
	Element.prototype.scrollIntoView = () => {};
});

afterEach(async () => {
	cleanup();
	document.show(null);
	await graphs.refresh();
	tauri.restore();
});

// `as never`: the registry holds a union of five component types, and the testing library wants one.
const section = (id: PaneId) => render(PANES[id].component as never);

describe('an empty window', () => {
	it('renders every pane, each saying it has nothing yet', () => {
		for (const id of Object.keys(PANES) as PaneId[]) section(id);
		expect(screen.getByText('No sources yet.')).toBeTruthy();
		expect(screen.getByText('No source selected.')).toBeTruthy();
		expect(screen.getByText(/Nothing to style yet/)).toBeTruthy();
		expect(screen.getByText('Nothing is being drawn yet.')).toBeTruthy();
	});

	it('has no selection', () => {
		expect(workbench.selected).toBeNull();
	});
});

describe('the one selection', () => {
	beforeEach(async () => {
		tauri.answer('graphs', [graph(1, 'berlin'), graph(2, 'hamburg')]);
		await graphs.refresh();
		document.show(doc(2, 'hamburg'));
	});

	it('is the document on screen, by id and by name', () => {
		expect(workbench.selected).toEqual({ id: 2, name: 'hamburg' });
	});

	it('highlights that row in Sources', async () => {
		section('sources');
		await tick();
		expect(screen.getByText('hamburg').closest('li')?.classList.contains('current')).toBe(true);
		expect(screen.getByText('berlin').closest('li')?.classList.contains('current')).toBe(false);
	});

	it('shows that document in Pipeline', async () => {
		section('pipeline');
		await tick();
		expect(screen.queryByText('No source selected.')).toBeNull();
		expect(screen.getByText('from_debug')).toBeTruthy();
	});
});
