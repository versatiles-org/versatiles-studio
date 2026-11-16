// @vitest-environment jsdom

/**
 * The kit's tab strip (S13): which tab is chosen, and where the keyboard is.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import Tabs from './Tabs.svelte';

afterEach(cleanup);

const ITEMS = [
	{ id: 'local', label: 'This computer' },
	{ id: 'remote', label: 'SFTP server' }
];

describe('the tab strip', () => {
	// A dialog that opens on one tab and then switches to the one it was last on left the ring on
	// the first, which read as that one being chosen.
	it('moves the focus to a tab selected from elsewhere, while the focus is in the strip', async () => {
		const { rerender } = render(Tabs, { items: ITEMS, selected: 'local', onSelect: vi.fn(), label: 'Where' });
		screen.getByRole('tab', { name: 'This computer' }).focus();

		await rerender({ items: ITEMS, selected: 'remote', onSelect: vi.fn(), label: 'Where' });
		expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'SFTP server' }));
	});

	it('leaves the focus alone when it is somewhere else', async () => {
		const outside = document.body.appendChild(document.createElement('input'));
		const { rerender } = render(Tabs, { items: ITEMS, selected: 'local', onSelect: vi.fn(), label: 'Where' });
		outside.focus();

		await rerender({ items: ITEMS, selected: 'remote', onSelect: vi.fn(), label: 'Where' });
		expect(document.activeElement).toBe(outside);
		outside.remove();
	});

	it('keeps only the selected tab in the tab order, and the arrows move the selection', async () => {
		const onSelect = vi.fn();
		render(Tabs, { items: ITEMS, selected: 'local', onSelect, label: 'Where' });
		expect(screen.getByRole('tab', { name: 'This computer' }).tabIndex).toBe(0);
		expect(screen.getByRole('tab', { name: 'SFTP server' }).tabIndex).toBe(-1);
		await fireEvent.keyDown(screen.getByRole('tab', { name: 'This computer' }), { key: 'ArrowRight' });
		expect(onSelect).toHaveBeenCalledWith('remote');
	});
});
