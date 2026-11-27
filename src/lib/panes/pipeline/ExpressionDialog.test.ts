// @vitest-environment jsdom

/** The expression helper: what it offers, what it writes, and how quietly it checks. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { fireEvent } from '@testing-library/dom';
import ExpressionDialog from './ExpressionDialog.svelte';
import type { Vocabulary } from '../../state/vocabulary.svelte';
import type { ExpressionCheck, ExpressionOperator } from '../../ipc/commands';

// jsdom has no `ResizeObserver`, and the property list measures its height with one.
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
} as unknown as typeof ResizeObserver;

// jsdom has no `showModal`, and the dialog's own effect calls it.
HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

const NAMES = [
	{ name: '$zoom', doc: 'The zoom level of the tile.' },
	{ name: '$layer', doc: "The name of the feature's layer." }
];

/** One of each way an operator is written, as upstream lists them. */
const OPERATORS: ExpressionOperator[] = [
	{ written: '>=', kind: 'comparison', doc: 'Whether a value is at least another.', example: '1 >= 1' },
	{ written: 'size', kind: 'function', doc: 'The length of a string, list or map.', example: "size('abc') == 3" },
	{
		written: 'startsWith',
		kind: 'method',
		doc: 'Whether a string starts with another.',
		example: "'abc'.startsWith('a')"
	},
	{
		written: 'all',
		kind: 'macro',
		doc: 'Whether a condition holds for every element.',
		example: '[1, 2].all(x, x > 0)'
	}
];

const READ: Vocabulary = {
	read: 'full',
	scanning: false,
	layers: [
		{
			layer: 'streets',
			keys: [{ key: 'kind', features: 10, more: false, values: [{ literal: "'primary'", count: 6 }] }]
		},
		{ layer: 'pois', keys: [{ key: 'name:de', features: 3, more: true, values: [] }] }
	]
};

type Check = ExpressionCheck;
const FINE: Check = { problems: [], tokens: [], reads: { names: ['$zoom'], properties: [], scope: 'tile' } };

function open(over: { value?: string; vocabulary?: Vocabulary; check?: (text: string) => Promise<Check> } = {}) {
	const spies = {
		check: vi.fn(over.check ?? (async () => FINE)),
		onScan: vi.fn(),
		onUse: vi.fn(),
		onClose: vi.fn()
	};
	render(ExpressionDialog, {
		value: over.value ?? '',
		name: 'expr',
		names: NAMES,
		operators: OPERATORS,
		vocabulary: over.vocabulary ?? READ,
		...spies
	});
	return spies;
}

const box = () => screen.getByLabelText('Expression for expr') as HTMLTextAreaElement;
// By text: jsdom has no `showModal`, so the dialog never opens and its buttons count as hidden to
// role queries - as in `RampDialog`'s tests.
const chip = (text: string) => screen.getByText(text, { selector: 'button' });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

/** `$zoom ==`, as upstream answers it: the value after `==` is missing. */
const TRAILING: Check = {
	problems: [{ message: 'The expression ends after `==`.', start: 8, end: 8 }],
	tokens: [
		{ kind: 'special', start: 0, end: 5 },
		{ kind: 'operator', start: 6, end: 8 }
	],
	reads: null
};

/** The layer under the box: what it draws, as runs. */
const painted = () => document.querySelector('.editor pre') as HTMLPreElement;

