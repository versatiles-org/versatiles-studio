// @vitest-environment jsdom

/**
 * One part of the window failing instead of all of it.
 *
 * The bug this exists for takes the whole application down and leaves nothing to say so: a
 * component that throws while rendering has no `catch` above it, so Svelte unmounts the tree - and
 * without a boundary that tree is the window, status bar included.
 *
 * Rendered rather than reasoned about, because what is being asserted is that Svelte's boundary
 * catches what this file claims it does.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { cleanup, render, screen } from '@testing-library/svelte';
import { stubTauri, type TauriStub } from '../testing/tauri';
import Boundary from './Boundary.svelte';

/**
 * Children that fail the way a real pane does: while rendering, before anything can catch it.
 *
 * A raw snippet rather than a fixture component, so this needs no `.svelte` file of its own - the
 * component scheme has no folder for one that exists only to break.
 */
const throwing = createRawSnippet(() => ({
	render: () => {
		throw new Error('this pane met a shape it did not expect');
	}
}));

let tauri: TauriStub;

beforeEach(() => {
	// The boundary reports what it caught, which is an IPC call like any other.
	tauri = stubTauri({ log_diagnostic: 1 });
});

afterEach(() => {
	cleanup();
	tauri.restore();
});

/** The reports that reached the core, in order. */
const reported = () =>
	tauri.calls
		.filter((call) => call.cmd === 'log_diagnostic')
		.map((call) => call.args.report as { level: string; origin: string; message: string; detail: string | null });

describe('a pane that fails', () => {
	it('shows what stopped working, and offers to try again', async () => {
		render(Boundary, { label: 'Pipeline', children: throwing });

		expect(await screen.findByText(/Pipeline stopped working/)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
	});

	it('names the pane in what it records, because the error does not', async () => {
		render(Boundary, { label: 'Pipeline', children: throwing });
		await screen.findByText(/Pipeline stopped working/);

		// "Cannot read properties of undefined" says nothing about where it happened, and a release
		// build's stack is minified - so the one word that locates it has to be added here.
		const [only] = reported();
		expect(only.message).toBe('Pipeline: this pane met a shape it did not expect');
		expect(only.level).toBe('error');
		expect(only.detail, 'the stack the panel has room for').toContain('Error');
	});
});
