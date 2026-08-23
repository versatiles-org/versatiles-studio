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
 * The platforms a release serves, and the end of the filename that identifies each.
 *
 * **Matched on a suffix, and the two halves are asymmetric for a reason.**
 *
 * macOS emits `VersaTiles Studio.app.tar.gz` — no version and no architecture — so both Mac builds
 * produce one filename, and the release workflow renames each to its platform key. Those suffixes
 * are therefore whole names.
 *
 * Linux has no `.AppImage.tar.gz` at all: Tauri signs the AppImage itself, so the file the updater
 * downloads is the same one a person downloads, under the name Tauri gave it — which already carries
 * the architecture. Those suffixes are the tail of that name.
 *
 * Both were read off a real release run rather than from the documentation, which describes neither.
 */
const PLATFORMS: { key: string; suffixes: string[] }[] = [
	{ key: 'darwin-aarch64', suffixes: ['darwin-aarch64.app.tar.gz'] },
	{ key: 'darwin-x86_64', suffixes: ['darwin-x86_64.app.tar.gz'] },
	{ key: 'linux-x86_64', suffixes: ['_amd64.AppImage'] },
	{ key: 'linux-aarch64', suffixes: ['_aarch64.AppImage'] },
	// **Two candidates each, and that is not indecision.** The updater's own documentation says
	// Windows ships a `.zip` of the installer — the same documentation says Linux ships an
	// `.AppImage.tar.gz`, and Linux ships a bare `.AppImage`. Rather than spend a release finding
	// out, both spellings are accepted; the first that appears wins, and the guard below still
	// refuses anything left over. Narrow this once a real Windows release has been seen.
	{ key: 'windows-x86_64', suffixes: ['_x64-setup.exe.zip', '_x64-setup.exe'] },
	{ key: 'windows-aarch64', suffixes: ['_arm64-setup.exe.zip', '_arm64-setup.exe'] }
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
	const claimed = new Set<string>();

	for (const { key, suffixes } of PLATFORMS) {
		// The first spelling that turns up. A platform that produced nothing matches none of them.
		const suffix = suffixes.find((candidate) => names.some((name) => name.endsWith(candidate)));
		if (!suffix) continue;

		const found = names.filter((name) => name.endsWith(suffix));
		if (found.length > 1) throw new Error(`${found.length} files end in ${suffix}: ${found.join(', ')}`);

		const bundle = found[0];
		const signature = `${bundle}.sig`;
		if (!names.includes(signature)) {
			// Unsigned means the secret was missing from the run. Publishing the entry anyway would
			// produce an update every installed copy downloads and then refuses.
			throw new Error(`${bundle} has no ${signature} — was TAURI_SIGNING_PRIVATE_KEY set?`);
		}
		// **A name GitHub would rewrite must never reach the manifest.** It turns a space into a
		// dot on upload, so the asset ends up called something else and the URL here 404s — silently,
		// for every user of that platform. The release workflow renames them; this is what notices
		// if it ever stops.
		if (/[^A-Za-z0-9._-]/.test(bundle)) {
			throw new Error(`${bundle} has characters GitHub rewrites in an asset name — rename it before upload`);
		}
		claimed.add(bundle);
		claimed.add(signature);

		platforms[key] = {
			signature: read(signature).trim(),
			url: `${BASE}/v${version}/${encodeURIComponent(bundle)}`
		};
	}

	// **No signature may be left over.** A `.sig` no platform claimed means an updater artefact was
	// named something this does not expect — and without this the failure is the quiet one: the
	// platform is simply absent from the manifest, and those users never see an update again. That
	// is exactly how the macOS entries went missing.
	const orphans = names.filter((name) => name.endsWith('.sig') && !claimed.has(name));
	if (orphans.length > 0) {
		throw new Error(`signed artefacts no platform claims: ${orphans.join(', ')}`);
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
