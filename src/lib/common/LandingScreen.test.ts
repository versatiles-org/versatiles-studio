// @vitest-environment jsdom

/**
 * The launcher's three doors.
 *
 * It had seven controls and now has three, so what is worth asserting is that each door still leads
 * somewhere — and that the remote one, which is the only one with a state, opens rather than
 * needing two presses to do anything.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import LandingScreen from './LandingScreen.svelte';
import type { ImportKind, RecentEntry } from '../ipc/commands';

afterEach(cleanup);

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
		onForget: vi.fn()
	};
	render(LandingScreen, { kinds: KINDS, recents: [], ...over, ...calls });
	return calls;
}

describe('the three doors', () => {
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

	/**
	 * The remote door is the one with a state: it reveals a field rather than being one, so three
	 * cards read as three choices instead of a form with two buttons beside it.
	 */
	it('opens a field for a remote file, with the caret already in it', async () => {
		show();
		expect(screen.queryByLabelText('Address of a remote file')).toBeNull();

		(await screen.findByRole('button', { name: /Open a remote file/ })).click();

		const field = await screen.findByLabelText('Address of a remote file');
		// Awaited, because focusing waits for the field to exist — which is the whole reason it is
		// not done in the same breath as the press.
		await vi.waitFor(() =>
			expect(document.activeElement, 'a door that opens without focusing asks for a second click').toBe(field)
		);
	});

	it('hands over what was typed, and not an empty field', async () => {
		const calls = show();
		(await screen.findByRole('button', { name: /Open a remote file/ })).click();

		const submit = (await screen.findByRole('button', { name: 'Open' })) as HTMLButtonElement;
		expect(submit.disabled, 'nothing typed yet').toBe(true);

		const field = (await screen.findByLabelText('Address of a remote file')) as HTMLInputElement;
		field.value = 'https://example.org/planet.versatiles';
		field.dispatchEvent(new Event('input', { bubbles: true }));

		(await screen.findByRole('button', { name: 'Open' })).click();
		expect(calls.onOpenUrl).toHaveBeenCalledWith('https://example.org/planet.versatiles');
	});
});

describe('what the build can read', () => {
	/** From the core's catalogue, so it cannot name something this build lacks (S3.2). */
	it('names the kinds rather than making a button of each', async () => {
		show();
		expect(await screen.findByText('Tile container · Vector data')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Tile container/ })).toBeNull();
	});

	it('says nothing when the catalogue is empty', () => {
		show({ kinds: [] });
		expect(screen.queryByText(/·/)).toBeNull();
	});
});

describe('the recent list', () => {
	it('reopens what is on it, and forgets on request', async () => {
		const calls = show({ recents: RECENTS });

		(await screen.findByTitle('/data/berlin.versatiles')).click();
		expect(calls.onOpenUrl).toHaveBeenCalledWith('/data/berlin.versatiles');

		(await screen.findByRole('button', { name: 'Forget' })).click();
		expect(calls.onForget).toHaveBeenCalledWith('/data/berlin.versatiles');
	});

	it('is absent rather than empty when there is nothing to list', () => {
		show();
		expect(screen.queryByText('Recent')).toBeNull();
	});
});
