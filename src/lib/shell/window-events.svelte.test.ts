// @vitest-environment jsdom

/**
 * Everything that reaches a window from outside it.
 *
 * **The teardown is what this is really for.** Each of these was an `$effect` in `App.svelte` with
 * its own unsubscriber, and the failure they share is silent: a reload that left the previous
 * handlers attached opens every dropped file twice and reports every problem twice, which reads as
 * the application doing the work twice rather than as a listener that outlived its window. Nothing
 * else in the suite would notice, so each one is unmounted here and asked whether it let go.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { Actions } from './window-events.svelte';

const stops = vi.hoisted(() => ({ menu: 0, opened: 0, drop: 0 }));
const fire = vi.hoisted(
	() => ({}) as { menu?: (event: { payload: string }) => void; opened?: () => void; drop?: (event: unknown) => void }
);

vi.mock('@tauri-apps/api/event', () => ({
	listen: (name: string, handler: (event: { payload: string }) => void) => {
		if (name.endsWith('menu')) fire.menu = handler;
		else fire.opened = handler as () => void;
		return Promise.resolve(() => (name.endsWith('menu') ? (stops.menu += 1) : (stops.opened += 1)));
	}
}));
vi.mock('@tauri-apps/api/webview', () => ({
	getCurrentWebview: () => ({
		onDragDropEvent: (handler: (event: unknown) => void) => {
			fire.drop = handler;
			return Promise.resolve(() => (stops.drop += 1));
		}
	})
}));

const title = vi.hoisted(() => ({ set: [] as string[] }));
vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({ setTitle: (name: string) => void title.set.push(name) })
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

const refreshed = vi.hoisted(() => ({ count: 0 }));
vi.mock('../ipc/commands', () => ({
	MENU_EVENT: 'studio://menu',
	OPENED_EVENT: 'studio://opened',
	refreshMenu: () => void (refreshed.count += 1),
	takeOpened: () => Promise.resolve(['/tmp/queued.versatiles'])
}));
vi.mock('../state/graphs.svelte', () => ({ graphs: { empty: true } }));
vi.mock('../state/status.svelte', () => ({ status: { fail: vi.fn() } }));

const { windowEvents } = await import('./window-events.svelte');

/**
 * Attaches the listeners in an effect root, and hands back the teardown.
 *
 * `$effect.root` rather than a host component: this needs an effect context and nothing else, and a
 * `.svelte` fixture would have to live in one of the documented component folders and would show up
 * in the inventory as a component nobody can use.
 */
let release: (() => void) | null = null;

function attach(spec: Actions): () => void {
	release = $effect.root(() => windowEvents.listen(spec));
	flushSync();
	return release;
}

/** Every action, recording what was asked for. */
function actions() {
	const calls: string[] = [];
	const note = (what: string) => () => void calls.push(what);
	return {
		calls,
		spec: {
			open: note('open'),
			openProject: note('openProject'),
			saveProject: note('saveProject'),
			saveProjectAs: note('saveProjectAs'),
			saveCopy: note('saveCopy'),
			showAssets: note('showAssets'),
			showUpdates: note('showUpdates'),
			showProblems: note('showProblems'),
			reportProblem: note('reportProblem'),
			openPath: (path: string) => {
				calls.push(`open:${path}`);
				return Promise.resolve();
			},
			accepts: (path: string) => path.endsWith('.versatiles'),
			stepHistory: (back: boolean) => void calls.push(back ? 'undo' : 'redo'),
			title: () => 'berlin.versatiles'
		}
	};
}

afterEach(() => {
	// A case that left its root standing would stack its listeners under the next one's.
	release?.();
	release = null;
	stops.menu = stops.opened = stops.drop = 0;
	title.set.length = 0;
	refreshed.count = 0;
	vi.clearAllMocks();
});

