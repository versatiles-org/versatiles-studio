import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeSegment, resolveRepo } from './update-assets';
import { digestFor, fill } from './cask';
import { platformsFor } from './latest-json';

// The manifest is data, and data that reaches `fetch()` decides where a build machine connects.
// These are the checks that keep a tampered `assets/manifest.json` from redirecting CI.
describe('resolveRepo', () => {
	it('accepts the repositories the manifest actually names', () => {
		for (const repo of [
			'versatiles-org/versatiles-style',
			'versatiles-org/versatiles-fonts',
			'versatiles-org/versatiles-frontend'
		]) {
			expect(resolveRepo(repo)).toBe(repo);
		}
	});

	it('returns the allow-listed constant, not the caller string', () => {
		const input = ['versatiles-org', 'versatiles-style'].join('/');
		// Same characters, different object — what comes back is our constant, so no manifest string
		// can reach a URL even if it happens to spell an allowed repo.
		expect(resolveRepo(input)).toBe('versatiles-org/versatiles-style');
	});

	it('refuses anything not on the list', () => {
		for (const bad of [
			'evil-org/payload',
			'versatiles-org/not-a-real-repo',
			'not-a-repo',
			'https://evil.example/x',
			''
		]) {
			expect(() => resolveRepo(bad)).toThrow(/not one this project fetches from/);
		}
	});
});

describe('assertSafeSegment', () => {
	it('accepts real tags and filenames', () => {
		expect(() => assertSafeSegment('v5.13.1', 'version')).not.toThrow();
		expect(() => assertSafeSegment('frontend-tiny.tar.gz', 'asset filename')).not.toThrow();
	});

	it('refuses path traversal and anything that could escape the URL path', () => {
		for (const bad of ['../../etc/passwd', 'a/b', 'a b', 'x?y=1', 'x#y', '..']) {
			expect(() => assertSafeSegment(bad, 'version')).toThrow();
		}
	});
});

/**
 * The version is stated in three files and has to be one number.
 *
 * `package.json` is what the release workflow reads and compares against the tag; `tauri.conf.json`
 * is what names the installers and what the updater compares against; the workspace `Cargo.toml` is
 * what `env!("CARGO_PKG_VERSION")` becomes, which is the version Studio puts in its `User-Agent`.
 * Three places to remember means one of them being forgotten, and the failure is quiet: a release
 * builds, installs, and reports the wrong version of itself.
 */
describe('the version', () => {
	const root = new URL('../', import.meta.url).pathname;
	const read = (path: string) => readFileSync(join(root, path), 'utf8');

	it('is the same in every file that states it', () => {
		const stated = {
			'package.json': JSON.parse(read('package.json')).version,
			'src-tauri/tauri.conf.json': JSON.parse(read('src-tauri/tauri.conf.json')).version,
			// The workspace version, which both crates inherit with `version.workspace = true`.
			'Cargo.toml': /^version = "([^"]+)"$/m.exec(read('Cargo.toml'))?.[1]
		};

		expect(stated['Cargo.toml'], 'no `version = "…"` in the workspace Cargo.toml').toBeDefined();
		expect(new Set(Object.values(stated)).size, `these disagree: ${JSON.stringify(stated)}`).toBe(1);
	});
});

/**
 * Filling in the cask (S5.7).
 *
 * The two things that can go wrong here are silent: replacing nothing, and replacing one checksum
 * instead of two. Either produces a cask that installs the previous version's binary under this
 * version's name, and neither shows up until someone runs `brew install`.
 */
