import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Auto-update's state machine (G4, S5.8).
 *
 * Every branch here is a sentence the interface has to be able to say, and three of them are only
 * reachable when something has gone wrong — which is exactly when nobody is in a position to check
 * by hand.
 */

const updater = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('@tauri-apps/plugin-updater', () => updater);

const process = vi.hoisted(() => ({ relaunch: vi.fn() }));
vi.mock('@tauri-apps/plugin-process', () => process);

const { updates } = await import('./updates.svelte');

/** An update as the plugin hands one over — only the fields this module reads. */
const available = (over: Record<string, unknown> = {}) => ({
	version: '0.3.0',
	body: 'Fixes the background map.',
	downloadAndInstall: vi.fn().mockResolvedValue(undefined),
	...over
});

beforeEach(() => {
	vi.clearAllMocks();
	updates.dismiss();
});

describe('checking', () => {
	it('says so while it is asking', async () => {
		let seen: string | undefined;
		updater.check.mockImplementation(() => {
			seen = updates.state.kind;
			return Promise.resolve(null);
		});
		await updates.check();
		expect(seen).toBe('checking');
	});

	it('reports being up to date', async () => {
		updater.check.mockResolvedValue(null);
		await updates.check();
		expect(updates.state).toEqual({ kind: 'current' });
	});

	it('reports a newer version with its notes', async () => {
		updater.check.mockResolvedValue(available());
		await updates.check();
		expect(updates.state).toEqual({
			kind: 'available',
			version: '0.3.0',
			notes: 'Fixes the background map.'
		});
	});

	it('accepts a release with no notes', async () => {
		updater.check.mockResolvedValue(available({ body: undefined }));
		await updates.check();
		expect(updates.state).toMatchObject({ kind: 'available', notes: null });
	});

	// **"Network Error" with no subject reads as a bug in Studio.** Everything this can fail at is
	// one request, so saying which one is free.
	it('names the update server when the network is the problem', async () => {
		updater.check.mockRejectedValue(new Error('fetch failed'));
		await updates.check();
		expect(updates.state).toEqual({
			kind: 'failed',
			message: 'Could not reach the update server — fetch failed'
		});
	});

	it('passes other failures through as they are', async () => {
		updater.check.mockRejectedValue(new Error('signature did not verify'));
		await updates.check();
		expect(updates.state).toEqual({ kind: 'failed', message: 'signature did not verify' });
	});

	// The last answer is replaced, not appended — a second press must not leave a stale offer up.
	it('replaces the previous answer rather than keeping it', async () => {
		updater.check.mockResolvedValue(available());
		await updates.check();
		updater.check.mockResolvedValue(null);
		await updates.check();
		expect(updates.state).toEqual({ kind: 'current' });
	});
});

describe('installing', () => {
	it('does nothing when nothing was found', async () => {
		updater.check.mockResolvedValue(null);
		await updates.check();
		await updates.install();
		expect(updates.state).toEqual({ kind: 'current' });
	});

	// **Restart is a separate press.** An installed update takes effect on restart, and doing that
	// for someone is the same class of decision as updating without asking.
	it('installs without restarting, and says which version is waiting', async () => {
		const update = available();
		updater.check.mockResolvedValue(update);
		await updates.check();
		await updates.install();

		expect(update.downloadAndInstall).toHaveBeenCalled();
		expect(updates.state).toEqual({ kind: 'ready', version: '0.3.0' });
		expect(process.relaunch).not.toHaveBeenCalled();
	});

	it('reports a failed install rather than claiming to be ready', async () => {
		updater.check.mockResolvedValue(
			available({ downloadAndInstall: vi.fn().mockRejectedValue(new Error('disk full')) })
		);
		await updates.check();
		await updates.install();
		expect(updates.state).toEqual({ kind: 'failed', message: 'disk full' });
	});

	// A failed check must not leave an update behind for `install` to find.
	it('has nothing to install after a failed check', async () => {
		updater.check.mockResolvedValue(available());
		await updates.check();
		updater.check.mockRejectedValue(new Error('offline'));
		await updates.check();
		await updates.install();
		expect(updates.state.kind).toBe('failed');
	});
});

describe('restarting', () => {
	it('relaunches, and asks nothing about unsaved work', async () => {
		await updates.restart();
		expect(process.relaunch).toHaveBeenCalled();
	});
});
