// @vitest-environment jsdom

/**
 * The map's dropdown, shared by the saved views and the background picker ([Q52]).
 *
 * Written once so "the same as the views one" is something neither can get wrong. What is asserted
 * here is the part both rely on and neither can see: the panel exists only while open, the three
 * ways out all work, and the wrapper carries the class the stacking hangs on.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import Dropdown from './Dropdown.svelte';
import { createRawSnippet } from 'svelte';

afterEach(cleanup);

/** A panel that says something findable, and offers the `close` it was handed. */
const panel = createRawSnippet((close: () => () => void) => ({
	render: () => `<div><button type="button" data-close>Pick</button></div>`,
	setup: (node: Element) => {
		node.querySelector('[data-close]')?.addEventListener('click', () => close()());
	}
}));

function open(over: Record<string, unknown> = {}) {
	const onClose = vi.fn();
	render(Dropdown, { label: 'Views', title: 'Saved views', panel, onClose, ...over } as never);
	return { onClose };
}

const toggle = () => screen.getByRole('button', { name: /Views/ });
const wrapper = () => toggle().closest('.dropdown') as HTMLElement;
const picked = () => document.querySelector('[data-close]');

describe('the map dropdown', () => {
	it('has no panel until it is asked for one', () => {
		open();
		expect(picked()).toBeNull();
		expect(toggle().getAttribute('aria-expanded')).toBe('false');
	});

	it('opens and closes on its own button', () => {
		open();
		toggle().click();
		flushSync();
		expect(picked()).toBeTruthy();
		expect(toggle().getAttribute('aria-expanded')).toBe('true');

		toggle().click();
		flushSync();
		expect(picked()).toBeNull();
	});

	/**
	 * The class the lift hangs on. A constant `z-index` put every dropdown on one layer, so the later
	 * control in the stack painted over the earlier one's open panel; only the open one rises, which
	 * needs no coordination because opening a second dismisses the first.
	 */
	it('is marked open, so it can be lifted over the controls beside it', () => {
		open();
		expect(wrapper().classList.contains('open')).toBe(false);
		toggle().click();
		flushSync();
		expect(wrapper().classList.contains('open')).toBe(true);
	});

	it('closes on Escape', () => {
		const { onClose } = open();
		toggle().click();
		flushSync();

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		flushSync();

		expect(picked()).toBeNull();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('closes on a pointer landing outside it', () => {
		const { onClose } = open();
		toggle().click();
		flushSync();

		document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		flushSync();

		expect(picked()).toBeNull();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	// A pointer inside is someone using the panel, not leaving it.
	it('stays open for a pointer inside it', () => {
		open();
		toggle().click();
		flushSync();

		picked()!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		flushSync();

		expect(picked()).toBeTruthy();
	});

	// Choosing something is done with it: the panel is handed the way to shut itself.
	it('hands the panel a way to close', () => {
		const { onClose } = open();
		toggle().click();
		flushSync();

		(picked() as HTMLElement).click();
		flushSync();

		expect(picked()).toBeNull();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	// Closing an already-closed one would drop a caller's half-edit for no reason.
	it('does not report a close it did not make', () => {
		const { onClose } = open();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		flushSync();
		expect(onClose).not.toHaveBeenCalled();
	});
});
