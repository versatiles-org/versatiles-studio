/**
 * What the application is doing, shown along the bottom ([Q24](../../../docs/decisions.md)).
 *
 * **Here rather than in `App.svelte` because eighteen places wrote it.** Every operation that takes
 * a moment says so, and every one that fails says that — so a status write is the one thing almost
 * every other module needs. Left in the component, each of those modules would have had to be handed
 * a callback to reach it; a module they can import instead is the difference between five clean
 * extractions and five with a constructor argument nobody wants.
 *
 * **Errors live here too.** An error is a state the application is in, which is exactly what a
 * status bar is for, and covering the map to say so was never a good trade.
 *
 * The `Status` shape stays with `StatusBar`, which is what renders it.
 */

import type { Status } from '../shell/StatusBar.svelte';

let current = $state<Status>({ kind: 'idle' });

export const status = {
	get current(): Status {
		return current;
	},

	/** Says what is happening, with an optional fraction for a progress bar. */
	busy(message: string, fraction?: number): void {
		current = fraction === undefined ? { kind: 'busy', message } : { kind: 'busy', message, fraction };
	},

	/**
	 * Quiets a "busy" that has finished.
	 *
	 * **Only a busy one.** An error is a state somebody has to read and dismiss, and an operation
	 * finishing after one has landed must not wipe it — the failure is the more important of the two
	 * things the bar could be saying.
	 */
	settle(): void {
		if (current.kind === 'busy') current = { kind: 'idle' };
	},

	/**
	 * Reports a failure.
	 *
	 * Takes `unknown` because every caller is a `catch`, and narrowing at each of eighteen call sites
	 * is eighteen chances to narrow it differently.
	 *
	 * **Unwraps `.message` here rather than at the call site.** `String({ message: 'no such file' })`
	 * is `"[object Object]"`, which is what the bar said whenever an error arrived as an object — one
	 * call site had learnt to unwrap it and the other seventeen had not. Deciding how an error
	 * becomes text is this function's job, and there is one of it.
	 */
	fail(error: unknown): void {
		const message =
			typeof error === 'object' && error !== null && 'message' in error
				? String((error as { message: unknown }).message)
				: String(error);
		current = { kind: 'error', message };
	},

	/** Clears whatever it is saying — the dismiss button, and nothing else. */
	dismiss(): void {
		current = { kind: 'idle' };
	}
};
