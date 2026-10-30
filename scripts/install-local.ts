/**
 * Building Studio on this Mac and installing it, in one command.
 *
 *   npm run install-local [--refresh]
 *
 * `npm run bundle-local` is the build, and takes the same flag; this is what comes after it.
 *
 * **macOS only, and it says so before building.** A Linux or Windows installer is run rather than
 * copied, and finding that out after a long build would be a poor way to learn it.
 *
 * **The new copy is complete before the old one goes**, so a full disk or a refused write leaves the
 * installed app working. It is written beside its destination because a rename only stays atomic
 * inside one volume.
 */

import { cpSync, existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInherited } from './spawn';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Puts the app at `built` into `applications`, replacing a copy of the same name, and says where. */
export function installApp(built: string, applications: string, name: string): string {
	if (!existsSync(built)) throw new Error(`the build did not produce ${built}`);

	const target = join(applications, name);
	const draft = join(applications, `.${name}.installing`);
	rmSync(draft, { recursive: true, force: true });
	try {
		// `verbatimSymlinks` because a framework inside an app is symlinks into itself, and following
		// them would break its signature.
		cpSync(built, draft, { recursive: true, verbatimSymlinks: true });
		rmSync(target, { recursive: true, force: true });
		renameSync(draft, target);
	} finally {
		rmSync(draft, { recursive: true, force: true });
	}
	return target;
}

function main(): void {
	if (process.platform !== 'darwin') {
		throw new Error('install-local is macOS only - run the installer `npm run bundle-local` builds instead');
	}

	const problem = runInherited('npm', ['run', '--silent', 'bundle-local', '--', ...process.argv.slice(2)], ROOT);
	if (problem) throw new Error(problem);

	const config = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.macos.conf.json'), 'utf8'));
	const name = `${config.productName}.app`;
	const target = installApp(join(ROOT, 'target', 'release', 'bundle', 'macos', name), '/Applications', name);

	// A running copy keeps running from the files it already loaded.
	process.stdout.write(`\n\x1b[32minstalled ${target}\x1b[0m - quit Studio first if it was open\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (error) {
		process.stderr.write(`\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\n`);
		process.exitCode = 1;
	}
}
