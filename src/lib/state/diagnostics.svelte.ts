/**
 * What has gone wrong this session, and the handlers that notice it (S6.8).
 *
 * **The problem this solves is not "log more".** Errors already had five sinks — the status bar,
 * the webview console, `eprintln!`, the job log, and a panic's nothing at all — and not one of them
 * survived to a place a user could copy from. A person hitting a bug could describe it from memory
 * or not at all.
 *
 * The list itself lives in the core (`studio_core::diagnostics`), for the reason [Q16] gives for
 * everything else: a log kept in the window is empty exactly when it is most wanted, which is after
 * the window has reloaded or crashed. This module is the *webview's* half — the handlers that catch
 * what only the webview can see, and the mirror the panel draws.
 *
 * **Three rules, each of which was a way to make things worse:**
 *
 * * **Reporting never throws, and never loses one.** Every catch point here runs inside somebody
 *   else's failure path, including `unhandledrejection` — so a rejection raised *while reporting a
 *   rejection* is a loop that takes the window with it. Reports are therefore queued behind one
 *   another and every failure of the queue itself is swallowed.
 * * **The count comes from the core.** A window that counted its own would disagree with the core
 *   the moment a panic, a second window or a reload put an entry there.
 * * **The list is fetched, never streamed.** One `bin` container reports a failure per tile; the
 *   core folds those into one row, and a push per occurrence would spend a thousand messages
 *   arriving at the same number.
 *
 * [Q16]: ../../../docs/decisions.md
 */

import { clearDiagnostics, diagnostics, logDiagnostic, type NewProblem, type Problem } from '../ipc/commands';

/** What the panel draws, newest first. Empty until something asks for it. */
let list = $state<Problem[]>([]);

/** How many distinct problems the core holds — the number on the bar's button. */
let count = $state(0);

/**
 * How many reports may be waiting on the core at once.
 *
 * The flood this bounds is real: MapLibre reports one failure per tile, and a screen of them
 * arrives faster than a round trip can answer. The core folds them into one row with a count, so
 * the hundredth adds nothing the second did not — but an unbounded queue of promises waiting to
 * tell it so is a leak.
 */
const QUEUE_LIMIT = 100;

/** Reports waiting on the core, and the tail to add the next one to. */
let queued = 0;
let pending: Promise<unknown> = Promise.resolve();

/** Reports turned away by the cap, so that the fact can be recorded rather than hidden. */
let dropped = 0;

export const problems = {
	get list(): Problem[] {
		return list;
	},

	get count(): number {
		return count;
	}
};

/**
 * Records a problem, and never fails doing it.
 *
 * Returns nothing on purpose. Every caller is a failure path that has something better to do than
 * wait for a log write, and the one thing a caller might want back — the count — is state the panel
 * reads from here.
 */
export function record(problem: NewProblem): void {
	if (queued >= QUEUE_LIMIT) {
		dropped += 1;
		return;
	}
	queued += 1;
	// **Queued rather than fired**, so reports reach the core in the order they happened and only
	// one is in flight at a time. Calling `logDiagnostic` inside the `then` also means a binding
	// that throws *synchronously* — `invoke` is called on the way to returning its promise, so a
	// webview without one throws before there is anything to catch — becomes a rejection this chain
	// handles, rather than an exception thrown back into `status.fail` and out of somebody's catch.
	pending = pending
		.then(() => logDiagnostic(problem))
		.then((total) => (count = total))
		.catch(() => {
			// The core is the only place a problem can be kept, so there is nowhere left to say that
			// saying it failed. Dropping it is the end of the line rather than a choice.
		})
		.finally(() => {
			queued -= 1;
			// **Said, not swallowed.** A cap that quietly discarded the overflow would leave a report
			// reading as complete, and its reader drawing conclusions from an absence this module
			// invented. Recorded once the queue is empty, so it cannot extend the flood it describes.
			if (queued > 0 || dropped === 0) return;
			const missed = dropped;
			dropped = 0;
			record({
				level: 'warn',
				origin: 'webview',
				message: `${missed} further problems arrived faster than they could be recorded, and were dropped`,
				detail: null
			});
		});
}

/** Rereads the list from the core. Called when the panel opens, and once at startup. */
export async function refresh(): Promise<void> {
	// Newest first: the interesting problem is the last one, and a folded repeat carries the time it
	// last happened — so a problem that is happening *again* rises rather than staying where it
	// first appeared. `id` breaks a tie within the same second, and is monotonic.
	const held = await diagnostics();
	list = [...held].sort((a, b) => b.at - a.at || b.id - a.id);
	count = held.length;
}

/**
 * Test seam: the module is a singleton, and one case's queue must not reach the next.
 *
 * **The queue as well as the list.** A case that fills the cap and does not drain it leaves every
 * later `record` turned away, which shows up as a case three files down reporting nothing and no
 * hint as to why.
 */
export function reset(): void {
	list = [];
	count = 0;
	queued = 0;
	dropped = 0;
	pending = Promise.resolve();
}

/** Forgets everything — for reproducing a problem cleanly before copying the report. */
export async function forgetAll(): Promise<void> {
	await clearDiagnostics();
	list = [];
	count = 0;
}

/**
 * Turns anything a `catch` might hold into a message and its detail.
 *
 * **The stack is kept.** `status.fail` reduces an error to one line because that is all a status
 * bar has room for; this is the other half of the same value, and throwing it away here would mean
 * every report said "opening berlin.mbtiles" and nothing about where.
 */
export function describe(error: unknown): { message: string; detail: string | null } {
	if (error instanceof Error) {
		return { message: error.message || error.name, detail: error.stack ?? null };
	}
	if (typeof error === 'object' && error !== null && 'message' in error) {
		return { message: String((error as { message: unknown }).message), detail: json(error) };
	}
	return { message: String(error), detail: null };
}

/** An object error's own fields, for the detail — a core error often carries a span or a path. */
function json(value: object): string | null {
	try {
		const text = JSON.stringify(value);
		return text === '{}' ? null : text;
	} catch {
		// Circular, or something with a throwing getter. The message is already out.
		return null;
	}
}

/**
 * Starts listening for what only the webview can see. Called once, from the shell's startup.
 *
 * Returns the teardown, so a reload does not leave two of each handler on one `window`.
 */
export function watch(): () => void {
	const onRejection = (event: PromiseRejectionEvent) => {
		const { message, detail } = describe(event.reason);
		record({ level: 'error', origin: 'webview', message, detail });
	};

	// **The capture phase**, which is what makes this more than a duplicate of `onerror`: a
	// `<script>` or an image that failed to load fires an `error` event that does not bubble, and
	// only a capturing listener on `window` ever sees it.
	const onError = (event: ErrorEvent) => {
		const { message, detail } = describe(event.error ?? event.message);
		record({
			level: 'error',
			origin: 'webview',
			message,
			detail: detail ?? (event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : null)
		});
	};

	window.addEventListener('unhandledrejection', onRejection);
	window.addEventListener('error', onError, true);
	return () => {
		window.removeEventListener('unhandledrejection', onRejection);
		window.removeEventListener('error', onError, true);
	};
}
