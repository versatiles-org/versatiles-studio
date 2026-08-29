// @vitest-environment jsdom

/**
 * What the pane paints over the document, and which document it belongs to.
 *
 * **The draft outlives one keystroke and must not outlive one document.** Typing produces text that
 * is often mid-edit and invalid, so the pane keeps the last review - the tokens to highlight with
 * and whatever the parser said - and paints that over the editor rather than going blank. Those are
 * a fact about *that* text, and nothing was clearing them when the document changed underneath.
 *
 * Two ways it showed. The token spans are offsets into the text they came from, so another graph's
 * text was painted with them and the highlighting slid off the words. And a parse error left the
 * graph tab saying "The graph returns when the text parses" over a document that parses perfectly
 * well - which reads as the pane being broken, one selection after the mistake was made.
 *
 * Rendered rather than reasoned about: the rule is one `$effect` against a prop, and what it
 * decides is which of two things the tab draws.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import PipelinePane from './PipelinePane.svelte';
import type { DocumentView, VplNode, VplPipeline } from '../../ipc/commands';

const ipc = vi.hoisted(() => ({ vplReview: vi.fn() }));
vi.mock('../../ipc/commands', () => ipc);

/** A node with nothing but a name and somewhere to be. */
const node = (name: string): VplNode => ({
	name,
	nameSpan: { start: 0, end: name.length },
	properties: [],
	sources: [],
	sourcesSpan: null,
	span: { start: 0, end: name.length }
});

/** A document the pane can draw. Only the fields it reads are filled in. */
const document = (name: string): DocumentView =>
	({
		graph: 1,
		name,
		text: name,
		pipeline: { nodes: [node(name)], span: { start: 0, end: name.length } } as VplPipeline,
		tokens: [],
		diagnostics: [],
		canUndo: false,
		canRedo: false,
		path: null,
		dirty: false
	}) as DocumentView;

const noop = () => {};

const nodeActions = {
	setEnabled: noop,
	addOperation: noop,
	remove: noop,
	commitValue: noop,
	removeProperty: noop,
	setProperty: noop
};

const documentActions = { change: noop, undo: noop, redo: noop, format: noop, save: noop, export: noop };

function pane(pipeline: DocumentView, pipelineRevision: number) {
	return render(PipelinePane, {
		pipeline,
		pipelineRevision,
		crop: null,
		cropActions: { set: noop, draw: noop, useView: noop },
		nodeActions,
		documentActions
	});
}

/** Opens one of the two tabs. `fireEvent` is what flushes the render that follows. */
const open = (name: RegExp) => fireEvent.click(screen.getByRole('tab', { name }));

/** Types into the VPL editor, and lets the review this kicks off settle. */
async function type(text: string) {
	await fireEvent.input(screen.getByLabelText('VPL pipeline'), { target: { value: text } });
	await vi.waitFor(() => expect(ipc.vplReview).toHaveBeenCalled());
	// A turn per `await` in `type()`, so the reply it settles on has been painted.
	await tick();
	await tick();
}

afterEach(() => {
	cleanup();
	vi.resetAllMocks();
});

describe('a draft that belongs to another document', () => {
	/**
	 * The one a person meets: type something that does not parse, pick another graph from the list,
	 * and the pane reports the first graph's mistake about the second one.
	 */
	it('stops reporting a parse error once the document changes', async () => {
		const { rerender } = pane(document('from_debug'), 1);

		await open(/VPL/);
		ipc.vplReview.mockRejectedValue({ message: 'unexpected |', span: { start: 3, end: 4 } });
		await type('from_debug |');

		expect(screen.getAllByRole('alert')[0].textContent).toContain('unexpected |');

		// Another graph, which is what a revision bump means.
		await rerender({ pipeline: document('from_color'), pipelineRevision: 2 });

		expect(screen.queryByText('unexpected |')).toBeNull();
	});

	/// The same fact from the other side: the graph tab draws the chain again rather than the note
	/// that stands in for it while the text does not parse.
	it('draws the graph again once the document changes', async () => {
		const { rerender } = pane(document('from_debug'), 1);

		await open(/VPL/);
		ipc.vplReview.mockRejectedValue({ message: 'unexpected |', span: { start: 3, end: 4 } });
		await type('from_debug |');

		await open(/Graph/);
		expect(screen.getByText('The graph returns when the text parses.')).toBeTruthy();

		await rerender({ pipeline: document('from_color'), pipelineRevision: 2 });

		expect(screen.queryByText('The graph returns when the text parses.')).toBeNull();
	});

	/// The badge counts what the pane is painting, so it is the cheapest witness that the *tokens*
	/// and the diagnostics went with the error rather than only the error going.
	it('drops a review that was about the previous document', async () => {
		const { rerender } = pane(document('from_debug'), 1);

		await open(/VPL/);
		ipc.vplReview.mockResolvedValue({
			tokens: [{ kind: 'operation', span: { start: 0, end: 10 } }],
			diagnostics: [{ message: 'filename is not set', span: { start: 0, end: 10 } }]
		});
		await type('from_container');

		expect(screen.getByLabelText('1 problems')).toBeTruthy();

		await rerender({ pipeline: document('from_color'), pipelineRevision: 2 });

		expect(screen.queryByLabelText('1 problems')).toBeNull();
	});
});
