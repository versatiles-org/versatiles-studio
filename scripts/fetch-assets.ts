/**
 * Materialises the bundled asset tier into `src-tauri/resources/` (S0.6).
 *
 * Two archives ship inside the installer, per Q9:
 *   sprites.tar.gz  - the sprite sheet, used verbatim
 *   glyphs.tar.gz   - repacked from frontend-tiny's `assets/glyphs`, the Latin-only subset
 *
 * They are **archives, not directories**. Q9 is emphatic: the embedded server reads `.tar.gz`
 * directly, so 47,360 loose files never touch the disk and each asset stays atomic to verify and
 * replace. Repacking only changes what is inside the archive, never that it is one.
 *
 * Outputs are gitignored - the manifest plus digests make them reproducible, so there is no reason
 * to keep binaries in the repository.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assertSafeSegment, resolveRepo } from './update-assets.js';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const resources = join(root, 'src-tauri', 'resources');

interface PinnedAsset {
	file: string;
	digest: string;
	bytes: number;
}
interface Source {
	repo: string;
	version: string;
	assets: Record<string, PinnedAsset>;
}
type Manifest = { sources: Record<string, Source> };

const manifest = JSON.parse(await readFile(join(root, 'assets', 'manifest.json'), 'utf8')) as Manifest;

/**
 * Builds the release URL from values this file controls.
 *
 * `resolveRepo` returns an allow-listed **constant**, so the host and repository never come from the
 * manifest. The remaining segments are validated and then percent-encoded, so a tag or filename
 * cannot add path segments or a query. Without this a tampered `assets/manifest.json` in a pull
 * request would make CI issue arbitrary outbound requests - the digest check afterwards would stop a
 * bad file being *used*, but not the request being *made*.
 */
function urlFor(source: Source, asset: PinnedAsset): string {
	const repo = resolveRepo(source.repo);
	assertSafeSegment(source.version, 'version');
	assertSafeSegment(asset.file, 'asset filename');

	const version = encodeURIComponent(source.version);
	const file = encodeURIComponent(asset.file);
	return `https://github.com/${repo}/releases/download/${version}/${file}`;
}

/** Downloads and checks the pin. A mismatch is fatal: an unverified asset is worse than none. */
async function download(source: Source, asset: PinnedAsset): Promise<Buffer> {
	const url = urlFor(source, asset);
	process.stdout.write(`  fetching ${asset.file} … `);

	const response = await fetch(url);
	if (!response.ok) throw new Error(`${response.status} for ${url}`);
	const bytes = Buffer.from(await response.arrayBuffer());

	const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
	if (actual !== asset.digest) {
		throw new Error(`digest mismatch for ${asset.file}\n  pinned ${asset.digest}\n  actual ${actual}`);
	}
	process.stdout.write(`${Math.round(bytes.length / 1024)} KB, digest ok\n`);
	return bytes;
}

await mkdir(resources, { recursive: true });

// --- sprites: used exactly as published -------------------------------------------------------
const spriteSource = manifest.sources.sprites;
const spriteAsset = spriteSource.assets.sprites;
await writeFile(join(resources, 'sprites.tar.gz'), await download(spriteSource, spriteAsset));

// --- glyphs: repack only `assets/glyphs` out of frontend-tiny ----------------------------------
// frontend-tiny is a whole frontend; its JS is irrelevant here because Vite bundles ours (Q5).
const glyphSource = manifest.sources['glyphs-latin'];
const glyphAsset = glyphSource.assets.tiny;
const staging = await mkdtemp(join(tmpdir(), 'studio-glyphs-'));
try {
	const archive = join(staging, glyphAsset.file);
	await writeFile(archive, await download(glyphSource, glyphAsset));

	await run('tar', ['xzf', archive, '-C', staging, 'assets/glyphs']);
	// Repack with `assets/glyphs` as the archive root, so mounting it at /assets/glyphs yields
	// the URLs MapLibre expects: /assets/glyphs/{fontstack}/{range}.pbf
	await run('tar', ['czf', join(resources, 'glyphs.tar.gz'), '-C', join(staging, 'assets', 'glyphs'), '.']);
	process.stdout.write('  repacked assets/glyphs → glyphs.tar.gz\n');
} finally {
	await rm(staging, { recursive: true, force: true });
}

for (const name of ['sprites.tar.gz', 'glyphs.tar.gz']) {
	if (!existsSync(join(resources, name))) throw new Error(`${name} was not written`);
}
console.log('Bundled asset tier ready in src-tauri/resources/.');
