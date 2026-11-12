// @vitest-environment jsdom

/**
 * The eyes in the chain ([Q49]).
 *
 * **A bypass, not a cut.** The rule this replaced asked whether a node reached the pin, so
 * switching one node off darkened every node after it and one branch of a `from_stacked` darkened
 * its sibling. Both of those are what a rendered chain shows and a pure function cannot, which is
 * why this renders one.
 *
 * [Q49]: ../../../../docs/decisions.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import { fireEvent } from '@testing-library/dom';
import NodeChain from './NodeChain.svelte';
import type { FieldInfo, OperationInfo, VplNode, VplPipeline } from '../../ipc/commands';

/** A node with nothing but a name and somewhere to be. */
function node(name: string, sources: VplPipeline[] = []): VplNode {
	return {
		name,
		nameSpan: { start: 0, end: name.length },
		properties: [],
		sources,
		sourcesSpan: null,
		span: { start: 0, end: name.length }
	};
}

const pipeline = (nodes: VplNode[]): VplPipeline => ({ nodes, span: { start: 0, end: 1 } });

/** `from_stacked [ from_debug | raster_flatten, from_color ] | raster_overview` */
const stacked = pipeline([
	node('from_stacked', [pipeline([node('from_debug'), node('raster_flatten')]), pipeline([node('from_color')])]),
	node('raster_overview')
]);

const noop = () => {};

function chain(input: { pipeline: VplPipeline; disabled?: number[][]; enabled?: boolean; onToggle?: () => void }) {
	const onToggle = input.onToggle ?? vi.fn();
	render(NodeChain, {
		pipeline: input.pipeline,
		disabled: input.disabled ?? [],
		enabled: input.enabled ?? true,
		onToggle,
		onCommit: noop,
		onRemove: noop,
		onSet: noop,
		onRemoveNode: noop,
		onAddOperation: noop
	});
	return onToggle;
}

/** Whether that node's eye is on, read off the button it is drawn in. */
const isOn = (name: string) => screen.getByLabelText(`Switch off ${name}`, { exact: true }) !== null;
const isOff = (name: string) => screen.queryByLabelText(`Switch on ${name}`, { exact: true }) !== null;

afterEach(cleanup);

describe('what the eyes show', () => {
	it('is every node on, by default', () => {
		chain({ pipeline: pipeline([node('from_debug'), node('filter'), node('raster_flatten')]) });

		expect(isOn('from_debug')).toBe(true);
		expect(isOn('filter')).toBe(true);
		expect(isOn('raster_flatten')).toBe(true);
	});

	// **The whole difference from the pin.** The nodes after a switched-off one keep running: the
	// tiles skip it rather than stopping at it.
	it('leaves the nodes after a switched-off one running', () => {
		chain({
			pipeline: pipeline([node('from_debug'), node('filter'), node('raster_flatten')]),
			disabled: [[1]]
		});

		expect(isOn('from_debug')).toBe(true);
		expect(isOff('filter')).toBe(true);
		expect(isOn('raster_flatten')).toBe(true);
	});

	// The case a cut point could not express at all.
	it('leaves the other branch and everything after the composite running', () => {
		chain({ pipeline: stacked, disabled: [[0, 1, 0]] });

		expect(isOff('from_color')).toBe(true);
		expect(isOn('from_debug')).toBe(true);
		expect(isOn('raster_flatten')).toBe(true);
		expect(isOn('from_stacked')).toBe(true);
		expect(isOn('raster_overview')).toBe(true);
	});

	// The graph's own switch is the head node's eye, so an off graph reads as an off chain without
	// the chain having to be told twice.
	it('shows the head as off when the graph is off', () => {
		chain({ pipeline: pipeline([node('from_debug'), node('filter')]), enabled: false });

		expect(isOff('from_debug')).toBe(true);
		expect(isOn('filter')).toBe(true);
	});
});

describe('what a click does', () => {
	it('switches off the node it belongs to, and nothing else', () => {
		const onToggle = chain({ pipeline: pipeline([node('from_debug'), node('filter'), node('raster_flatten')]) });

		screen.getByLabelText('Switch off filter').click();

		expect(onToggle).toHaveBeenCalledTimes(1);
		expect(onToggle).toHaveBeenCalledWith([1], false);
	});

	it('switches one back on', () => {
		const onToggle = chain({
			pipeline: pipeline([node('from_debug'), node('filter')]),
			disabled: [[1]]
		});

		screen.getByLabelText('Switch on filter').click();

		expect(onToggle).toHaveBeenCalledWith([1], true);
	});

	it('sends the nested path for a node inside a branch', () => {
		const onToggle = chain({ pipeline: stacked });

		screen.getByLabelText('Switch off from_color').click();

		expect(onToggle).toHaveBeenCalledWith([0, 1, 0], false);
	});
});

