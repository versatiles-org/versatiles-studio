// @vitest-environment jsdom
//
// For `watch` alone: the handlers it installs are on `window`, and the events it listens for have
// no other way to be raised.
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The webview's half of the problem log (S6.8).
 *
 * Every one of these is a way of making a bad moment worse: a report that throws inside the failure
 * it is reporting, a loop that reports its own reporting, a count that disagrees with the core.
 */

const ipc = vi.hoisted(() => ({
	logDiagnostic: vi.fn(),
	diagnostics: vi.fn(),
	clearDiagnostics: vi.fn(),
	previousProblems: vi.fn()
}));
vi.mock('../ipc/commands', () => ipc);

const {
	problems,
	record,
	refresh,
	forgetAll,
	loadEarlier,
	reset,
	describe: describeError,
	watch
} = await import('./diagnostics.svelte');

/** A stored problem, with only the fields these cases look at filled in. */
function problem(over: Partial<{ id: number; at: number; message: string }> = {}) {
	return {
		id: 1,
		at: 1_787_000_000,
		level: 'error' as const,
		origin: 'webview' as const,
		message: 'it broke',
		detail: null,
		count: 1,
		...over
	};
}

/**
 * Lets a report finish arriving.
 *
 * `record` releases its in-flight guard in a `finally`, which is a microtask — so a second report
 * issued in the same turn is dropped by design, and a case that means to test the *next* one has to
 * let the turn end first.
 */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	vi.clearAllMocks();
	ipc.diagnostics.mockResolvedValue([]);
	ipc.clearDiagnostics.mockResolvedValue(null);
	ipc.logDiagnostic.mockResolvedValue(0);
	ipc.previousProblems.mockResolvedValue([]);
	reset();
});

describe('reporting a problem', () => {
	it('takes the count from the core rather than keeping its own', async () => {
		// A window that counted its own would disagree with the core the moment a panic, a second
		// window or a reload put an entry there.
		ipc.logDiagnostic.mockResolvedValueOnce(7);
		record({ level: 'error', origin: 'webview', message: 'it broke', detail: null });
		await vi.waitFor(() => expect(problems.count).toBe(7));
	});

	it('does not throw when there is nothing to report to', () => {
		// The generated binding calls `invoke` on the way to returning a promise, so a webview
		// without one throws *synchronously* — inside `status.fail`, inside somebody's `catch`.
		ipc.logDiagnostic.mockImplementation(() => {
			throw new Error('no IPC here');
		});
		expect(() => record({ level: 'error', origin: 'webview', message: 'it broke', detail: null })).not.toThrow();
	});

	it('swallows a rejected report rather than raising another', async () => {
		// This one is a loop: a rejection nothing catches fires `unhandledrejection`, which reports.
		ipc.logDiagnostic.mockRejectedValueOnce(new Error('core is gone'));
		record({ level: 'error', origin: 'webview', message: 'it broke', detail: null });
		await settled();
		expect(ipc.logDiagnostic).toHaveBeenCalledTimes(1);

		// And having failed, it is still willing to try the next one.
		ipc.logDiagnostic.mockResolvedValueOnce(1);
		record({ level: 'error', origin: 'webview', message: 'again', detail: null });
		await vi.waitFor(() => expect(problems.count).toBe(1));
	});

	it('queues a burst rather than keeping only the first of it', async () => {
		// One report is in flight at a time, but nothing is lost: three different failures in one
		// turn are three different things worth reading, and a guard that dropped two of them would
		// hide exactly the cascade that explains the third.
		let settle = (_: number) => {};
		ipc.logDiagnostic.mockReturnValueOnce(new Promise<number>((resolve) => (settle = resolve)));
		ipc.logDiagnostic.mockResolvedValue(3);

		record({ level: 'error', origin: 'webview', message: 'first', detail: null });
		record({ level: 'error', origin: 'webview', message: 'second', detail: null });
		record({ level: 'error', origin: 'webview', message: 'third', detail: null });
		// Nothing has been sent yet at all: the queue hands the first one over on a microtask, which
		// is also what turns a binding that throws synchronously into a rejection this can catch.
		expect(ipc.logDiagnostic).toHaveBeenCalledTimes(0);

		await settled();
		expect(ipc.logDiagnostic, 'only the first is in flight').toHaveBeenCalledTimes(1);

		settle(1);
		await vi.waitFor(() => expect(ipc.logDiagnostic).toHaveBeenCalledTimes(3));
		// In the order they happened, which is the order they have to be read in.
		expect(ipc.logDiagnostic.mock.calls.map(([r]) => (r as { message: string }).message)).toEqual([
			'first',
			'second',
			'third'
		]);
	});

	/**
	 * MapLibre reports one failure per tile, and a screen of them arrives faster than a round trip
	 * can answer. The core folds them into one row — but the queue waiting to tell it so is this
	 * side's problem, and an unbounded one is a leak.
	 */
	it('caps a flood, and says that it did', async () => {
		let settle = (_: number) => {};
		ipc.logDiagnostic.mockReturnValueOnce(new Promise<number>((resolve) => (settle = resolve)));
		ipc.logDiagnostic.mockResolvedValue(1);

		for (let index = 0; index < 150; index += 1) {
			record({ level: 'error', origin: 'map', message: `tile ${index} failed`, detail: null });
		}
		settle(1);
		await vi.waitFor(() => expect(ipc.logDiagnostic).toHaveBeenCalledTimes(101));

		// A hundred sent, fifty turned away, and one entry saying so — rather than a report that
		// reads as complete because the overflow vanished quietly.
		const last = ipc.logDiagnostic.mock.calls.at(-1)?.[0] as { level: string; message: string };
		expect(last.level).toBe('warn');
		expect(last.message).toContain('50 further problems');
	});
});

