// @vitest-environment jsdom

/**
 * The popup menu ([Q58]).
 *
 * **Over the layout, not inside it.** Revealing choices in flow pushed everything below them down, so
 * they moved while you read them and sat in whatever list they had appeared under. What is asserted
 * here is what makes a popup a popup: nothing in the document until asked for, every way out, and the
 * keyboard reaching it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import Menu from './Menu.svelte';

const ITEMS = [
	{ id: 'first', label: 'First thing', description: 'what it does' },
	{ id: 'second', label: 'Second thing' },
	{ id: 'off', label: 'Not this one', disabled: true }
];

afterEach(cleanup);

function open(over: Record<string, unknown> = {}) {
	const onPick = vi.fn();
	const onClose = vi.fn();
	render(Menu, { label: 'Add…', items: ITEMS, onPick, onClose, ...over } as never);
	return { onPick, onClose };
}

const trigger = () => screen.getByRole('button', { name: 'Add…' });
const show = () => {
	trigger().click();
	flushSync();
};

describe('a popup menu', () => {
	it('is not in the document until it is asked for', () => {
		open();
		expect(screen.queryByRole('menu')).toBeNull();
		expect(trigger().getAttribute('aria-expanded')).toBe('false');
	});

	it('opens onto its items, with the second line where there is one', () => {
		open();
		show();
		expect(screen.getAllByRole('menuitem')).toHaveLength(3);
		expect(screen.getByText('what it does')).toBeTruthy();
	});

	it('chooses and closes', () => {
		const { onPick } = open();
		show();
		screen.getByText('First thing').click();
		flushSync();

		expect(onPick).toHaveBeenCalledWith('first');
		expect(screen.queryByRole('menu')).toBeNull();
	});

	// A choice that leads to another list is one question in two parts, not two questions.
	it('stays open when the caller says to keep it', () => {
		const onPick = vi.fn(() => 'keep' as const);
		const { onClose } = open({ onPick });
		show();
		screen.getByText('First thing').click();
		flushSync();

		expect(onPick).toHaveBeenCalledWith('first');
		expect(screen.getByRole('menu')).toBeTruthy();
		expect(onClose).not.toHaveBeenCalled();
	});

	it('refuses a disabled item', () => {
		const { onPick } = open();
		show();
		expect((screen.getByText('Not this one').closest('button') as HTMLButtonElement).disabled).toBe(true);
		expect(onPick).not.toHaveBeenCalled();
	});

	it('closes on Escape and gives the focus back', () => {
		const { onClose } = open();
		show();
		screen.getByRole('menu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();

		expect(screen.queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(trigger());
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('closes on a pointer landing outside it', () => {
		open();
		show();
		document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		flushSync();
		expect(screen.queryByRole('menu')).toBeNull();
	});

	/**
	 * The measurement is a rectangle taken once, so a scroll makes it a lie. Closing is the honest
	 * answer and the one `Help` and `Picker` already give.
	 */
	it('closes rather than chasing a scroll', () => {
		open();
		show();
		window.dispatchEvent(new Event('scroll'));
		flushSync();
		expect(screen.queryByRole('menu')).toBeNull();
	});

	// The arrows walk what Enter can choose, so a disabled row is never landed on.
	it('walks past a disabled row and wraps', () => {
		const { onPick } = open();
		show();
		const menu = screen.getByRole('menu');
		const key = (key: string) => {
			menu.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
			flushSync();
		};

		key('ArrowDown');
		key('ArrowDown');
		key('Enter');

		expect(onPick).toHaveBeenCalledWith('first');
	});

	it('chooses the row the arrows are on', () => {
		const { onPick } = open();
		show();
		const menu = screen.getByRole('menu');
		menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		flushSync();
		menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		flushSync();

		expect(onPick).toHaveBeenCalledWith('second');
	});
});
