/**
 * Auto-update (G4, S5.8).
 *
 * **Checked when asked, never on a timer.** An application that downloads and swaps itself out while
 * someone is mid-export is worse than one that waits - and Studio's long operations are minutes
 * long, which is exactly the window a background updater would land in. So this is a button, and
 * every state it can be in has a sentence.
 *
 * **The signature is what makes this safe, not the URL.** Tauri verifies the downloaded bundle
 * against the minisign public key compiled into the app before it replaces anything, so a
 * compromised release page cannot install anything we did not sign. That is why the key lives in
 * `tauri.conf.json` and its private half only ever exists as a repository secret.
 *
 * **Restart is a separate press.** An installed update takes effect on restart; doing it for someone
 * is the same class of decision as updating without asking.
 */

import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

/** Where the check has got to. Every branch here is something the UI has to be able to say. */
export type UpdateState =
	| { kind: 'idle' }
	| { kind: 'checking' }
	| { kind: 'current' }
	| { kind: 'available'; version: string; notes: string | null }
	| { kind: 'installing' }
	| { kind: 'ready'; version: string }
	| { kind: 'failed'; message: string };

class Updates {
	state = $state<UpdateState>({ kind: 'idle' });

	/// The update itself, held between the check and the install so the second does not repeat the
	/// first - and kept out of `state`, which is what the UI reads and should stay plain data.
	#pending: Update | null = null;

	/// Looks for a newer version. Safe to call again; the last answer is replaced, not appended.
	async check(): Promise<void> {
		this.state = { kind: 'checking' };
		try {
			const update = await check();
			this.#pending = update;
			this.state = update
				? { kind: 'available', version: update.version, notes: update.body ?? null }
				: { kind: 'current' };
		} catch (error) {
			this.#pending = null;
			this.state = { kind: 'failed', message: message(error) };
		}
	}

	/// Downloads and installs it. The running application is untouched until it restarts.
	async install(): Promise<void> {
		const update = this.#pending;
		if (!update) return;

		this.state = { kind: 'installing' };
		try {
			await update.downloadAndInstall();
			this.state = { kind: 'ready', version: update.version };
		} catch (error) {
			this.state = { kind: 'failed', message: message(error) };
		}
	}

	/// Restarts into the installed version. Nothing here asks about unsaved work - the caller does,
	/// because only it knows what is open.
	async restart(): Promise<void> {
		await relaunch();
	}

	dismiss(): void {
		this.state = { kind: 'idle' };
	}
}

/**
 * A `fetch` failure reaches here as a bare string, and "Network Error" with no subject reads as a
 * bug in Studio. Everything this can fail at is one request, so saying which one is free.
 */
function message(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return /network|fetch|dns|connect/i.test(text) ? `Could not reach the update server - ${text}` : text;
}

export const updates = new Updates();
