import { beforeEach, describe, expect, it } from 'vitest';
import { document } from './document.svelte';
import type { DocumentView } from '../ipc/commands';

/**
 * The one rule this module exists for: **when the editor must reload, and when it must not**.
 *
 * It was two variables written as a pair in seven places and deliberately not as a pair in four
 * more. Getting it backwards is invisible in a type check and obvious in use - either the textarea
 * keeps showing text that has been replaced, or the caret jumps on every keystroke.
 */

const doc = (over: Partial<DocumentView> = {}): DocumentView =>
	({ graph: 1, name: 'berlin', text: 'from_debug format=png', ...over }) as DocumentView;

beforeEach(() => {
	document.show(null);
});

describe('what the editor reloads on', () => {
	it('reloads when the document changed from outside the editor', () => {
		const before = document.revision;
		document.show(doc());
		expect(document.revision).toBeGreaterThan(before);
		expect(document.current?.name).toBe('berlin');
	});

	// Bumping here would reload the textarea on every keystroke, taking the caret with it.
	it('does not reload when the change came from the editor', () => {
		document.show(doc());
		const before = document.revision;
		document.update(doc({ text: 'from_debug format=avif' }));
		expect(document.revision).toBe(before);
		expect(document.current?.text).toBe('from_debug format=avif');
	});

	// A reload is a *step*, not a value - showing the same document twice must still reload, because
	// undo can hand back text that happens to match what is already there.
	it('reloads again even for an identical document', () => {
		document.show(doc());
		const before = document.revision;
		document.show(doc());
		expect(document.revision).toBeGreaterThan(before);
	});
});

describe('which graph is open', () => {
	it('is the document’s graph, and null when nothing is open', () => {
		expect(document.graph).toBeNull();
		document.show(doc({ graph: 7 }));
		expect(document.graph).toBe(7);
		document.show(null);
		expect(document.graph).toBeNull();
	});
});
