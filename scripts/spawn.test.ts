import { afterEach, describe, expect, it, vi } from 'vitest';
import { needsShell, runInherited } from './spawn';

/**
 * The Windows rules, tested from macOS and Linux - which is the whole point.
 *
 * Both of these failed only on a Windows runner, and cost two CI rounds each because the failure
 * printed nothing. `process.platform` is stubbed so the rule can be asserted anywhere.
 */
function on(platform: string, body: () => void) {
	const real = Object.getOwnPropertyDescriptor(process, 'platform');
	Object.defineProperty(process, 'platform', { value: platform, configurable: true });
	try {
		body();
	} finally {
		if (real) Object.defineProperty(process, 'platform', real);
	}
}

afterEach(() => vi.restoreAllMocks());

describe('which commands need a shell', () => {
	it('gives one to npm on Windows, because npm there is npm.cmd', () => {
		// Node has refused to execute a .cmd without `shell: true` since CVE-2024-27980, and there
		// is no extensionless `npm` to fall back to - so this is the difference between the bundle
		// building and `beforeBuildCommand` dying before a single Rust file compiles.
		on('win32', () => expect(needsShell('npm')).toBe(true));
	});

	it('withholds one from git, even on Windows', () => {
		// `git` is a real .exe. A shell would put its arguments through cmd.exe, which reads the
		// parentheses in `chore(release): v0.1.0` as grouping and mangles the commit message.
		on('win32', () => expect(needsShell('git')).toBe(false));
	});

	it('gives one to nobody anywhere else', () => {
		for (const platform of ['darwin', 'linux']) {
			on(platform, () => {
				for (const command of ['npm', 'npx', 'git', 'gh', 'cargo']) {
					expect(needsShell(command), `${command} on ${platform}`).toBe(false);
				}
			});
		}
	});
});

describe('reporting what went wrong', () => {
	it('says so when the command does not exist, rather than nothing at all', () => {
		// The failure that started this: `status` is null when the spawn never happened, so testing
		// only `status !== 0` reported "1 failed: build:worker" with no reason.
		const problem = runInherited('a-command-that-is-not-installed-anywhere', [], process.cwd());
		expect(problem).toBeTruthy();
		expect(problem).toContain('could not start');
	});

	it('says which command and which exit code, when it ran and refused', () => {
		const problem = runInherited(process.execPath, ['-e', 'process.exit(3)'], process.cwd());
		expect(problem).toContain('exited with 3');
	});

	it('says nothing when it worked', () => {
		expect(runInherited(process.execPath, ['-e', ''], process.cwd())).toBeNull();
	});
});