describe('the check', () => {
	// One box for every verdict, so the dialog keeps its size while they change.
	it('keeps one box for the verdict, whatever it is', async () => {
		open({ value: '' });
		await vi.advanceTimersByTimeAsync(0);
		const status = screen.getByRole('status', { hidden: true });
		expect(status.textContent).toContain('Empty');
		await fireEvent.input(box(), { target: { value: '$zoom' } });
		await fireEvent.click(chip('Check'));
		await vi.advanceTimersByTimeAsync(0);
		expect(screen.getByRole('status', { hidden: true })).toBe(status);
		expect(status.textContent).toContain('Reads as an expression.');
	});

	it('says an expression reads, and what it reads, on opening', async () => {
		const { check } = open({ value: '$zoom >= 12' });
		await vi.advanceTimersByTimeAsync(0);
		expect(check).toHaveBeenCalledWith('$zoom >= 12');
		expect(screen.getByText('Reads as an expression.')).toBeTruthy();
		expect(screen.getByText('Reads $zoom: one answer per tile, without decoding it.')).toBeTruthy();
	});

	// A pause is mostly a thought half-finished, so typing is never judged on its own.
	it('judges when asked, and not while typing', async () => {
		open({ value: '$zoom', check: async (text) => (text.endsWith('==') ? TRAILING : FINE) });
		await vi.advanceTimersByTimeAsync(0);
		await fireEvent.input(box(), { target: { value: '$zoom ==' } });
		await vi.advanceTimersByTimeAsync(5000);
		// The last verdict stands, said to be about what was there before, and underlines nothing.
		expect(screen.getByText('Reads as an expression.')).toBeTruthy();
		expect(screen.getByText('Changed since the check')).toBeTruthy();
		expect(painted().querySelector('.bad')).toBeNull();

		await fireEvent.click(chip('Check'));
		await vi.advanceTimersByTimeAsync(0);
		const message = screen.getByText('The expression ends after `==`.');
		expect(message.closest('[role="status"]')).toBe(screen.getByRole('status', { hidden: true }));
		// Marked where the value is missing: after the `==`, at the end.
		expect(painted().querySelector('.missing')).toBeTruthy();
		expect(box().getAttribute('aria-invalid')).toBe('true');
	});

	// Upstream's tokens, asked for after a pause in the typing, colour what is in the box now.
	it('colours the text as it is typed', async () => {
		const { check } = open({ value: '', check: async () => TRAILING });
		await vi.advanceTimersByTimeAsync(0);
		await fireEvent.input(box(), { target: { value: '$zoom ==' } });
		await vi.advanceTimersByTimeAsync(200);
		expect(check).toHaveBeenLastCalledWith('$zoom ==');
		expect(painted().querySelector('.special')?.textContent).toBe('$zoom');
		expect(painted().querySelector('.operator')?.textContent).toBe('==');
		expect(painted().textContent).toBe('$zoom ==\n');
		// Still not judged: nothing underlined, and no message.
		expect(painted().querySelector('.bad')).toBeNull();
		expect(screen.queryByText('The expression ends after `==`.')).toBeNull();
	});

	it('checks on ⌘ or Ctrl + Enter too', async () => {
		const { check } = open({ value: '$zoom' });
		await vi.advanceTimersByTimeAsync(0);
		await fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
		await vi.advanceTimersByTimeAsync(0);
		expect(check).toHaveBeenCalledTimes(2);
	});
});

describe('what it offers', () => {
	it('writes a name where the caret is', async () => {
		open();
		await fireEvent.click(chip('$zoom'));
		expect(box().value).toBe('$zoom');
	});

	it('writes a property by name, or through $props where it has to', async () => {
		open();
		await fireEvent.click(chip('kind'));
		expect(box().value).toBe('kind');
		await fireEvent.click(chip('name:de'));
		expect(box().value).toBe("kind $props['name:de']");
	});

	// Picking a property and then a value means comparing them.
	it('compares a picked value with the property before it', async () => {
		open();
		await fireEvent.click(chip('kind'));
		await fireEvent.click(chip("'primary'"));
		expect(box().value).toBe("kind == 'primary'");
	});

	it('offers the layers as $layer’s values', async () => {
		open();
		await fireEvent.click(chip('$layer'));
		await fireEvent.click(chip("'pois'"));
		expect(box().value).toBe("$layer == 'pois'");
	});

	// An operator goes in with room after it, so a name, then `>=`, then a value reads as one.
	it('writes an operator between what is before it and what comes next', async () => {
		open();
		await fireEvent.click(chip('$zoom'));
		await fireEvent.click(chip('>='));
		expect(box().value).toBe('$zoom >= ');
		await vi.advanceTimersByTimeAsync(0);
		expect(box().selectionStart).toBe(9);
	});

	it('writes a function with the caret between its brackets', async () => {
		open();
		await fireEvent.click(chip('size()'));
		expect(box().value).toBe('size()');
		await vi.advanceTimersByTimeAsync(0);
		expect(box().selectionStart).toBe(5);
	});

	// A method is called on what is before it, so it is joined to it rather than spaced.
	it('writes a method onto the value before it', async () => {
		open();
		await fireEvent.click(chip('kind'));
		await fireEvent.click(chip('.startsWith()'));
		expect(box().value).toBe('kind.startsWith()');
		await vi.advanceTimersByTimeAsync(0);
		expect(box().selectionStart).toBe(16);
	});

	it('writes a list macro with its variable, ready for the condition', async () => {
		open();
		await fireEvent.click(chip('.all()'));
		expect(box().value).toBe('.all(x, )');
		await vi.advanceTimersByTimeAsync(0);
		expect(box().selectionStart).toBe(8);
	});

	it('groups operators apart from functions', () => {
		open();
		const group = (text: string) => chip(text).closest('section.group');
		expect(group('>=')?.querySelector('h3')?.textContent).toContain('Operators');
		expect(group('size()')?.querySelector('h3')?.textContent).toContain('Functions');
		expect(group('.startsWith()')).toBe(group('size()'));
		expect(group('.all()')).toBe(group('size()'));
	});

	describe('the property filter', () => {
		const filter = () => screen.getByLabelText('Filter properties') as HTMLInputElement;
		const shown = (text: string) => screen.queryByText(text, { selector: 'button' }) !== null;

		it('narrows the properties to those containing what is typed, whatever its case', async () => {
			open();
			await fireEvent.input(filter(), { target: { value: ' NAME ' } });
			expect(shown('name:de')).toBe(true);
			expect(shown('kind')).toBe(false);
		});

		it('says when nothing matches', async () => {
			open();
			await fireEvent.input(filter(), { target: { value: 'zzz' } });
			expect(screen.getByText('No property matches “zzz”.')).toBeTruthy();
		});

		// The filter is about finding a property, not about what was picked.
		it('keeps the values of a picked property it hides', async () => {
			open();
			await fireEvent.click(chip('kind'));
			await fireEvent.input(filter(), { target: { value: 'zzz' } });
			expect(shown('kind')).toBe(false);
			expect(chip("'primary'")).toBeTruthy();
		});

		// The dialog closes on Escape; with a filter typed, Escape empties it first.
		it('empties on Escape, and leaves the dialog alone while doing so', async () => {
			const { onClose } = open();
			await fireEvent.input(filter(), { target: { value: 'name' } });
			const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
			filter().dispatchEvent(event);
			await vi.advanceTimersByTimeAsync(0);
			expect(event.defaultPrevented).toBe(true);
			expect(filter().value).toBe('');
			expect(shown('kind')).toBe(true);
			expect(onClose).not.toHaveBeenCalled();
		});
	});

	it('offers to read the layers when no values have been read', async () => {
		const { onScan } = open({
			vocabulary: {
				read: 'none',
				scanning: false,
				layers: [{ layer: 'streets', keys: [{ key: 'kind', features: 0, more: false, values: [] }] }]
			}
		});
		await fireEvent.click(chip('kind'));
		await fireEvent.click(chip('Read layers'));
		expect(onScan).toHaveBeenCalledOnce();
	});
});