describe('the cask', () => {
	const template = readFileSync(new URL('../packaging/versatiles-studio.rb', import.meta.url).pathname, 'utf8');
	const A = 'a'.repeat(64);
	const B = 'b'.repeat(64);

	it('replaces the version and both checksums', () => {
		const filled = fill(template, '1.2.3', A, B);
		expect(filled).toContain('version "1.2.3"');
		expect(filled).toContain(`"${A}"`);
		expect(filled).toContain(`"${B}"`);
		expect(filled).not.toContain('0000000000000000');
	});

	it('puts the Apple Silicon checksum in the on_arm block', () => {
		const filled = fill(template, '1.2.3', A, B);
		const arm = filled.indexOf('on_arm');
		const intel = filled.indexOf('on_intel');
		expect(filled.indexOf(`"${A}"`)).toBeGreaterThan(arm);
		expect(filled.indexOf(`"${A}"`)).toBeLessThan(intel);
		expect(filled.indexOf(`"${B}"`)).toBeGreaterThan(intel);
	});

	it('refuses a template it cannot recognise rather than returning it unchanged', () => {
		expect(() => fill('cask "x" do\nend\n', '1.2.3', A, B)).toThrow(/nothing was replaced/);
		// One block deleted: the version still replaces, so this is the case a plain
		// "did anything change" check would wave through.
		const halved = template.replace(/^\s*sha256 "[0-9a-f]{64}"$/m, '');
		expect(() => fill(halved, '1.2.3', A, B)).toThrow(/found 1/);
	});

	it('names the asset it could not find', () => {
		expect(() => digestFor([], '_aarch64.dmg')).toThrow(/_aarch64.dmg/);
		expect(() =>
			digestFor(
				[
					{ name: 'a_x64.dmg', digest: 'sha256:1' },
					{ name: 'b_x64.dmg', digest: 'sha256:2' }
				],
				'_x64.dmg'
			)
		).toThrow(/2 assets end in/);
	});
});

/**
 * The updater's manifest (S5.8).
 *
 * A wrong platform key produces an updater that silently never finds an update, which from the
 * outside is indistinguishable from being up to date — so the keys are pinned here rather than
 * trusted to a run nobody reads.
 */
describe('latest.json', () => {
	const sig = (name: string) => `signature-of-${name}\n`;

	const NAMES = [
		'VersaTiles Studio_1.2.3_aarch64.dmg',
		'VersaTiles Studio.app.tar.gz',
		'VersaTiles Studio.app.tar.gz.sig',
		'versatiles-studio_1.2.3_amd64.deb',
		'VersaTiles Studio_1.2.3_amd64.AppImage',
		'VersaTiles Studio_1.2.3_amd64.AppImage.tar.gz',
		'VersaTiles Studio_1.2.3_amd64.AppImage.tar.gz.sig'
	];

	it('names the Linux bundle by the key Tauri looks for', () => {
		const platforms = platformsFor(NAMES, '1.2.3', sig);
		expect(Object.keys(platforms)).toContain('linux-x86_64');
		// Read from the `.sig` beside the bundle, not from the bundle.
		expect(platforms['linux-x86_64'].signature).toBe('signature-of-VersaTiles Studio_1.2.3_amd64.AppImage.tar.gz.sig');
		expect(platforms['linux-x86_64'].url).toContain('/v1.2.3/');
		// A space in a filename has to survive being a URL, or the updater 404s on every release.
		expect(platforms['linux-x86_64'].url).not.toContain(' ');
	});

	it('leaves out a platform that produced nothing', () => {
		// The macOS `.app.tar.gz` above carries no architecture in its name, so neither darwin key
		// matches it — and an absent entry is the honest answer.
		const platforms = platformsFor(['x.AppImage.tar.gz', 'x.AppImage.tar.gz.sig'], '1.2.3', sig);
		expect(Object.keys(platforms)).toEqual(['linux-x86_64']);
	});

	it('translates Tauri’s x64 into the updater’s x86_64', () => {
		const names = ['Studio_x64.app.tar.gz', 'Studio_x64.app.tar.gz.sig'];
		expect(Object.keys(platformsFor(names, '1.2.3', sig))).toEqual(['darwin-x86_64']);
	});

	// Publishing an unsigned entry produces an update every installed copy downloads and refuses.
	it('refuses a bundle with no signature beside it', () => {
		expect(() => platformsFor(['x.AppImage.tar.gz'], '1.2.3', sig)).toThrow(/TAURI_SIGNING_PRIVATE_KEY/);
	});

	it('refuses two bundles claiming one platform', () => {
		expect(() =>
			platformsFor(
				['a.AppImage.tar.gz', 'a.AppImage.tar.gz.sig', 'b.AppImage.tar.gz', 'b.AppImage.tar.gz.sig'],
				'1.2.3',
				sig
			)
		).toThrow(/2 bundles match/);
	});
});