describe('what a window listens for', () => {
	it('turns each menu choice into the one action that answers it', async () => {
		const { calls, spec } = actions();
		attach(spec);
		await vi.waitFor(() => expect(fire.menu).toBeTypeOf('function'));

		for (const payload of ['open', 'open-project', 'save-project', 'fonts', 'problems']) {
			fire.menu!({ payload });
		}

		expect(calls).toEqual(['open', 'openProject', 'saveProject', 'showAssets', 'showProblems']);
	});

	/// A payload this build does not know is not an error - the menu is declared in Rust and can name
	/// an item the webview has not caught up with. Doing nothing is the honest answer.
	it('ignores a choice it has no arm for', async () => {
		const { calls, spec } = actions();
		attach(spec);
		await vi.waitFor(() => expect(fire.menu).toBeTypeOf('function'));

		fire.menu!({ payload: 'something-newer' });
		expect(calls).toEqual([]);
	});

	// The launch case: a file double-clicked before this window existed is already on the queue, so
	// draining on start is what catches it. The event alone would miss it entirely.
	it('drains what the OS queued before the window existed', async () => {
		const { calls, spec } = actions();
		attach(spec);

		await vi.waitFor(() => expect(calls).toContain('open:/tmp/queued.versatiles'));
	});

	it('opens a dropped file it can read, and ignores one it cannot', async () => {
		const { calls, spec } = actions();
		attach(spec);
		await vi.waitFor(() => expect(fire.drop).toBeTypeOf('function'));

		fire.drop!({ payload: { type: 'drop', paths: ['/a/berlin.versatiles', '/a/notes.txt'] } });
		expect(calls).toContain('open:/a/berlin.versatiles');
		expect(calls).not.toContain('open:/a/notes.txt');
	});

	it('ignores a drag that is only passing over', async () => {
		const { calls, spec } = actions();
		attach(spec);
		await vi.waitFor(() => expect(fire.drop).toBeTypeOf('function'));

		fire.drop!({ payload: { type: 'over', paths: ['/a/berlin.versatiles'] } });
		expect(calls).toEqual([]);
	});

	it('names the window after what it holds', async () => {
		attach(actions().spec);
		await vi.waitFor(() => expect(title.set).toContain('berlin.versatiles - VersaTiles Studio'));
	});
});

describe('the undo shortcut', () => {
	const key = (init: KeyboardEventInit & { target?: Element }) => {
		const { target, ...rest } = init;
		(target ?? window.document.body).dispatchEvent(
			new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true, ...rest })
		);
	};

	it('steps back, and forward with shift', async () => {
		const { calls, spec } = actions();
		attach(spec);

		key({});
		key({ shiftKey: true });
		expect(calls).toEqual(['undo', 'redo']);
	});

	/**
	 * A focused `<input>` keeps its own undo: the user is mid-edit in a parameter field and has not
	 * committed anything, so the document has nothing to step back to.
	 */
	it('leaves a field being typed in to its own undo', async () => {
		const { calls, spec } = actions();
		attach(spec);

		const field = window.document.createElement('input');
		window.document.body.append(field);
		key({ target: field });

		expect(calls).toEqual([]);
		field.remove();
	});

	// The VPL textarea is deliberately not excluded: its text *is* the document, and a local browser
	// undo would leave the two disagreeing until the next keystroke.
	it('still steps the document from the VPL editor', async () => {
		const { calls, spec } = actions();
		attach(spec);

		const box = window.document.createElement('textarea');
		window.document.body.append(box);
		key({ target: box });

		expect(calls).toEqual(['undo']);
		box.remove();
	});

	it('leaves a key without the modifier alone', async () => {
		const { calls, spec } = actions();
		attach(spec);

		window.document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
		expect(calls).toEqual([]);
	});
});

describe('letting go', () => {
	/**
	 * The one that is silent when it breaks. A window that keeps its listeners across a reload opens
	 * every dropped file twice, and the second window to be told is the one nobody expects.
	 */
	it('unsubscribes every listener when the window goes', async () => {
		const stop = attach(actions().spec);
		await vi.waitFor(() => expect(fire.drop).toBeTypeOf('function'));

		stop();

		await vi.waitFor(() => expect([stops.menu, stops.opened, stops.drop]).toEqual([1, 1, 1]));
	});

	it('takes the keyboard handler off the window too', async () => {
		const { calls, spec } = actions();
		const stop = attach(spec);
		stop();

		window.document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
		expect(calls).toEqual([]);
	});
});
