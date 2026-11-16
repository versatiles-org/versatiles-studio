/**
 * Opening one of Studio's pages in a browser, with `FakeCore` where the Rust core would be.
 *
 * **What Tauri puts in the page, put there first.** `@tauri-apps/api` reaches the core through
 * `window.__TAURI_INTERNALS__`; this installs the same few functions `@tauri-apps/api/mocks` does -
 * callbacks, the event plugin, window metadata - before the page's own scripts run, and sends every
 * command to the test's `FakeCore` over `page.exposeFunction`. Events stay in the page, so a test
 * can `emit` one as the core would.
 */

import { expect, type Page } from '@playwright/test';
import { FakeCore } from './core';

/** The window labels the core gives its windows (`src-tauri/src/windows.rs`). */
export const LAUNCHER = 'window-launcher';

/** Where screenshots go, for a person - or Claude - to look at. Not compared against anything yet. */
export const SHOTS = 'target/ui-shots';

declare global {
	interface Window {
		__studioCore: (command: string, args: Record<string, unknown>) => Promise<unknown>;
		__studioEmit: (event: string, payload: unknown) => void;
	}
}

function install({ label }: { label: string }): void {
	const callbacks = new Map<number, (data: unknown) => void>();
	const listeners = new Map<string, number[]>();
	let next = 1;

	const transformCallback = (callback?: (data: unknown) => void, once = false) => {
		const id = next++;
		callbacks.set(id, (data) => {
			if (once) callbacks.delete(id);
			callback?.(data);
		});
		return id;
	};
	const runCallback = (id: number, data: unknown) => callbacks.get(id)?.(data);

	async function invoke(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
		if (command === 'plugin:event|listen') {
			const { event, handler } = args as { event: string; handler: number };
			listeners.set(event, [...(listeners.get(event) ?? []), handler]);
			return handler;
		}
		if (command === 'plugin:event|unlisten') {
			const { event, eventId } = args as { event: string; eventId: number };
			listeners.set(
				event,
				(listeners.get(event) ?? []).filter((id) => id !== eventId)
			);
			return null;
		}
		if (command === 'plugin:event|emit' || command === 'plugin:event|emit_to') {
			const { event, payload } = args as { event: string; payload: unknown };
			window.__studioEmit(event, payload);
			return null;
		}
		const answer = await window.__studioCore(command, args);
		// A refusal is what a `Result` command's error is: a rejection carrying the reason.
		if (answer && typeof answer === 'object' && 'refused' in answer) throw (answer as { refused: string }).refused;
		return answer;
	}

	window.__studioEmit = (event, payload) => {
		for (const id of listeners.get(event) ?? []) runCallback(id, { event, id, payload });
	};

	Object.assign(window, {
		__TAURI_INTERNALS__: {
			invoke,
			transformCallback,
			unregisterCallback: (id: number) => callbacks.delete(id),
			runCallback,
			callbacks,
			convertFileSrc: (path: string, protocol = 'asset') => `${protocol}://localhost/${encodeURIComponent(path)}`,
			metadata: { currentWindow: { label }, currentWebview: { windowLabel: label, label } },
			plugins: { path: { sep: '/', delimiter: ':' } }
		},
		__TAURI_EVENT_PLUGIN_INTERNALS__: {
			unregisterListener: (_event: string, id: number) => callbacks.delete(id)
		}
	});
}

/** Opens a page of Studio's, answered by `core`. */
export async function open(page: Page, path: '/landing.html' | '/', label: string, core: FakeCore): Promise<void> {
	await page.exposeFunction('__studioCore', (command: string, args: Record<string, unknown>) =>
		core.handle(command, args ?? {})
	);
	await page.addInitScript(install, { label });
	await page.goto(path);
}

/** Opens the launcher, and waits until it has asked the core what it can open. */
export async function openLauncher(page: Page, core = new FakeCore()): Promise<FakeCore> {
	await open(page, '/landing.html', LAUNCHER, core);
	await expect(page.getByRole('heading', { name: 'VersaTiles Studio' })).toBeVisible();
	return core;
}

/** An event, as the core would send it to this window. */
export async function emit(page: Page, event: string, payload: unknown): Promise<void> {
	await page.evaluate(([name, data]) => window.__studioEmit(name as string, data), [event, payload]);
}

/** The test failed if the page asked anything the fake core could not answer, or reported a problem. */
export function expectAllAnswered(core: FakeCore): void {
	expect(core.unanswered, 'commands the fake core has no answer for - add them to ui/core.ts').toEqual([]);
	expect(core.problems, 'problems the page reported').toEqual([]);
}
