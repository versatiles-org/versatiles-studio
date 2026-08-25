/**
 * Starting a child process, the same way from every script and on every platform.
 *
 * Two facts live here because both scripts need them and getting either wrong fails only on
 * Windows, where nobody runs these by hand:
 *
 * **`npm` needs a shell on Windows and `git` must not have one.** There is no `npm` executable
 * there - it is `npm.cmd`, and Node has refused to execute a `.bat` or `.cmd` without `shell: true`
 * since the fix for CVE-2024-27980. `git`, meanwhile, is a real `.exe`: handing it a shell would
 * put its arguments through `cmd.exe`, which reads the parentheses in a commit message like
 * `chore(release): v0.1.0` as grouping. So the shell is decided per command, not per platform.
 *
 * **A spawn that never started must say so.** `spawnSync` reports that case in `error` and leaves
 * `status` as `null`, so code testing only `status !== 0` records a failure with no reason -
 * "1 failed: build:worker" and nothing else, which is precisely how the Windows bundle failed twice
 * in a row without saying why.
 */

import { spawnSync } from 'node:child_process';

/** Commands that are a `.cmd` shim on Windows rather than an executable. */
const SHIMMED = ['npm', 'npx', 'node-gyp'];

export function needsShell(command: string): boolean {
	return process.platform === 'win32' && SHIMMED.includes(command);
}

/**
 * Runs a command with its output inherited, and returns what went wrong - or `null` if nothing did.
 *
 * A string rather than a throw, because the two callers want different things from a failure: the
 * script runner collects the names and keeps going, the release script stops.
 */
export function runInherited(command: string, args: string[], cwd: string): string | null {
	const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: needsShell(command) });

	if (result.error) return `${command} could not start: ${result.error.message}`;
	if (result.signal) return `${command} was killed by ${result.signal}`;
	if (result.status !== 0) return `${command} ${args.join(' ')} exited with ${result.status}`;
	return null;
}
