import { describe, expect, it } from 'vitest';
import { unwrap } from './unwrap';

/**
 * The one decision in the command layer: an error from the core is a thrown error here.
 *
 * Every call site is a `try`/`catch` that hands what it caught to `status.fail`. If this returned
 * the failure as a value instead, each of those would take the error branch of nothing and carry on
 * with `undefined` — which is a blank pane rather than a message.
 */

describe('unwrap', () => {
	it('resolves with the data on success', async () => {
		await expect(unwrap(Promise.resolve({ status: 'ok', data: 42 } as const))).resolves.toBe(42);
	});

	it('resolves with a falsy answer rather than treating it as absent', async () => {
		await expect(unwrap(Promise.resolve({ status: 'ok', data: null } as const))).resolves.toBeNull();
		await expect(unwrap(Promise.resolve({ status: 'ok', data: false } as const))).resolves.toBe(false);
		await expect(unwrap(Promise.resolve({ status: 'ok', data: 0 } as const))).resolves.toBe(0);
	});

	// **Thrown as it arrived.** The core sends a string; `status.fail` is the one place that decides
	// how an error becomes text, and wrapping it here would put a second opinion in front of that.
	it('throws the error exactly as the core sent it', async () => {
		await expect(unwrap(Promise.resolve({ status: 'error', error: 'no such file' } as const))).rejects.toBe(
			'no such file'
		);
	});

	it('lets a rejected call through untouched', async () => {
		const boom = new Error('the webview lost the bridge');
		await expect(unwrap(Promise.reject(boom))).rejects.toBe(boom);
	});
});
