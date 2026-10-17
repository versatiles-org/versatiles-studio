// @vitest-environment jsdom

/**
 * The box every pane sits in: its header, and what folding it does to what is inside.
 *
 * Rendered, because both claims are about the DOM - what the heading button says, and whether the
 * contents survive a fold - and neither can be asked of a pure function.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import { cleanup, render, screen } from '@testing-library/svelte';
import Pane from './Pane.svelte';

const body = createRawSnippet(() => ({ render: () => '<p>the contents</p>' }));

afterEach(cleanup);

describe('the header', () => {
	it('is a button that says the title and whether the pane is open', () => {
		render(Pane, { title: 'Style', open: false, onToggle: vi.fn(), children: body });
		const heading = screen.getByRole('button', { name: /Style/ });
		expect(heading.getAttribute('aria-expanded')).toBe('false');
	});

	// The chain alternates scope from pane to pane - project, selection, selection, project - and the
	// header is the one place that is on screen whether or not the pane is open (S8.4).
	it('says what the pane is about, folded or not', () => {
		render(Pane, { title: 'Style', detail: 'osm', open: false, onToggle: vi.fn(), children: body });
		const heading = screen.getByRole('button', { name: /Style/ });
		expect(heading.textContent).toContain('osm');
		// The title keeps its own span, so a helper matching on the title text still finds it.
		expect(heading.querySelector('.title')?.textContent).toBe('Style');
	});

	it('says nothing extra when there is nothing to say', () => {
		render(Pane, { title: 'Sources', detail: null, open: true, onToggle: vi.fn(), children: body });
		expect(screen.getByRole('button', { name: /Sources/ }).querySelector('.detail')).toBeNull();
	});

	it('asks to be toggled rather than toggling itself', async () => {
		const onToggle = vi.fn();
		render(Pane, { title: 'Layers', open: true, onToggle, children: body });
		screen.getByRole('button', { name: /Layers/ }).click();
		expect(onToggle).toHaveBeenCalledWith(false);
	});
});

describe('folding', () => {
	const field = createRawSnippet(() => ({ render: () => '<input aria-label="a draft" />' }));

	// The fold used to unmount the contents, so a typed VPL draft, the chosen tab and the Layers
	// filter were all gone when the pane opened again (S8.7).
	it('keeps the contents, and what they hold, while folded', async () => {
		const { rerender } = render(Pane, { title: 'Pipeline', open: true, onToggle: vi.fn(), children: field });
		const input = screen.getByLabelText('a draft') as HTMLInputElement;
		input.value = 'from_debug';

		await rerender({ title: 'Pipeline', open: false, onToggle: vi.fn(), children: field });
		expect((screen.getByLabelText('a draft') as HTMLInputElement).value).toBe('from_debug');
		expect(screen.getByLabelText('a draft').closest('[hidden]')).not.toBeNull();

		await rerender({ title: 'Pipeline', open: true, onToggle: vi.fn(), children: field });
		expect((screen.getByLabelText('a draft') as HTMLInputElement).value).toBe('from_debug');
		expect(screen.getByLabelText('a draft').closest('[hidden]')).toBeNull();
	});
});
