/**
 * Fills in the Homebrew cask from a published release (Q10, S5.7).
 *
 *   npm run cask -- v0.2.0        print the cask for that tag
 *   npm run cask -- v0.2.0 --write  update packaging/versatiles-studio.rb in place
 *
 * **The checksums come from GitHub, not from a download.** Every release asset carries a `digest`,
 * so this is metadata-only — the same reason `update-assets.ts` never fetches an archive to pin it.
 * Copying two sha256s by hand is how a cask ends up pointing at a file it cannot verify.
 *
 * **It does not push anything.** The cask lives in `versatiles-org/homebrew-versatiles`, and what
 * this produces is the text to put there. Publishing a release and bumping a tap are two decisions,
 * and neither is a script's to make.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CASK = new URL('../packaging/versatiles-studio.rb', import.meta.url);

/** The repository this reads from. A constant, so no argument can redirect the fetch. */
const REPO = 'versatiles-org/versatiles-studio';

interface GhAsset {
	name: string;
	digest: string | null;
}

/** `v0.2.0` — the shape a release tag takes, and the only thing that may reach the URL below. */
function assertTag(tag: string): void {
	if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) {
		throw new Error(`"${tag}" is not a release tag — expected something like v0.2.0`);
	}
}

async function assetsOf(tag: string): Promise<GhAsset[]> {
	const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
	if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

	const response = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, { headers });
	if (!response.ok) {
		throw new Error(`GitHub returned ${response.status} for ${REPO} ${tag}. Set GITHUB_TOKEN if rate limited.`);
	}
	return ((await response.json()) as { assets: GhAsset[] }).assets;
}

/**
 * The bare sha256 for the one asset whose name ends in `suffix`.
 *
 * Matched on the suffix rather than on the whole filename because Tauri builds the name from the
 * product name and the version — `VersaTiles Studio_0.2.0_aarch64.dmg`, with the space becoming a
 * `.` somewhere between the bundler and the release — and pinning that spelling here would make a
 * rename in `tauri.conf.json` a silent miss rather than a loud one.
 */
export function digestFor(assets: GhAsset[], suffix: string): string {
	const matches = assets.filter((asset) => asset.name.endsWith(suffix));
	if (matches.length === 0) {
		throw new Error(`no release asset ends in ${suffix} — was the ${suffix.split('_').pop()} build skipped?`);
	}
	if (matches.length > 1) {
		throw new Error(`${matches.length} assets end in ${suffix}: ${matches.map((a) => a.name).join(', ')}`);
	}
	const digest = matches[0].digest;
	if (!digest) throw new Error(`${matches[0].name} has no digest — GitHub has not finished processing it`);
	return digest.replace(/^sha256:/, '');
}

/**
 * The cask with its version and both checksums replaced.
 *
 * A rewrite of the file rather than a template with holes, so the copy in the repository stays a
 * valid cask that Homebrew could read — a template full of `{{version}}` cannot be checked by
 * anything, and this one is checked by `brew audit` the moment it lands in the tap.
 */
export function fill(cask: string, version: string, arm: string, intel: string): string {
	const before = cask;
	let out = cask.replace(/^(\s*version )"[^"]*"$/m, `$1"${version}"`);

	// The two `sha256` lines are inside `on_arm` and `on_intel` blocks, in that order, so they are
	// replaced positionally — and the count is asserted, because a silent no-op here produces a cask
	// that installs the previous version's binary under this version's name.
	let seen = 0;
	out = out.replace(/^(\s*sha256 )"[0-9a-f]{64}"$/gm, (_match, indent: string) => {
		seen += 1;
		return `${indent}"${seen === 1 ? arm : intel}"`;
	});

	if (out === before) throw new Error('nothing was replaced — has the cask template changed shape?');
	if (seen !== 2) throw new Error(`expected two sha256 lines in the cask, found ${seen}`);
	return out;
}

async function main(): Promise<void> {
	const [tag, ...rest] = process.argv.slice(2);
	if (!tag) throw new Error('usage: npm run cask -- v0.2.0 [--write]');
	assertTag(tag);

	const assets = await assetsOf(tag);
	const version = tag.slice(1);
	const filled = fill(
		readFileSync(CASK, 'utf8'),
		version,
		digestFor(assets, '_aarch64.dmg'),
		digestFor(assets, '_x64.dmg')
	);

	if (rest.includes('--write')) {
		writeFileSync(CASK, filled);
		process.stdout.write(`  packaging/versatiles-studio.rb → ${version}\n`);
		process.stdout.write('  copy it to versatiles-org/homebrew-versatiles as Casks/versatiles-studio.rb\n');
	} else {
		process.stdout.write(filled);
	}
}

// Not run on import, for the reason `update-assets.ts` gives: the pure helpers above are unit
// tested, and a module that reaches GitHub at import time makes that test need the network.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
