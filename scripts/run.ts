/**
 * Runs every `{action}:{context}` script for one action.
 *
 *   tsx scripts/run.ts check                every check:* script, in order
 *   tsx scripts/run.ts check --keep-going   all of them, even after one fails
 *
 * **So the list cannot drift.** `check` used to name its five members by hand, which meant adding a
 * sixth and forgetting to list it produced a check that silently never ran — the worst kind, because
 * the green tick still appears. Here the group *is* whatever is named `check:…`, and
 * `guards.test.ts` holds the convention up.
 *
 * **Declaration order is the contract.** The scripts run in the order `package.json` lists them,
 * which is how `check` stays cheapest-first: a formatting slip should not cost a Rust compile to
 * discover.
 *
 * A dependency (`npm-run-all` and friends) would do this too. Twenty lines that this repository can
 * test, in the same shape as the rest of `scripts/`, is the cheaper answer.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url).pathname;

/**
 * The scripts belonging to `action`, in declaration order.
 *
 * **Direct children only.** The tree is two deep where two toolchains differ — `check:lint` covers
 * `check:lint:web` and `check:lint:rust` — and matching every descendant would make `check` run the
 * leaves once through their parent and once on its own.
 *
 * Exported for the tests: an action that silently matches nothing would report success having done
 * nothing at all.
 */
export function membersOf(scripts: Record<string, string>, action: string): string[] {
	const prefix = `${action}:`;
	return Object.keys(scripts).filter((name) => name.startsWith(prefix) && !name.slice(prefix.length).includes(':'));
}

function main(): void {
	const [action, ...flags] = process.argv.slice(2);
	if (!action) throw new Error('usage: run.ts <action> [--keep-going]');
	const keepGoing = flags.includes('--keep-going');

	const scripts = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')).scripts as Record<string, string>;
	const members = membersOf(scripts, action);
	if (members.length === 0) throw new Error(`no ${action}:* scripts in package.json`);

	const failed: string[] = [];
	for (const name of members) {
		process.stdout.write(`\n\x1b[1m▸ ${name}\x1b[0m\n`);
		const result = spawnSync('npm', ['run', '--silent', name], { cwd: ROOT, stdio: 'inherit', shell: false });
		if (result.status !== 0) {
			failed.push(name);
			if (!keepGoing) break;
		}
	}

	if (failed.length > 0) {
		// Named at the end as well as where it happened: `check` scrolls past a lot of output, and
		// "which one was it" should not need scrolling back.
		process.stderr.write(`\n\x1b[31m${failed.length} failed: ${failed.join(', ')}\x1b[0m\n`);
		process.exitCode = 1;
		return;
	}
	process.stdout.write(`\n\x1b[32m${members.length} passed: ${members.join(', ')}\x1b[0m\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
