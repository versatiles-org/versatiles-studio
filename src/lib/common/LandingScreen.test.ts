// @vitest-environment jsdom

/**
 * The launcher's four doors, its recent list and its footer.
 *
 * It had seven controls and now has four, so what is worth asserting is that each door still leads
 * somewhere - and that the remote one, which is the only one with a state, opens rather than
 * needing two presses to do anything.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import LandingScreen from './LandingScreen.svelte';
import type { ImportKind, RecentEntry } from '../ipc/commands';

// jsdom has no `showModal`, and the remote door's dialog calls it on mount.
beforeEach(() => {
	HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
		this.open = true;
	};
	// The dialog asks download.versatiles.org for its catalogue; nothing here is about that.
	vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const KINDS = [
	{ id: 'container', label: 'Tile container', detail: '', extensions: ['versatiles'], operation: null, needs: [] },
	{ id: 'vector', label: 'Vector data', detail: '', extensions: ['geojson'], operation: 'from_geo', needs: [] }
] as unknown as ImportKind[];

const RECENTS = [{ source: '/data/berlin.versatiles', openedAt: Date.now() / 1000 - 120 }] as RecentEntry[];

/** The launcher with every handler recorded. */
function show(over: { kinds?: ImportKind[]; recents?: RecentEntry[] } = {}) {
	const calls = {
		onOpenFile: vi.fn(),
		onOpenUrl: vi.fn(),
		onOpenProject: vi.fn(),
		onNewProject: vi.fn(),
		onForget: vi.fn(),
		onOpenRepository: vi.fn()
	};
	render(LandingScreen, { kinds: KINDS, recents: [], version: '0.2.0', ...over, ...calls });
	return calls;
}

describe('the four doors', () => {
	it('opens a local file', async () => {
		const calls = show();
		(await screen.findByRole('button', { name: /Open a local file/ })).click();
		expect(calls.onOpenFile).toHaveBeenCalledTimes(1);
	});

	it('opens a project folder', async () => {
		const calls = show();
		(await screen.findByRole('button', { name: /Open a project folder/ })).click();
		expect(calls.onOpenProject).toHaveBeenCalledTimes(1);
	});

	// The one that hands the new window no work at all, which is why it sits under a rule.
	it('starts an empty project', async () => {
		const calls = show();
		(await screen.findByRole('button', { name: /New empty project/ })).click();
		expect(calls.onNewProject).toHaveBeenCalledTimes(1);
	});

	/**
	 * The remote door opens a dialog: what opens from an address is narrower than what opens from
	 * disk, and a field under the door had no room to say so. The dialog has its own tests.
	 */
	it('opens a dialog for a remote file, offering the remote recents only', async () => {
		show({
			recents: [
				{ source: '/data/berlin.versatiles', openedAt: 0 },
				{ source: 'https://example.org/planet.versatiles', openedAt: 0 }
			] as RecentEntry[]
		});
		expect(screen.queryByLabelText('Address of a remote file')).toBeNull();

		(await screen.findByRole('button', { name: /Open a remote file/ })).click();

		const dialog = await screen.findByRole('dialog', { name: 'Open a remote file' });
		expect(dialog.querySelector('[title="https://example.org/planet.versatiles"]')).not.toBeNull();
		expect(dialog.querySelector('[title="/data/berlin.versatiles"]')).toBeNull();
	});
});

describe('what the build can read', () => {
	/** From the core's catalogue, so it cannot name something this build lacks (S3.2). */
	it('names the kinds rather than making a button of each', async () => {
		show();
		expect(await screen.findByText('Tile container · Vector data')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Tile container/ })).toBeNull();
	});

	// Asked of the door rather than of the window: the footer separates its own three items with the
	// same character, and a build with no catalogue still has a version.
	it('says nothing when the catalogue is empty', async () => {
		show({ kinds: [] });
		const door = await screen.findByRole('button', { name: /Open a local file/ });
		expect(door.textContent).not.toContain('·');
	});
});

describe('the recent list', () => {
	it('reopens what is on it, and forgets on request', async () => {
		const calls = show({ recents: RECENTS });

		(await screen.findByTitle('/data/berlin.versatiles')).click();
		expect(calls.onOpenUrl).toHaveBeenCalledWith('/data/berlin.versatiles');

		// **Named for the row it is on.** A list of five recents used to offer five buttons all called
		// `Forget`, which is what a screen reader reads out and no way to tell which is which.
		(await screen.findByRole('button', { name: 'Forget berlin.versatiles' })).click();
		expect(calls.onForget).toHaveBeenCalledWith('/data/berlin.versatiles');
	});

	/**
	 * **It stays, and says so.** The list used to be absent until there was something in it, which is
	 * right for a column under the doors and wrong for a column beside them: half the window would be
	 * blank with no explanation.
	 */
	it('holds a place, and says what it is for, when there is nothing to list', () => {
		show();
		expect(screen.getByText('Recent')).toBeTruthy();
		expect(screen.getByText(/what you open will be listed here/)).toBeTruthy();
	});
});

/**
 * The footer, which is the only place the application says what it is.
 *
 * Version from the core rather than from `package.json`, and "alpha" beside it - the word is only
 * useful next to somewhere to report things, which is what the link is for.
 */
describe('the footer', () => {
	it('names the version, says alpha, and links to the repository', async () => {
		const calls = show();
		expect(screen.getByText(/VersaTiles Studio 0\.2\.0 · alpha/)).toBeTruthy();

		(await screen.findByRole('button', { name: 'github' })).click();
		expect(calls.onOpenRepository).toHaveBeenCalledTimes(1);
	});
});

/**
 * Dropping a file, which is the same gesture as the first door by other means.
 *
 * It used to be filed under the recent list, where it only was because that is where the window
 * happened to end - and where a first run, with nothing recent, would not think to look.
 */
describe('the drop hint', () => {
	it('sits with the door it is another way of pressing, in both states', () => {
		const { unmount } = render(LandingScreen, {
			kinds: KINDS,
			recents: RECENTS,
			version: '0.2.0',
			onOpenFile: vi.fn(),
			onOpenUrl: vi.fn(),
			onOpenProject: vi.fn(),
			onNewProject: vi.fn(),
			onForget: vi.fn(),
			onOpenRepository: vi.fn()
		});

		const hint = screen.getByText(/drop a file anywhere/);
		const start = screen.getByRole('button', { name: /Open a local file/ }).closest('section');
		expect(start?.contains(hint)).toBe(true);

		unmount();
		show();
		expect(screen.getByText(/drop a file anywhere/)).toBeTruthy();
	});
});
