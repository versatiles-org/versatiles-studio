/**
 * Standing in for Tauri, so a component can be rendered in a browser-shaped environment.
 *
 * **One global is the whole seam.** Every generated command, and every plugin Studio uses, bottoms
 * out in `@tauri-apps/api/core`:
 *
 * ```js
 * async function invoke(cmd, args = {}, options) {
 *     return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
 * }
 * ```
 *
 * So replacing that object makes the entire frontend drivable without the desktop shell - which
 * matters because there is no `tauri-driver` for macOS, and the alternative was verifying panes by
 * looking at them.
 *
 * **What this does and does not prove.** A test built on it asserts what the interface does with an
 * answer, never that the core would give that answer. The contract between the two is held by
 * `bindings_are_up_to_date`, which fails the moment a Rust type moves - so a fixture that satisfies
 * the generated TypeScript cannot drift from the real signature. What stays uncovered is the core's
 * behaviour, and that has its own tests.
 */

/** A command name to what it should answer with. Anything unlisted throws, loudly and by name. */
export type Answers = Record<string, unknown | ((args: Record<string, unknown>) => unknown)>;

export interface TauriStub {
	/** Every call made, in order - for asserting that a control reached the core at all. */
	calls: { cmd: string; args: Record<string, unknown> }[];
	/** Adds or replaces an answer mid-test, for the second half of a round trip. */
	answer(cmd: string, value: Answers[string]): void;
	restore(): void;
}

/**
 * Installs the stub for the duration of a test.
 *
 * An unlisted command **throws rather than returning `undefined`**: a component that quietly gets
 * `undefined` from the core renders something plausible and wrong, which is exactly the failure a
 * test is meant to catch rather than reproduce.
 */
export function stubTauri(answers: Answers = {}): TauriStub {
	const table: Answers = { ...answers };
	const calls: TauriStub['calls'] = [];
	const before = (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;

	(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
		invoke(cmd: string, args: Record<string, unknown> = {}) {
			calls.push({ cmd, args });
			if (!(cmd in table)) {
				return Promise.reject(new Error(`no stubbed answer for "${cmd}" - add one to stubTauri()`));
			}
			const answer = table[cmd];
			return Promise.resolve(typeof answer === 'function' ? answer(args) : answer);
		},
		// `listen` and the plugins reach for these; a component that subscribes must not crash.
		transformCallback: (callback: unknown) => callback,
		unregisterCallback: () => {},
		convertFileSrc: (path: string) => path
	};

	return {
		calls,
		answer(cmd, value) {
			table[cmd] = value;
		},
		restore() {
			(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = before;
		}
	};
}
