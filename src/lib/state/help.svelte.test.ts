// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { dismiss, help, peek, pin, unpeek, type HelpContent } from './help.svelte';

/**
 * Peek and pin are different needs, so they are different gestures — and the rules between them are
 * what keep the popover from fighting the pointer.
 *
 * Hovering peeks: read it and move on, nothing to dismiss. Clicking pins: it stays, and it stays put
 * while the pointer wanders over everything else on the way to it.
 */

const content = (title: string): HelpContent => ({ title, summary: 'text · optional', body: 'A parameter.' });

/** A trigger inside a sidebar, which is what `place` measures against. */
function trigger(): HTMLElement {
	document.body.innerHTML = '<div class="sidebar"><button id="t">?</button></div>';
	return document.getElementById('t')!;
}

beforeEach(() => {
	dismiss();
});

describe('peeking', () => {
	it('shows the content, unpinned, anchored to its trigger', () => {
		peek(content('bbox'), trigger());
		expect(help.current?.content.title).toBe('bbox');
		expect(help.current?.pinned).toBe(false);
		expect(help.current?.anchor).toBeDefined();
		expect(help.current?.container).toBeDefined();
	});

	it('moves straight to another trigger', () => {
		peek(content('bbox'), trigger());
		peek(content('level_min'), trigger());
		expect(help.current?.content.title).toBe('level_min');
	});

	it('goes away on its own', () => {
		peek(content('bbox'), trigger());
		unpeek();
		expect(help.current).toBeNull();
	});
});

describe('pinning', () => {
	it('stays until something dismisses it', () => {
		pin(content('bbox'), trigger());
		expect(help.current?.pinned).toBe(true);
		unpeek();
		expect(help.current?.pinned).toBe(true);
	});

	// **The rule that makes a pinned popover usable.** Reaching for the text means the pointer
	// crosses every other trigger on the way; without this it would rewrite itself under the cursor.
	it('ignores a peek at something else while it is up', () => {
		pin(content('bbox'), trigger());
		peek(content('level_min'), trigger());
		expect(help.current?.content.title).toBe('bbox');
	});

	// The same gesture off as on — clicking the trigger again is how you put it away.
	it('toggles off when the same trigger is clicked again', () => {
		pin(content('bbox'), trigger());
		pin(content('bbox'), trigger());
		expect(help.current).toBeNull();
	});

	it('moves to a different trigger rather than closing', () => {
		pin(content('bbox'), trigger());
		pin(content('level_min'), trigger());
		expect(help.current?.content.title).toBe('level_min');
		expect(help.current?.pinned).toBe(true);
	});

	it('takes over from a peek', () => {
		peek(content('bbox'), trigger());
		pin(content('bbox'), trigger());
		expect(help.current?.pinned).toBe(true);
	});

	it('closes on dismiss whatever it was showing', () => {
		pin(content('bbox'), trigger());
		dismiss();
		expect(help.current).toBeNull();
	});
});

describe('where it is measured against', () => {
	// The sidebar scrolls and clips, so the popover is positioned against it rather than the trigger
	// alone — and a trigger outside one still has to measure against something.
	it('falls back to the trigger when there is no sidebar', () => {
		document.body.innerHTML = '<button id="loose">?</button>';
		peek(content('bbox'), document.getElementById('loose')!);
		expect(help.current?.container).toBeDefined();
	});
});
