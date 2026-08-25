/**
 * What every story needs, and nothing a story is about.
 *
 * The helpers here are all plain WebDriver - see [the plan](../docs/scope-e2e.md) for why Studio
 * does not use the service's `browser.tauri.*` API.
 */

import { browser } from '@wdio/globals';
import type { ChainablePromiseElement } from 'webdriverio';
import { resolve } from 'node:path';

/** A pipeline that draws its own tiles, so a story can open something real on a bare machine. */
export const FIXTURE = resolve(import.meta.dirname, 'fixtures/debug.vpl');

/** The label the launcher window always has, and therefore its WebDriver handle. */
export const LAUNCHER = 'window-launcher';

type Internals = { __TAURI_INTERNALS__: { invoke(command: string, args?: unknown): Promise<unknown> } };

/**
 * Calls a Studio command over the same bridge the webview uses, from the focused window.
 *
 * **For what a story is not about.** Driving the UI is the point; this is for the state a story
 * needs to exist before it starts, and for the results of native dialogs, which WebDriver cannot
 * see - a file picker is a window of the operating system, not of the application.
 */
export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
	return browser.execute(
		async (name: string, payload: Record<string, unknown>) =>
			(await (window as unknown as Internals).__TAURI_INTERNALS__.invoke(name, payload)) as never,
		command,
		args
	);
}

/**
 * Starts a command and does not wait for it.
 *
 * For the commands that close the window that called them: awaiting the reply means awaiting it in
 * a window that no longer exists, and WebDriver reports that as `no such window` - which looks
 * nothing like what happened. The call is deferred past this script's own reply, and what the story
 * then waits for is the window, not the command.
 */
export function fire(command: string, args: Record<string, unknown> = {}): Promise<void> {
	return browser.execute(
		(name: string, payload: Record<string, unknown>) => {
			setTimeout(() => {
				void (window as unknown as Internals).__TAURI_INTERNALS__.invoke(name, payload);
			}, 50);
		},
		command,
		args
	);
}

/** Waits for a window with this label and switches to it. */
export async function switchTo(label: string): Promise<void> {
	await browser.waitUntil(async () => (await browser.getWindowHandles()).includes(label), {
		timeout: 20_000,
		timeoutMsg: `no window labelled ${label}`
	});
	await browser.switchToWindow(label);
}

/** Waits for a window carrying this label to be gone. */
export async function waitForGone(label: string): Promise<void> {
	await browser.waitUntil(async () => !(await browser.getWindowHandles()).includes(label), {
		timeout: 20_000,
		timeoutMsg: `the ${label} window stayed open`
	});
}

/**
 * Opens the fixture and leaves the story in the project window it made.
 *
 * **Every spec starts at the launcher**, because that is the window the driver attaches to - see
 * `wdio.conf.ts`. This is the two gestures that get from there to a workbench, and it stands in for
 * the file picker, which is a window of the operating system and invisible to WebDriver.
 */
export async function openProject(): Promise<void> {
	await switchTo(LAUNCHER);
	await fire('open_in_new_window', { source: FIXTURE });
	await waitForGone(LAUNCHER);
	await switchTo((await browser.getWindowHandles())[0]);
	await browser.$('.maplibregl-canvas').waitForExist({ timeout: 30_000, timeoutMsg: 'the map never appeared' });
}

/**
 * Picks a value in a `<select>`.
 *
 * **Because the driver cannot.** `selectByAttribute`, a click on the `<option>` and arrow keys all
 * leave the element on its old value under this WebView - verified, not assumed - and none of them
 * fails, so a story that used them would pass while changing nothing. What is dispatched here is the
 * event the browser would have sent, so everything above the DOM still runs: the component's
 * handler, the command, the core, and the re-render.
 *
 * The limit is honest: this cannot tell that a control is reachable or enabled. Assert that
 * separately, which is why the stories check the select is displayed before using it.
 */
export async function choose(select: ChainablePromiseElement, value: string): Promise<void> {
	await browser.execute(
		(element: HTMLElement, next: string) => {
			(element as HTMLSelectElement).value = next;
			element.dispatchEvent(new Event('change', { bubbles: true }));
		},
		await select,
		value
	);
}

/**
 * Opens a pane by name, and leaves it open whether or not it already was.
 *
 * **Not a click.** Which panes are open is remembered app-wide, so a spec that toggles blindly
 * depends on what the spec before it left behind - which is how this suite first passed one file at
 * a time and failed as a whole.
 */
export async function openPane(title: string): Promise<void> {
	const heading = browser.$(`button*=${title}`);
	await heading.waitForDisplayed({ timeout: 20_000, timeoutMsg: `no ${title} pane` });
	if ((await heading.getAttribute('aria-expanded')) !== 'true') await heading.click();
	await browser.waitUntil(async () => (await heading.getAttribute('aria-expanded')) === 'true', {
		timeout: 10_000,
		timeoutMsg: `the ${title} pane would not open`
	});
}