describe('the line that says what a chip does', () => {
	const line = () => document.querySelector('.doc') as HTMLElement;
	const palette = () => document.querySelector('.palette') as HTMLElement;

	it('hints at itself until something is pointed at', () => {
		open();
		expect(line().textContent).toContain('Point at a name, an operator or a function');
	});

	it('says what an operator does, and how it is used, for the pointer', async () => {
		open();
		await fireEvent.pointerOver(chip('size()'));
		expect(line().textContent).toContain('size()');
		expect(line().textContent).toContain('The length of a string, list or map.');
		expect(line().textContent).toContain("For example: size('abc') == 3");
	});

	// A tooltip never answered the keyboard; the line follows the focus as it follows the pointer.
	it('follows the focus too', async () => {
		open();
		await fireEvent.focusIn(chip('.startsWith()'));
		expect(line().textContent).toContain('Whether a string starts with another.');
	});

	it('says what a name holds, without an example it does not have', async () => {
		open();
		await fireEvent.pointerOver(chip('$layer'));
		expect(line().textContent).toContain("The name of the feature's layer.");
		expect(line().textContent).not.toContain('For example');
	});

	it('keeps its answer between chips, and gives it up for a property or on leaving', async () => {
		open();
		await fireEvent.pointerOver(chip('>='));
		await fireEvent.pointerOver(palette());
		expect(line().textContent).toContain('Whether a value is at least another.');
		await fireEvent.pointerOver(chip('kind'));
		expect(line().textContent).toContain('Point at');
		await fireEvent.pointerOver(chip('>='));
		await fireEvent.pointerLeave(palette());
		expect(line().textContent).toContain('Point at');
	});

	it('leaves the chips without tooltips of their own', () => {
		open();
		expect(chip('>=').title).toBe('');
		expect(chip('$zoom').title).toBe('');
	});
});

describe('the round trip', () => {
	it('writes back the draft, trimmed, on Use only', async () => {
		const { onUse } = open({ value: '$zoom' });
		await fireEvent.input(box(), { target: { value: ' $zoom >= 12 ' } });
		expect(onUse).not.toHaveBeenCalled();
		await fireEvent.click(chip('Use'));
		expect(onUse).toHaveBeenCalledWith('$zoom >= 12');
	});
});