describe('problems', () => {
	//  from_debug(0..10) | raster_flatten(13..27)
	const positioned = pipeline([
		{ ...node('from_debug'), nameSpan: { start: 0, end: 10 }, span: { start: 0, end: 10 } },
		{ ...node('raster_flatten'), nameSpan: { start: 13, end: 27 }, span: { start: 13, end: 27 } }
	]);

	it('marks the node a problem points at, with its message, and no other', () => {
		render(NodeChain, {
			pipeline: positioned,
			disabled: [],
			enabled: true,
			problems: [{ message: 'unknown parameter', span: { start: 13, end: 27 } }],
			onToggle: noop,
			onCommit: noop,
			onRemove: noop,
			onSet: noop,
			onRemoveNode: noop,
			onAddOperation: noop
		});
		const marks = screen.getAllByRole('img', { name: 'unknown parameter' });
		expect(marks).toHaveLength(1);
		expect(marks[0].closest('.node')?.textContent).toContain('raster_flatten');
	});
});

// -- branches and sources -------------------------------------------------------------

const sources = (branches: boolean, maxSources: number | null = null): FieldInfo => ({
	name: 'sources',
	doc: '',
	required: true,
	sources: true,
	branches,
	maxSources,
	control: { kind: 'text' },
	accepts: [],
	default: null
});
const operation = (name: string, kind: string, fields: FieldInfo[] = []): OperationInfo => ({
	name,
	kind,
	summary: '',
	details: '',
	fields
});
const OPERATIONS = [
	operation('vector_branch', 'transform', [sources(true, 2)]),
	operation('from_stacked', 'read', [sources(false)]),
	operation('from_debug', 'read'),
	operation('vector_repair', 'transform')
];

/** `from_debug | vector_branch [ vector_mask, vector_filter_layers ]` */
const branched = pipeline([
	node('from_debug'),
	node('vector_branch', [pipeline([node('vector_mask')]), pipeline([node('vector_filter_layers')])])
]);

function show(input: VplPipeline) {
	const spies = { onAddOperation: vi.fn(), onAddOperationBefore: vi.fn(), onAddSource: vi.fn() };
	render(NodeChain, {
		pipeline: input,
		disabled: [],
		enabled: true,
		operations: OPERATIONS,
		onToggle: noop,
		onCommit: noop,
		onRemove: noop,
		onSet: noop,
		onRemoveNode: noop,
		...spies
	});
	return spies;
}

/** A slot of a box, by its name - `then`, `else`, `source 1`, or `another source`. */
const slot = (name: string) => screen.getByRole('region', { name });
/** A node's whole box, slots included. */
const box = (name: string) =>
	screen.getByLabelText(`Switch off ${name}`, { exact: true }).closest('.node') as HTMLElement;
/** Picks `operation` from the picker behind `button`. */
async function pick(button: HTMLElement, operation: string) {
	button.click();
	(await screen.findByRole('option', { name: operation })).click();
}
const span = (name: string) => ({ start: 0, end: name.length });

/** `from_debug | vector_branch [ vector_mask ]` - a `then`, and room for an `else`. */
const oneBranch = pipeline([node('from_debug'), node('vector_branch', [pipeline([node('vector_mask')])])]);

/**
 * **A node with sources is a box, and its sources are slots inside it.** Everything about the
 * sources - their operations, a new branch, a new source - is inside the box; the rail below it
 * only ever continues the chain the node is in.
 */