describe('the list the panel draws', () => {
	it('puts the newest first, and a repeat back at the top', async () => {
		// A folded repeat carries the time it *last* happened, so something happening again rises
		// rather than staying where it first appeared — which is the whole point of folding.
		ipc.diagnostics.mockResolvedValueOnce([
			problem({ id: 1, at: 300, message: 'oldest' }),
			problem({ id: 2, at: 100, message: 'first seen long ago, still happening' }),
			problem({ id: 3, at: 200, message: 'middle' })
		]);
		await refresh();
		expect(problems.list.map((p) => p.message)).toEqual(['oldest', 'middle', 'first seen long ago, still happening']);
		expect(problems.count).toBe(3);
	});

	it('breaks a tie within the same second by id', async () => {
		ipc.diagnostics.mockResolvedValueOnce([problem({ id: 4, at: 500 }), problem({ id: 9, at: 500 })]);
		await refresh();
		expect(problems.list.map((p) => p.id)).toEqual([9, 4]);
	});

	it('empties when told to forget', async () => {
		ipc.diagnostics.mockResolvedValueOnce([problem()]);
		await refresh();
		expect(problems.list).toHaveLength(1);

		await forgetAll();
		expect(ipc.clearDiagnostics).toHaveBeenCalled();
		expect(problems.list).toEqual([]);
		expect(problems.count).toBe(0);
	});
});

describe('the run before this one', () => {
	it('is unread until something asks for it, and is not the same as empty', async () => {
		// `null` is "nobody has looked", which the panel shows as "reading…" — a run that recorded
		// nothing is a different answer, and showing one as the other reads as a bug in the log.
		expect(problems.earlier).toBeNull();
		expect(ipc.previousProblems).not.toHaveBeenCalled();

		await loadEarlier();
		expect(problems.earlier).toEqual([]);
	});

	it('is kept apart from this session, newest first', async () => {
		ipc.diagnostics.mockResolvedValueOnce([problem({ id: 1, message: 'happening now' })]);
		await refresh();

		ipc.previousProblems.mockResolvedValueOnce([
			problem({ id: 1, at: 100, message: 'what killed it' }),
			problem({ id: 2, at: 400, message: 'the last thing it said' })
		]);
		await loadEarlier();

		// Two lists, not one longer one: they answer different questions, and a report has to say
		// which of the two it is describing.
		expect(problems.list.map((p) => p.message)).toEqual(['happening now']);
		expect(problems.earlier?.map((p) => p.message)).toEqual(['the last thing it said', 'what killed it']);
	});

	it('shows nothing rather than failing when the file cannot be read', async () => {
		ipc.previousProblems.mockRejectedValueOnce(new Error('no such directory'));
		await loadEarlier();
		expect(problems.earlier).toEqual([]);
	});
});

describe('turning a caught thing into a problem', () => {
	it('keeps the stack of an Error, which is what the status bar has no room for', () => {
		const error = new Error('opening berlin.mbtiles');
		const described = describeError(error);
		expect(described.message).toBe('opening berlin.mbtiles');
		expect(described.detail).toContain('opening berlin.mbtiles');
	});

	it('unwraps the core convention: an object with a message', () => {
		expect(describeError({ message: 'from the core', span: [4, 9] })).toEqual({
			message: 'from the core',
			detail: '{"message":"from the core","span":[4,9]}'
		});
	});

	it('stringifies anything else rather than reporting [object Object]', () => {
		expect(describeError('no such file')).toEqual({ message: 'no such file', detail: null });
	});

	it('survives a detail it cannot serialise', () => {
		const circular: Record<string, unknown> = { message: 'looped' };
		circular.self = circular;
		expect(describeError(circular)).toEqual({ message: 'looped', detail: null });
	});
});

describe('what only the webview can see', () => {
	it('reports a promise nobody caught, and stops when told', async () => {
		// The reason this exists: ~90 places start a promise with `void`, and not one of them can
		// reach a `catch`.
		ipc.logDiagnostic.mockResolvedValue(1);
		const stop = watch();

		window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('nobody caught this') }));
		await vi.waitFor(() => expect(ipc.logDiagnostic).toHaveBeenCalledTimes(1));
		expect(ipc.logDiagnostic.mock.calls[0][0]).toMatchObject({
			level: 'error',
			origin: 'webview',
			message: 'nobody caught this'
		});

		// A reload that left the handlers attached would report every problem twice.
		stop();
		window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('after teardown') }));
		await settled();
		expect(ipc.logDiagnostic).toHaveBeenCalledTimes(1);
	});
});
