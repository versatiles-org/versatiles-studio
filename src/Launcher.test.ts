// @vitest-environment jsdom

/**
 * The launcher's ways in.
 *
 * **The one this exists for is the drop.** The landing screen says "…or drop a file anywhere in this
 * window" and nothing listened: `onDragDropEvent` was installed by `window-events.svelte.ts`, which
 * only the workbench uses, so the sentence was a promise no code kept. Nothing failed - the file
 * simply did not open, which reads as the window being broken rather than as a missing listener.
 *
 * The rest of the cases are here because the same handler must *not* fire for them: a drag passing
 * over the window is not a drop, and one dropped file is one window.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

const dropped = vi.hoisted(() => ({ handler: null as ((event: unknown) => void) | null, stops: 0 }));
vi.mock('@tauri-apps/api/webview', () => ({
	getCurrentWebview: () => ({
		onDragDropEvent: (handler: (event: unknown) => void) => {
			dropped.handler = handler;
			return Promise.resolve(() => (dropped.stops += 1));
		}
	})
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ setTitle: () => {} }) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

const ipc = vi.hoisted(() => ({
	appVersion: vi.fn().mockResolvedValue('0.2.0'),
	forgetRecent: vi.fn().mockResolvedValue(undefined),
	importKinds: vi.fn().mockResolvedValue([]),
	openEmptyWindow: vi.fn().mockResolvedValue(undefined),
	openInNewWindow: vi.fn().mockResolvedValue(undefined),
	recentSources: vi.fn().mockResolvedValue([]),
	refreshMenu: vi.fn().mockResolvedValue(undefined),
	takeOpened: vi.fn().mockResolvedValue([]),
	MENU_EVENT: 'studio://menu',
	OPENED_EVENT: 'studio://opened'
}));
vi.mock('./lib/ipc/commands', () => ipc);
vi.mock('./lib/state/diagnostics.svelte', () => ({
	record: vi.fn(),
	refresh: vi.fn().mockResolvedValue(undefined),
	reportProblem: vi.fn().mockResolvedValue(true),
	watch: () => () => {}
}));
vi.mock('./lib/state/graphs.svelte', () => ({ graphs: { empty: true } }));
vi.mock('./lib/state/status.svelte', () => ({ status: { fail: vi.fn() } }));

const Launcher = (await import('./Launcher.svelte')).default;

/** Delivers a Tauri drag-and-drop event to whatever the window installed. */
const send = (payload: unknown) => dropped.handler?.({ payload });

afterEach(() => {
	cleanup();
	dropped.handler = null;
	dropped.stops = 0;
	vi.clearAllMocks();
});

describe('dropping something on the launcher', () => {
	it('listens at all', async () => {
		render(Launcher);
		await vi.waitFor(() => expect(dropped.handler).toBeTypeOf('function'));
	});

	it('opens a window for the file that was dropped', async () => {
		render(Launcher);
		await vi.waitFor(() => expect(dropped.handler).toBeTypeOf('function'));

		send({ type: 'drop', paths: ['/maps/berlin.versatiles'] });

		await vi.waitFor(() => expect(ipc.openInNewWindow).toHaveBeenCalledWith('/maps/berlin.versatiles'));
	});

	/**
	 * **Unfiltered on purpose.** The launcher hands the path to a new window and that window decides
	 * what it is ([S7.6]); a project directory has no extension at all, and refusing one here would
	 * refuse a gesture the door beside it offers.
	 */
	it('hands over a project directory, which has no extension to match on', async () => {
		render(Launcher);
		await vi.waitFor(() => expect(dropped.handler).toBeTypeOf('function'));

		send({ type: 'drop', paths: ['/projects/berlin'] });

		await vi.waitFor(() => expect(ipc.openInNewWindow).toHaveBeenCalledWith('/projects/berlin'));
	});

	/// `openInNewWindow` closes this window, so a second call would be made from one that is going
	/// away - and opening one thing is what every other door here does.
	it('opens one window even when several files are dropped together', async () => {
		render(Launcher);
		await vi.waitFor(() => expect(dropped.handler).toBeTypeOf('function'));

		send({ type: 'drop', paths: ['/maps/a.versatiles', '/maps/b.versatiles', '/maps/c.versatiles'] });

		await vi.waitFor(() => expect(ipc.openInNewWindow).toHaveBeenCalledTimes(1));
		expect(ipc.openInNewWindow).toHaveBeenCalledWith('/maps/a.versatiles');
	});

	it('does nothing while a drag is only passing over', async () => {
		render(Launcher);
		await vi.waitFor(() => expect(dropped.handler).toBeTypeOf('function'));

		send({ type: 'over', paths: ['/maps/berlin.versatiles'] });
		send({ type: 'leave' });

		expect(ipc.openInNewWindow).not.toHaveBeenCalled();
	});

	it('does nothing for a drop that carried no paths', async () => {
		render(Launcher);
		await vi.waitFor(() => expect(dropped.handler).toBeTypeOf('function'));

		send({ type: 'drop', paths: [] });

		expect(ipc.openInNewWindow).not.toHaveBeenCalled();
	});

	/**
	 * The window it opens is what reports anything wrong with the *contents*; this can only fail to
	 * open a window at all, and a launcher that silently did nothing would look broken.
	 */
	it('says so when no window could be opened for it', async () => {
		ipc.openInNewWindow.mockRejectedValueOnce(new Error('no window'));
		const { findByRole } = render(Launcher);
		await vi.waitFor(() => expect(dropped.handler).toBeTypeOf('function'));

		send({ type: 'drop', paths: ['/maps/berlin.versatiles'] });

		expect((await findByRole('alert')).textContent).toContain('Could not open a window for it.');
	});

	// A reload that left the previous listener attached would open two windows for one drop.
	it('lets go of the listener when the window goes', async () => {
		render(Launcher);
		await vi.waitFor(() => expect(dropped.handler).toBeTypeOf('function'));

		cleanup();

		await vi.waitFor(() => expect(dropped.stops).toBe(1));
	});
});
