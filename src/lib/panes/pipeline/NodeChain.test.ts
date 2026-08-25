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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import NodeChain from './NodeChain.svelte';
import type { VplNode, VplPipeline } from '../../ipc/commands';

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