describe('a vector_branch', () => {
	// jsdom has no layout, so it has no `scrollIntoView` - the picker keeps the active row in view.
	beforeEach(() => {
		Element.prototype.scrollIntoView = () => {};
	});

	it('draws its branches inside its box, named then and else', () => {
		show(branched);
		expect(box('vector_branch').contains(slot('then'))).toBe(true);
		expect(box('vector_branch').contains(slot('else'))).toBe(true);
		expect(within(slot('then')).getByLabelText('Switch off vector_mask')).toBeTruthy();
		expect(within(slot('else')).getByLabelText('Switch off vector_filter_layers')).toBeTruthy();
	});

	it('keeps the chain’s own rail outside the box, after it', async () => {
		const { onAddOperation } = show(pipeline([...branched.nodes, node('vector_repair')]));
		const outside = screen
			.getAllByRole('button', { name: '+ operation…' })
			.filter((button) => !box('vector_branch').contains(button));
		// After from_debug, after vector_branch, after vector_repair.
		expect(outside).toHaveLength(3);
		await pick(outside[1], 'vector_repair');
		expect(onAddOperation).toHaveBeenCalledWith(span('vector_branch'), 'vector_repair');
	});

	// No "+ branch": `else` is always there, and filling it is what writes it.
	it('always shows else, empty meaning unchanged, and filling it adds the branch', async () => {
		const { onAddSource } = show(oneBranch);
		expect(slot('else').textContent).toContain('Unchanged: they pass through as they are.');
		await pick(within(slot('else')).getByRole('button', { name: '+ operation…' }), 'vector_repair');
		expect(onAddSource).toHaveBeenCalledWith(span('vector_branch'), 'vector_repair');
	});

	// VPL writes a branch by its position, and has no empty `then` to put before an `else`.
	it('fills then first, and has else wait for it', async () => {
		const { onAddSource } = show(pipeline([node('from_debug'), node('vector_branch')]));
		expect(within(slot('else')).queryByRole('button')).toBeNull();
		expect(slot('else').textContent).toContain('Add to then first.');
		await pick(within(slot('then')).getByRole('button', { name: '+ operation…' }), 'vector_repair');
		expect(onAddSource).toHaveBeenCalledWith(span('vector_branch'), 'vector_repair');
	});

	it('takes a transform at the start of a branch', async () => {
		const { onAddOperationBefore } = show(oneBranch);
		await pick(within(slot('then')).getByTestId('branch-start').querySelector('button')!, 'vector_repair');
		expect(onAddOperationBefore).toHaveBeenCalledWith(span('vector_mask'), 'vector_repair');
	});

	it('nests: a branch inside a branch is a box inside the slot', () => {
		const inner = node('vector_branch', [pipeline([node('vector_mask')])]);
		show(pipeline([node('from_debug'), node('vector_branch', [pipeline([node('vector_repair')]), pipeline([inner])])]));
		const otherwise = screen.getAllByRole('region', { name: 'else' });
		// The outer else, and the inner one's, which is inside it.
		expect(otherwise).toHaveLength(2);
		expect(otherwise[0].contains(otherwise[1])).toBe(true);
	});
});

/** The same box for a composite, whose sources are not fixed: the next one is a slot of its own. */
describe('a from_stacked', () => {
	beforeEach(() => {
		Element.prototype.scrollIntoView = () => {};
	});

	it('draws its sources inside its box, and a slot for the next', () => {
		show(stacked);
		for (const name of ['source 1', 'source 2', 'another source']) {
			expect(box('from_stacked').contains(slot(name)), name).toBe(true);
		}
		expect(within(slot('source 1')).getByLabelText('Switch off raster_flatten')).toBeTruthy();
	});

	it('offers the next source from the reads', async () => {
		const { onAddSource } = show(stacked);
		within(slot('another source')).getByRole('button', { name: '+ source…' }).click();
		expect(await screen.findByRole('option', { name: 'from_debug' })).toBeTruthy();
		expect(screen.queryByRole('option', { name: 'vector_repair' }), 'a source has to read').toBeNull();
		screen.getByRole('option', { name: 'from_debug' }).click();
		expect(onAddSource).toHaveBeenCalledWith(span('from_stacked'), 'from_debug');
	});

	it('has no start rail in a source, which begins with its read', () => {
		show(stacked);
		expect(screen.queryAllByTestId('branch-start')).toHaveLength(0);
	});
});

/** A slot folds to one line: its chain by name, how many, and whether anything in it is wrong. */
describe('a folded slot', () => {
	it('folds to its operations by name, and opens again', async () => {
		show(branched);
		const toggle = within(slot('then')).getByRole('button', { expanded: true });
		await fireEvent.click(toggle);

		expect(within(slot('then')).queryByLabelText('Switch off vector_mask')).toBeNull();
		expect(slot('then').textContent).toContain('vector_mask');
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		// The other branch is left as it was.
		expect(within(slot('else')).getByLabelText('Switch off vector_filter_layers')).toBeTruthy();

		await fireEvent.click(toggle);
		expect(within(slot('then')).getByLabelText('Switch off vector_mask')).toBeTruthy();
	});

	// Folding must not hide a problem: the line says one is there.
	it('still says when something inside it is wrong', async () => {
		const then = { nodes: [node('vector_mask')], span: { start: 10, end: 30 } };
		render(NodeChain, {
			pipeline: pipeline([node('from_debug'), node('vector_branch', [then])]),
			disabled: [],
			enabled: true,
			operations: OPERATIONS,
			problems: [{ message: 'needs a geojson', span: { start: 12, end: 23 } }],
			onToggle: noop,
			onCommit: noop,
			onRemove: noop,
			onSet: noop,
			onRemoveNode: noop,
			onAddOperation: noop
		});
		await fireEvent.click(within(slot('then')).getByRole('button', { expanded: true }));
		expect(within(slot('then')).getByRole('img', { name: 'needs a geojson' })).toBeTruthy();
	});

	it('has nothing to fold while empty', () => {
		show(oneBranch);
		expect(slot('then').querySelector('.disclosure')).toBeTruthy();
		// Its only button is the one that fills it.
		expect(slot('else').querySelector('.disclosure')).toBeNull();
	});
});
