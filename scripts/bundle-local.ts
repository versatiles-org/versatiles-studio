/**
 * Building an installer on this machine, in one command.
 *
 *   npm run bundle-local [--refresh]
 *
 * `npm run bundle` is the bare `tauri build` that CI and the release workflow drive, each with
 * their own flags. Doing the same thing by hand takes two commands and a flag that is easy to get
 * wrong, so this is that recipe written down.
 *
 * **Why not `bundle:local`.** The convention here is that `npm run x` runs every `x:*` script
 * ([S5.6](../docs/history.md)), and `guards.test.ts` enforces it. Naming this `bundle:local`
 * would make it a member of the `bundle` group and oblige `npm run bundle` to run it - which is
 * exactly what CI must not do. The hyphen says it is its own command, not part of that group.
 *
 * **Two differences from what CI runs**, both because this is for a person rather than a pipeline:
 *
 * * `createUpdaterArtifacts` is off. It is on in `tauri.conf.json` so that a release signs the
 *   updater bundles, which needs `TAURI_SIGNING_PRIVATE_KEY` - a secret that belongs to the release
 *   workflow and not to a laptop. Off, the build wants no key and the artefacts it skips are the
 *   ones only an update would use. This is the same override CI passes, for the same reason.
 * * No `--ci`, so the build stays interactive and prints what it normally prints.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInherited } from './spawn';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** The bundled asset tier (S0.6, Q9), as `fetch-assets.ts` writes it. */
const ASSETS = ['sprites.tar.gz', 'glyphs.tar.gz'];

/**
 * Fetches the asset tier, but only when it is not already there.
 *
 * **`assets:fetch` re-downloads unconditionally**, which is right for CI on a clean runner and
 * wrong here: it would put a network round-trip in front of every local build, and make building
 * offline impossible - in an application whose whole point is that it works offline (G5). Ask for
 * `--refresh` to get the download anyway, which is what a changed `assets/manifest.json` needs.
 */
function ensureAssets(refresh: boolean): string | null {
	const missing = ASSETS.filter((name) => !existsSync(join(ROOT, 'src-tauri', 'resources', name)));
	if (!refresh && missing.length === 0) {
		process.stdout.write('assets: already present\n');
		return null;
	}
	process.stdout.write(refresh ? 'assets: refreshing\n' : `assets: fetching (missing ${missing.join(', ')})\n`);
	return runInherited('npm', ['run', '--silent', 'assets:fetch'], ROOT);
}

function main(): void {
	const flags = process.argv.slice(2);
	const unknown = flags.filter((flag) => flag !== '--refresh');
	if (unknown.length > 0) throw new Error(`unknown option ${unknown.join(', ')} - usage: bundle-local [--refresh]`);

	const assets = ensureAssets(flags.includes('--refresh'));
	if (assets) throw new Error(assets);

	// Passed as one argument rather than interpolated into a command line: the JSON contains quotes
	// and braces, and `cmd.exe` reads both. This is the same override CI uses, for the same reason.
	const problem = runInherited(
		'npm',
		['run', '--silent', 'bundle', '--', '--config', '{"bundle":{"createUpdaterArtifacts":false}}'],
		ROOT
	);
	if (problem) throw new Error(problem);

	// Tauri prints the paths, but a long build scrolls them away.
	process.stdout.write(`\n\x1b[32mbundles are under ${join(ROOT, 'target', 'release', 'bundle')}\x1b[0m\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (error) {
		process.stderr.write(`\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\n`);
		process.exitCode = 1;
	}
}
