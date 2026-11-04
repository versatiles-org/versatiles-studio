/**
 * Compiles macOS 26's app icon, `src-tauri/icons/Icon.icon`, into the `Assets.car` the bundle ships.
 *
 *   npm run compile-icon
 *
 * Run it after changing anything in `Icon.icon` (Icon Composer edits it in place), and commit both.
 * Needs Xcode 26 or later.
 *
 * **Compiled here and committed, not left to `tauri build`.** The bundler can compile an `.icon`
 * itself, and on this project it crashes doing so: actool fails with "attempt to insert nil object
 * from objects[0]" under the bundler, while the identical call succeeds from a shell
 * ([tauri-apps/tauri#15315]). Given a ready `Assets.car`, the bundler only copies it - which also
 * means the release runners need neither actool nor Xcode 26.
 *
 * **Listed in `tauri.macos.conf.json` only, after `icon.icns`.** The shared `tauri.conf.json` would
 * hand it to the Linux and Windows bundlers too, which have no use for it. And the bundler stops at
 * the first `.icns` it finds, which macOS before 26 shows instead.
 *
 * **One retry after restarting `ibtoold`**, actool's helper. It outlives the call that started it, and
 * one left in a bad state fails every compile after it the same way; a fresh one does not.
 *
 * [tauri-apps/tauri#15315]: https://github.com/tauri-apps/tauri/issues/15315
 */

import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInherited } from './spawn';

const ICONS = fileURLToPath(new URL('../src-tauri/icons/', import.meta.url));

/** What `tauri-bundler` passes, so the result is the one it would have made. */
function actoolArgs(icon: string, out: string): string[] {
	return [
		icon,
		...['--compile', out, '--output-format', 'human-readable-text', '--notices', '--warnings'],
		...['--output-partial-info-plist', join(out, 'assetcatalog_generated_info.plist')],
		...['--app-icon', 'Icon', '--include-all-app-icons', '--accent-color', 'AccentColor'],
		...['--enable-on-demand-resources', 'NO', '--development-region', 'en', '--target-device', 'mac'],
		...['--minimum-deployment-target', '26.0', '--platform', 'macosx']
	];
}

function main(): void {
	if (process.platform !== 'darwin') throw new Error('compiling an Icon Composer icon needs macOS and Xcode 26');

	const out = mkdtempSync(join(tmpdir(), 'studio-icon-'));
	try {
		const args = actoolArgs(join(ICONS, 'Icon.icon'), out);
		let problem = runInherited('xcrun', ['actool', ...args], ICONS);
		if (problem) {
			process.stdout.write('actool failed; restarting ibtoold and trying once more\n');
			runInherited('killall', ['ibtoold'], ICONS);
			problem = runInherited('xcrun', ['actool', ...args], ICONS);
		}
		if (problem) throw new Error(problem);

		const car = join(out, 'Assets.car');
		if (!existsSync(car)) throw new Error('actool reported no error and wrote no Assets.car');
		copyFileSync(car, join(ICONS, 'Assets.car'));
		process.stdout.write('wrote src-tauri/icons/Assets.car\n');
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
}

main();
