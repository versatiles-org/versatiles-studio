import { describe, expect, it } from 'vitest';
import { status } from './status.svelte';

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

	it('carries a fraction when there is one to show', () => {
		status.busy('Writing…', 0.4);
		expect(status.current).toEqual({ kind: 'busy', message: 'Writing…', fraction: 0.4 });
		status.dismiss();
	});
});
