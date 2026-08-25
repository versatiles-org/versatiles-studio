/**
 * Which command failed, kept with the failure.
 *
 * The value is small and the risk is not: this sits between every command and every `catch` in the
 * application, so the cases below are mostly about what it must leave *alone*.
 */

import { describe, expect, it, vi } from 'vitest';
import { CommandFailed, namingFailures } from './failure';
import { unwrap } from './unwrap';

const ok = (data: unknown) => Promise.resolve({ status: 'ok', data } as const);
const bad = (error: unknown) => Promise.resolve({ status: 'error', error } as const);

describe('naming the command that failed', () => {
	it('names it, and says nothing different to a person', async () => {
		const commands = namingFailures({ saveProject: () => bad('no such file') });

		await expect(unwrap(commands.saveProject())).rejects.toThrow(CommandFailed);
		const caught = (await unwrap(commands.saveProject()).catch((error: unknown) => error)) as CommandFailed;
		expect(caught.command).toBe('saveProject');
		// The status bar shows `message`, and it has to read exactly as it did before this existed.
		expect(caught.message).toBe('no such file');
		expect(caught.cause).toBe('no such file');
	});

	it('leaves a successful answer exactly as it was', async () => {
		const commands = namingFailures({ graphs: () => ok([{ id: 1 }]) });
		await expect(unwrap(commands.graphs())).resolves.toEqual([{ id: 1 }]);
	});

	/** Several generated functions answer with a plain value rather than an outcome. */
	it('leaves an answer that is not an outcome alone', async () => {
		const commands = namingFailures({
			appVersion: () => Promise.resolve('0.2.0'),
			writableFormats: () => Promise.resolve(['mbtiles'])
		});
		await expect(commands.appVersion()).resolves.toBe('0.2.0');
		await expect(commands.writableFormats()).resolves.toEqual(['mbtiles']);
	});

	it('lets a rejection through untouched — a lost bridge is not a command failing', async () => {
		const lost = new Error('the webview lost the bridge');
		const commands = namingFailures({ graphs: () => Promise.reject(lost) });
		await expect(unwrap(commands.graphs())).rejects.toBe(lost);
	});

	it('passes the arguments through, and calls the real thing once', async () => {
		const setGraph = vi.fn((_graph: number, _text: string) => ok(null));
		const commands = namingFailures({ setGraph });
		await unwrap(commands.setGraph(3, 'from_container filename="x"'));
		expect(setGraph).toHaveBeenCalledTimes(1);
		expect(setGraph).toHaveBeenCalledWith(3, 'from_container filename="x"');
	});

	it('carries an object error through as its message, the way the bar read it', async () => {
		// The core sends strings today. This is what stops that assumption from becoming a silent
		// `[object Object]` the day one command sends something richer.
		const commands = namingFailures({ vplParse: () => bad({ message: 'unexpected token', span: [4, 9] }) });
		const caught = (await unwrap(commands.vplParse()).catch((error: unknown) => error)) as CommandFailed;
		expect(caught.message).toBe('unexpected token');
		expect(caught.cause).toEqual({ message: 'unexpected token', span: [4, 9] });
	});
});
