/**
 * A stand-in for Studio's Rust core, answering the webview's commands from inside the test.
 *
 * **Typed against the generated bindings**, by the camel-case name the webview calls a command by:
 * an answer of the wrong shape, or for a command that was renamed, does not type-check, so this
 * cannot drift from the real core without saying so.
 *
 * **Strict.** A command with no answer is recorded and refused, and `unanswered` is checked after
 * every test - a page that started asking something new fails here rather than half-rendering.
 */

import type { commands } from '../src/lib/ipc/bindings';

type Commands = typeof commands;
type Ok<R> = R extends { status: 'ok'; data: infer T } ? T : R extends { status: 'error' } ? never : R;
type Returned<K extends keyof Commands> = Ok<Awaited<ReturnType<Commands[K]>>>;

/** What a command answers: its value, or a refusal - the error a `Result` command would return. */
export type Answer<K extends keyof Commands> = (
	args: Record<string, unknown>
) => Returned<K> | Refusal | Promise<Returned<K> | Refusal>;
export type Answers = { [K in keyof Commands]?: Answer<K> };

/** The core saying no, as a `Result` command does. Reaches the page as a rejected `invoke`. */
export interface Refusal {
	refused: string;
}
export const refuse = (reason: string): Refusal => ({ refused: reason });

/** Plugin commands the page sends on its own - a window title, an opener - answered with nothing. */
const PLUGINS = /^plugin:(window|webview|opener|dialog|process|updater)\|/;

/** What every page asks at start-up, answered as a fresh install with nothing open would. */
const DEFAULTS: Answers = {
	appVersion: () => '0.7.0',
	importKinds: () => [],
	recentSources: () => [],
	takeOpened: () => [],
	refreshMenu: () => null,
	diagnostics: () => [],
	browsePlaces: () => [{ label: 'Home', path: '/home/anna' }],
	browsing: () => ({ tab: '', folder: null, servers: [] }),
	browseLocal: () => ({ path: '/home/anna', parent: '/home', entries: [] }),
	rememberBrowsing: () => null,
	forgetServer: () => null
};

const snake = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export class FakeCore {
	readonly calls: { command: string; args: Record<string, unknown> }[] = [];
	readonly unanswered: string[] = [];
	/** What the page reported going wrong, through `log_diagnostic` - checked after every test. */
	readonly problems: unknown[] = [];
	readonly #answers = new Map<string, (args: Record<string, unknown>) => unknown>();

	constructor(answers: Answers = {}) {
		const own: Answers = {
			logDiagnostic: ({ report }) => {
				this.problems.push(report);
				return this.problems.length;
			}
		};
		for (const [name, answer] of Object.entries({ ...DEFAULTS, ...own, ...answers })) {
			if (answer) this.#answers.set(snake(name), answer as (args: Record<string, unknown>) => unknown);
		}
	}

	/** How the page's `invoke` reaches this. */
	async handle(command: string, args: Record<string, unknown>): Promise<unknown> {
		this.calls.push({ command, args });
		if (PLUGINS.test(command)) return null;
		const answer = this.#answers.get(command);
		if (!answer) {
			this.unanswered.push(command);
			return refuse(`the fake core has no answer for ${command}`);
		}
		return answer(args);
	}

	/** The arguments of every call to a command, by the name the webview calls it. */
	argsOf(name: keyof Commands): Record<string, unknown>[] {
		return this.calls.filter((call) => call.command === snake(name)).map((call) => call.args);
	}
}
