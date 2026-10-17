// @vitest-environment jsdom

/**
 * The three parts of the kit that are components (S12, [Q70]): what each renders, and the one rule
 * each exists to hold.
 *
 * `kit.test.ts` beside `styles/` is the other half - that no pane spells one of these by hand.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { cleanup, render, screen } from '@testing-library/svelte';
import Field from './Field.svelte';
import Group from './Group.svelte';
import Note from './Note.svelte';

const text = (html: string) => createRawSnippet(() => ({ render: () => html }));

afterEach(cleanup);

describe('Group', () => {
	// The pane title is an uppercase label and the only one; a group's heading is sentence case, so
	// the two levels can be told apart at a glance.
	it('heads its controls with a sentence-case heading, never an uppercase label', () => {
		render(Group, { title: 'Adjust', children: text('<p>controls</p>') });
		const heading = screen.getByRole('heading', { level: 3 });
		expect(heading.textContent).toContain('Adjust');
		expect(heading.className).not.toContain('section-label');
	});

	it('puts the action on the heading line', () => {
		render(Group, {
			title: 'Adjust',
			action: text('<button class="quiet">reset</button>'),
			children: text('<p>controls</p>')
		});
		expect(screen.getByRole('button', { name: 'reset' }).closest('h3')).not.toBeNull();
	});
});

describe('Group that folds', () => {
	it('is a disclosure that says what it holds while closed, and asks to be toggled', async () => {
		let open = false;
		const { rerender } = render(Group, {
			title: 'Crop',
			open,
			summary: 'z4-12',
			onToggle: (next: boolean) => (open = next),
			children: text('<input aria-label="West" />')
		});
		const heading = screen.getByRole('button', { name: /Crop/ });
		expect(heading.getAttribute('aria-expanded')).toBe('false');
		expect(heading.textContent).toContain('z4-12');
		expect(screen.queryByLabelText('West')).toBeNull();

		heading.click();
		expect(open).toBe(true);
		await rerender({
			title: 'Crop',
			open,
			summary: 'z4-12',
			onToggle: () => {},
			children: text('<input aria-label="West" />')
		});
		expect(screen.getByLabelText('West')).toBeTruthy();
		expect(screen.getByRole('button', { name: /Crop/ }).textContent).not.toContain('z4-12');
	});
});

describe('Field', () => {
	it('labels the control it wraps', () => {
		render(Field, { label: 'Opacity', children: text('<input type="range" />') });
		expect(screen.getByLabelText('Opacity')).toBeTruthy();
	});

	// One label may not wrap two controls, so a row of several is a group the label names.
	it('names a group when a row holds more than one control', () => {
		render(Field, {
			label: 'Zoom',
			as: 'group',
			children: text('<input aria-label="from" /><input aria-label="to" />')
		});
		expect(screen.getByRole('group', { name: 'Zoom' })).toBeTruthy();
		expect(screen.getByLabelText('from')).toBeTruthy();
	});

	it('lays out a trailing part only when there is one', () => {
		const { container, unmount } = render(Field, { label: 'Hue', children: text('<input type="range" />') });
		expect(container.querySelector('.field')!.classList.contains('trailed')).toBe(false);
		unmount();
		render(Field, { label: 'Hue', trail: text('<span>12°</span>'), children: text('<input type="range" />') });
		expect(screen.getByText('12°').closest('.field')!.classList.contains('trailed')).toBe(true);
	});
});

describe('Note', () => {
	it('is a hint unless told otherwise', () => {
		render(Note, { children: text('Smooth blends between pixels.') });
		expect(screen.getByText('Smooth blends between pixels.').className).toContain('hint');
	});

	// An error is the one tone that interrupts, and the only one a screen reader is told about.
	it('announces a problem and nothing else', () => {
		render(Note, { tone: 'problem', children: text('no such file') });
		expect(screen.getByRole('alert').textContent).toContain('no such file');
		cleanup();
		render(Note, { tone: 'aside', children: text('drawn as the inspector style') });
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('offers the fix after the text', () => {
		render(Note, { tone: 'aside', action: text('<button class="quiet">Read as other</button>'), children: text('x') });
		expect(screen.getByRole('button', { name: 'Read as other' }).closest('.note')).not.toBeNull();
	});
});
