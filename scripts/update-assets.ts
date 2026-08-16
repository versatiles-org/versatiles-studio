/**
 * Checks or updates the pinned versions in `assets/manifest.json`.
 *
 * Q9 requires the map assets to be pinned per family with a checksum, rather than fetched as
 * "latest" — so this is the tool that moves a pin deliberately instead of by accident.
 *
 * GitHub returns a `digest` on every release asset, so both modes are metadata-only: nothing is
 * downloaded, even though the font archives total ~190 MB.
 *
 *   npm run assets:check    exit 1 if a newer release exists, or if a pinned digest has changed
 *   npm run assets:update   rewrite the manifest at the newest release of each source
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const MANIFEST = fileURLToPath(new URL('../assets/manifest.json', import.meta.url));

interface PinnedAsset {
	/** Release asset filename. */
	file: string;
	/** `sha256:…`, taken verbatim from the GitHub release asset digest. */
	digest: string;
	bytes: number;
}

interface Source {
	repo: string;
	/** Release tag, e.g. `v5.13.1`. Never "latest" — that is the whole point (Q9). */
	version: string;
	/** Why this source is pinned at all. */
	purpose: string;
	assets: Record<string, PinnedAsset>;
}

type Manifest = { $comment: string; sources: Record<string, Source> };

interface GhAsset {
	name: string;
	size: number;
	digest: string | null;
}

async function latestRelease(repo: string): Promise<{ tag: string; assets: GhAsset[] }> {
	const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
	// Optional: lifts the 60/hour unauthenticated rate limit in CI.
	if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

	const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
	if (!response.ok) {
		throw new Error(`GitHub returned ${response.status} for ${repo}. Set GITHUB_TOKEN if rate limited.`);
	}
	const body = (await response.json()) as { tag_name: string; assets: GhAsset[] };
	return { tag: body.tag_name, assets: body.assets };
}

function digestOf(assets: GhAsset[], file: string, repo: string): { digest: string; bytes: number } {
	const asset = assets.find((a) => a.name === file);
	if (!asset) throw new Error(`${repo} has no asset named ${file}`);
	if (!asset.digest) throw new Error(`${repo}/${file} has no digest — pin it by hand`);
	return { digest: asset.digest, bytes: asset.size };
}

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8')) as Manifest;
const update = process.argv.includes('--update');
const problems: string[] = [];

for (const [name, source] of Object.entries(manifest.sources)) {
	const { tag, assets } = await latestRelease(source.repo);

	if (tag !== source.version) {
		problems.push(`${name}: pinned ${source.version}, upstream is ${tag}`);
		if (update) source.version = tag;
	}

	// Re-resolve every asset. A digest that moved under an unchanged tag means the release was
	// re-uploaded, which is worth failing loudly over rather than silently trusting.
	for (const [key, pinned] of Object.entries(source.assets)) {
		if (tag !== source.version && !update) continue;
		const fresh = digestOf(assets, pinned.file, source.repo);
		if (fresh.digest !== pinned.digest) {
			if (update) {
				pinned.digest = fresh.digest;
				pinned.bytes = fresh.bytes;
			} else if (tag === source.version) {
				problems.push(`${name}.${key}: digest changed under the same tag ${tag} — release was re-uploaded`);
			}
		}
	}
}

if (update) {
	await writeFile(MANIFEST, `${JSON.stringify(manifest, null, '\t')}\n`);
	console.log(problems.length ? `Updated:\n  ${problems.join('\n  ')}` : 'Already current — nothing changed.');
} else if (problems.length) {
	console.error(`Pins are out of date:\n  ${problems.join('\n  ')}\n\nRun \`npm run assets:update\` to move them.`);
	process.exit(1);
} else {
	console.log('All pins current.');
}
