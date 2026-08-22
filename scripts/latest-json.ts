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
 * The platform keys Tauri's updater looks for, and how to recognise the bundle for each.
 *
 * `platform-arch`, with the arch spelled Rust's way. The suffixes are what the bundler produces:
 * macOS updates ship as a `.app.tar.gz`, Linux as an `.AppImage.tar.gz` — the `.deb` is an install
 * format and not an update one, which is why it is not listed here even though the release carries
 * it.
 */
const PLATFORMS: { key: string; matches: (name: string) => boolean }[] = [
	{
		key: 'darwin-aarch64',
		matches: (name) => name.endsWith('.app.tar.gz') && name.includes('aarch64')
	},
	{
		key: 'darwin-x86_64',
		// Tauri writes `x64` in a bundle name and the updater key says `x86_64`; matching on the
		// name's spelling and emitting the key's is the whole of the translation.
		matches: (name) => name.endsWith('.app.tar.gz') && name.includes('x64')
	},
	{
		key: 'linux-x86_64',
		matches: (name) => name.endsWith('.AppImage.tar.gz')
	}
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

	for (const { key, matches } of PLATFORMS) {
		const bundles = names.filter(matches);
		if (bundles.length === 0) continue;
		if (bundles.length > 1) {
			throw new Error(`${bundles.length} bundles match ${key}: ${bundles.join(', ')}`);
		}

		const bundle = bundles[0];
		const signature = `${bundle}.sig`;
		if (!names.includes(signature)) {
			// Unsigned means the secret was missing from the run. Publishing the entry anyway would
			// produce an update every installed copy downloads and then refuses.
			throw new Error(`${bundle} has no ${signature} — was TAURI_SIGNING_PRIVATE_KEY set?`);
		}

		platforms[key] = {
			signature: read(signature).trim(),
			url: `${BASE}/v${version}/${encodeURIComponent(bundle)}`
		};
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
