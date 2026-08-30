// @vitest-environment jsdom

/**
 * What the update dialog says, and when it asks.
 *
 * It is a state machine with six states and three buttons that come and go, which is exactly the
 * kind of thing that is right until someone adds a seventh. The rule worth pinning down is the one
 * that is easy to get backwards: **opening it is the question**, so it checks when it knows nothing
 * and stays quiet when it already has an answer to show.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';

const updater = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('@tauri-apps/plugin-updater', () => updater);

const process = vi.hoisted(() => ({ relaunch: vi.fn() }));
vi.mock('@tauri-apps/plugin-process', () => process);

const { default: UpdateDialog } = await import('./UpdateDialog.svelte');
const { updates } = await import('../state/updates.svelte');

/**
 * jsdom has no `showModal` - a `<dialog>` there is an element with none of the behaviour.
 *
 * Shimmed rather than worked around, because `Modal` calls it on mount and the alternative is a
 * component that cannot be rendered in a test at all. What it does not prove is the top layer, the
 * backdrop or Escape; those are the browser's, and none of them is what this file is about.
 */
beforeEach(() => {
	HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
		this.open = true;
	};
	vi.clearAllMocks();
	updates.dismiss();
});

afterEach(cleanup);

/** An update the server is offering. */
const offered = (version = '0.3.0', body: string | null = null) => ({
	version,
	body,
	downloadAndInstall: vi.fn().mockResolvedValue(undefined)
});

describe('asking for an update', () => {
	it('asks as it opens, and says there is nothing', async () => {
		updater.check.mockResolvedValue(null);
		render(UpdateDialog, { onClose: () => {} });

		expect(await screen.findByText('Studio is up to date.')).toBeTruthy();
		expect(updater.check).toHaveBeenCalledTimes(1);
		// Nothing to install, so the only thing left to offer is looking again.
		expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
	});

	it('offers what is available, with the notes that came with it', async () => {
		updater.check.mockResolvedValue(offered('0.3.0', 'Fixes the raster preview.'));
		render(UpdateDialog, { onClose: () => {} });

		expect(await screen.findByText('0.3.0')).toBeTruthy();
		// What an update contains is the whole of what someone is deciding about.
		expect(screen.getByText('Fixes the raster preview.')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy();
	});

	/** Reopening after an install should show what happened, not throw it away and look again. */
	it('does not ask again when it already knows', async () => {
		updater.check.mockResolvedValue(null);
		render(UpdateDialog, { onClose: () => {} });
		await screen.findByText('Studio is up to date.');
		cleanup();

		render(UpdateDialog, { onClose: () => {} });
		expect(await screen.findByText('Studio is up to date.')).toBeTruthy();
		expect(updater.check).toHaveBeenCalledTimes(1);
	});

	it('says what went wrong rather than looking like nothing happened', async () => {
		updater.check.mockRejectedValue(new Error('Network Error'));
		render(UpdateDialog, { onClose: () => {} });

		// The state module names the subject: "Network Error" alone reads as a bug in Studio.
		expect(await screen.findByText(/Could not reach the update server/)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
	});
});

describe('installing one', () => {
	it('offers a restart once it is in, and does not take it', async () => {
		const update = offered('0.3.0');
		updater.check.mockResolvedValue(update);
		render(UpdateDialog, { onClose: () => {} });

		(await screen.findByRole('button', { name: 'Install' })).click();

		expect(await screen.findByText(/starts with the next launch/)).toBeTruthy();
		expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
		// Restarting is its own press: only the window knows whether there is unsaved work in it.
		expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy();
		expect(process.relaunch).not.toHaveBeenCalled();
		// And closing is still offered - as "Later", because there is now something to come back to.
		expect(screen.getByRole('button', { name: 'Later' })).toBeTruthy();
	});

	/**
	 * **The committing press is the rightmost**, which is the order the other four dialogs use.
	 *
	 * Asserted as an order rather than as presence, because presence is what the tests above already
	 * cover and order is what was wrong: `Install` and `Restart now` used to come *before* the way
	 * out, so they sat where `Export`, `Steps` and `Copy` all put `Cancel`. The row is
	 * `justify-content: flex-end`, so document order is left-to-right and last is rightmost.
	 */
	const labels = () => screen.getAllByRole('button').map((button) => button.textContent?.trim());

	it('puts the install after the way out, not before it', async () => {
		updater.check.mockResolvedValue(offered('0.3.0'));
		render(UpdateDialog, { onClose: () => {} });

		await screen.findByRole('button', { name: 'Install' });
		expect(labels()).toEqual(['Close', 'Install']);
	});

	it('puts the restart after the way out too', async () => {
		const update = offered('0.3.0');
		updater.check.mockResolvedValue(update);
		render(UpdateDialog, { onClose: () => {} });

		(await screen.findByRole('button', { name: 'Install' })).click();
		await screen.findByRole('button', { name: 'Restart now' });

		expect(labels()).toEqual(['Later', 'Restart now']);
	});

	// The two states with nothing to commit: a re-check is neither the commit nor the way out, so it
	// stays first and the way out stays last.
	it('leaves a re-check first when there is no primary at all', async () => {
		updater.check.mockResolvedValue(null);
		render(UpdateDialog, { onClose: () => {} });

		await screen.findByText('Studio is up to date.');
		expect(labels()).toEqual(['Check again', 'Close']);
	});
});
