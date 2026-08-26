// @vitest-environment jsdom

/**
 * What the inspector answers about (A6).
 *
 * **Two sides of one question, and the pane has to keep them apart.** A pipeline exists to change
 * the format, the zoom range and the extent, so "what did I read" and "what did that turn into" are
 * different answers - and the pane showed only the first, which made it look like a file browser.
 * Which side each figure belongs to is invisible in the markup, so it is asserted here.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import Inspector from './Inspector.svelte';
import type { ContainerInfo } from '../../ipc/commands';

const info = (over: Partial<ContainerInfo> = {}): ContainerInfo =>
	({
		source: '/data/berlin.mbtiles',
		container: 'mbtiles',
		tileFormat: 'mvt',
		tileCompression: 'gzip',
		minZoom: 0,
		maxZoom: 12,
		bbox: [13, 52, 14, 53],
		tileSchema: null,
		tileJson: {},
		...over
	}) as ContainerInfo;

afterEach(cleanup);

describe('the inspector', () => {
	it('says so when there is nothing to describe', () => {
		render(Inspector, { containers: [], result: null, graph: null });
		expect(screen.getByText('Nothing open.')).toBeTruthy();
	});

	it('describes what the selected graph produced', () => {
		render(Inspector, {
			containers: [],
			graph: 'berlin',
			result: info({ container: 'pipeline', maxZoom: 14, tileCompression: 'none' })
		});
		expect(screen.getByRole('heading', { name: 'berlin' })).toBeTruthy();
		expect(screen.getByText('0-14')).toBeTruthy();
	});

	/**
	 * `describe` labels a pipeline's output `preview` - a name for the mount, not for the thing.
	 * Printing it would put a word in the pane that means nothing to the person reading it.
	 */
	it('names the result after the graph, not after the mount', () => {
		render(Inspector, { containers: [], graph: 'berlin', result: info({ source: 'preview' }) });
		expect(screen.queryByText('preview')).toBeNull();
	});

	/**
	 * A pipeline that will not build is exactly when someone opens this pane, and the inputs are
	 * half the answer - the file is fine, the pipeline is not. Hiding the section would leave the
	 * pane silent about the question it exists for.
	 */
	it('says a graph has not built, and still describes what it reads', () => {
		render(Inspector, { containers: [info()], graph: 'berlin', result: null });
		expect(screen.getByText('Not built.')).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'berlin.mbtiles' })).toBeTruthy();
	});

	// The result is what the map draws, so it is read first; the inputs explain it.
	it('puts the result above the inputs', () => {
		render(Inspector, { containers: [info()], graph: 'berlin', result: info({ source: 'preview' }) });
		const headings = screen.getAllByRole('heading').map((node) => node.textContent);
		expect(headings.indexOf('berlin')).toBeLessThan(headings.indexOf('berlin.mbtiles'));
	});

	// Both sides carry the same figures, which is what makes them comparable at a glance.
	it('shows each side its own zoom range', () => {
		render(Inspector, {
			containers: [info({ minZoom: 0, maxZoom: 12 })],
			graph: 'berlin',
			result: info({ source: 'preview', minZoom: 4, maxZoom: 14 })
		});
		expect(screen.getByText('0-12')).toBeTruthy();
		expect(screen.getByText('4-14')).toBeTruthy();
	});

	// With no graph selected there is no result to miss, and the pane is what it always was.
	it('describes containers alone when no graph is selected', () => {
		render(Inspector, { containers: [info()], result: null, graph: null });
		expect(screen.queryByText('Not built.')).toBeNull();
		expect(screen.getByRole('heading', { name: 'berlin.mbtiles' })).toBeTruthy();
	});
});
