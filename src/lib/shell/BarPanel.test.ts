// @vitest-environment jsdom

/**
 * The shell the two status-bar panels share (S13): what it draws when there is nothing to list,
 * and how a row says its state.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { cleanup, render, screen } from '@testing-library/svelte';
import BarPanel from './BarPanel.svelte';
import BarRow from './BarRow.svelte';

const text = (html: string) => createRawSnippet(() => ({ render: () => html }));

afterEach(cleanup);

describe('BarPanel', () => {
	it('says what it is for when it has nothing to list', () => {
		render(BarPanel, { empty: 'Nothing has run yet.' });
		expect(screen.getByText('Nothing has run yet.')).toBeTruthy();
		expect(screen.queryByRole('list')).toBeNull();
	});

	it('lists its rows under the tools and over the footer', () => {
		render(BarPanel, {
			tools: text('<button>Copy report</button>'),
			footer: text('<p>Written to a file</p>'),
			children: text('<li>one</li>')
		});
		expect(screen.getByRole('button', { name: 'Copy report' })).toBeTruthy();
		expect(screen.getByRole('list').textContent).toContain('one');
		expect(screen.getByText('Written to a file')).toBeTruthy();
	});
});

describe('BarRow', () => {
	// State is carried by the dot's shape as much as its colour, so the row only needs to name it.
	it('leads with its state and marks a failure on the whole row', () => {
		const { container } = render(BarRow, { state: 'failed', children: text('<span>convert</span>') });
		expect(container.querySelector('.dot')!.getAttribute('data-state')).toBe('failed');
		expect(container.querySelector('li')!.classList.contains('failed')).toBe(true);
	});

	it('opens a preformatted block under itself only when there is one', () => {
		const { container, unmount } = render(BarRow, { state: 'running', children: text('<span>x</span>') });
		expect(container.querySelector('pre')).toBeNull();
		unmount();
		render(BarRow, { state: 'finished', more: 'line 1\nline 2', children: text('<span>x</span>') });
		expect(screen.getByText(/line 1/).tagName).toBe('PRE');
	});
});
