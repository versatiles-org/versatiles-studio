import { beforeEach, describe, expect, it, vi } from 'vitest';

// The bar keeps a failure for as long as the next one takes to arrive; the log keeps it for the
// session, which is what a person writing an issue an hour later has to work from (S6.8).
const ipc = vi.hoisted(() => ({
	logDiagnostic: vi.fn(async () => 1),
	diagnostics: vi.fn(async () => []),
	clearDiagnostics: vi.fn(async () => null)
}));
vi.mock('../ipc/commands', () => ipc);

const { status } = await import('./status.svelte');

beforeEach(() => vi.clearAllMocks());

describe('what the bar says', () => {
	it('reports a plain message as itself', () => {
		status.fail('no such file');
		expect(status.current).toEqual({ kind: 'error', message: 'no such file' });
	});

	// `String({ message: 'x' })` is `"[object Object]"`, which is what the bar used to say whenever
	// an error arrived as an object — one call site had learnt to unwrap it and seventeen had not.
	it('unwraps an error object rather than stringifying it', () => {
		status.fail(new Error('opening berlin.mbtiles'));
		expect(status.current).toEqual({ kind: 'error', message: 'opening berlin.mbtiles' });

		status.fail({ message: 'from the core' });
		expect(status.current).toEqual({ kind: 'error', message: 'from the core' });
	});

	it('settles a busy message', () => {
		status.busy('Opening…');
		expect(status.current.kind).toBe('busy');
		status.settle();
		expect(status.current).toEqual({ kind: 'idle' });
	});

	// An error is a state somebody has to read. An operation finishing after one has landed must not
	// wipe it — the failure is the more important of the two things the bar could be saying.
	it('does not let a finishing operation wipe an error', () => {
		status.fail('it broke');
		status.settle();
		expect(status.current).toEqual({ kind: 'error', message: 'it broke' });
	});

	it('records every failure it shows, with the detail the bar has no room for', async () => {
		status.fail(new Error('opening berlin.mbtiles'));

		// Awaited, because reporting is queued: a bar that waited on the core before it could show a
		// failure would put an IPC round trip in front of every error message.
		await vi.waitFor(() => expect(ipc.logDiagnostic).toHaveBeenCalledTimes(1));
		const [reported] = ipc.logDiagnostic.mock.calls[0] as unknown as [
			{ level: string; origin: string; message: string; detail: string | null }
		];
		expect(reported.level).toBe('error');
		expect(reported.origin).toBe('webview');
		expect(reported.message).toBe('opening berlin.mbtiles');
		// The stack is the half a status bar cannot show and a bug report cannot do without.
		expect(reported.detail).toContain('opening berlin.mbtiles');
	});

	it('carries a fraction when there is one to show', () => {
		status.busy('Writing…', 0.4);
		expect(status.current).toEqual({ kind: 'busy', message: 'Writing…', fraction: 0.4 });
		status.dismiss();
	});
});
