/**
 * The manifest the auto-updater reads (G4, S5.8).
 *
 *   node --experimental-strip-types scripts/latest-json.ts <dir> <version> > latest.json
 *
 * **Built from what was produced, not from a template.** A platform whose build failed is simply
 * absent from the result — an updater that offers a download that is not there is worse than one
 * that offers nothing, because the failure lands on the user rather than in the run that caused it.
 *
 * **The signature is the point.** Each entry pairs a URL with the minisign signature Tauri emitted
 * beside the bundle; the app verifies it against the public key compiled into it before replacing
 * anything, so a compromised release page cannot install anything we did not sign.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the release assets will be. Tauri fetches by URL, not by asset id. */
const BASE = 'https://github.com/versatiles-org/versatiles-studio/releases/download';

/**
 * The platforms a release serves, and the file each looks for.
 *
 * **A lookup, not a guess about architecture spellings.** The release workflow renames each updater
 * artefact to its platform key, because Tauri names the macOS one `VersaTiles Studio.app.tar.gz` —
 * no version and no architecture — so both Mac builds produce the same filename. Matching on
 * `aarch64` or `x64` inside a name that contains neither is how this silently emitted a manifest
 * with no macOS entries at all.
 *
 * macOS updates ship as a `.app.tar.gz`, Linux as an `.AppImage.tar.gz`. The `.deb` is an install
 * format and not an update one, which is why it is not here although the release carries it.
 */
const PLATFORMS: { key: string; file: string }[] = [
	{ key: 'darwin-aarch64', file: 'darwin-aarch64.app.tar.gz' },
	{ key: 'darwin-x86_64', file: 'darwin-x86_64.app.tar.gz' },
	{ key: 'linux-x86_64', file: 'linux-x86_64.AppImage.tar.gz' },
	{ key: 'linux-aarch64', file: 'linux-aarch64.AppImage.tar.gz' }
];

interface Entry {
	signature: string;
	url: string;
}

/**
 * The `platforms` map for these filenames.
 *
 * Exported for the tests: getting a platform key wrong produces an updater that silently never finds
 * an update, which is indistinguishable from being up to date.
 */
export function platformsFor(names: string[], version: string, read: (name: string) => string): Record<string, Entry> {
	const platforms: Record<string, Entry> = {};

	for (const { key, file } of PLATFORMS) {
		if (!names.includes(file)) continue;

		const signature = `${file}.sig`;
		if (!names.includes(signature)) {
			// Unsigned means the secret was missing from the run. Publishing the entry anyway would
			// produce an update every installed copy downloads and then refuses.
			throw new Error(`${file} has no ${signature} — was TAURI_SIGNING_PRIVATE_KEY set?`);
		}

		platforms[key] = {
			signature: read(signature).trim(),
			url: `${BASE}/v${version}/${encodeURIComponent(file)}`
		};
	}

	// **Nothing may be left over.** A `.tar.gz` that no platform claimed is a build whose artefact
	// was named something this does not expect — and the failure mode without this is the quiet one:
	// the platform is simply absent from the manifest, and those users never see an update again.
	const claimed = new Set(PLATFORMS.flatMap(({ file }) => [file, `${file}.sig`]));
	const orphans = names.filter((name) => name.endsWith('.tar.gz') && !claimed.has(name));
	if (orphans.length > 0) {
		throw new Error(`updater artefacts no platform claims: ${orphans.join(', ')}`);
	}

	return platforms;
}

function main(): void {
	const [dir, version] = process.argv.slice(2);
	if (!dir || !version) {
		throw new Error('usage: latest-json.ts <dir> <version>');
	}

	const names = readdirSync(dir);
	const platforms = platformsFor(names, version, (name) => readFileSync(join(dir, name), 'utf8'));

	if (Object.keys(platforms).length === 0) {
		throw new Error(`no updater bundles in ${dir} — found: ${names.join(', ')}`);
	}

	process.stdout.write(
		`${JSON.stringify(
			{
				version,
				// Read from the release notes on GitHub rather than duplicated here: the updater shows
				// this text, and two places to write it is one place to forget.
				notes: `See https://github.com/versatiles-org/versatiles-studio/releases/tag/v${version}`,
				pub_date: new Date().toISOString(),
				platforms
			},
			null,
			'\t'
		)}\n`
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
