import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeSegment, resolveRepo } from './update-assets';
import { digestFor, fill } from './cask';
import { platformsFor } from './latest-json';
import { changelogSection, isAhead, nextVersion, withCargoLockVersion } from './release';
import { membersOf } from './run';

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
 * Every failure here is silent from the outside: a platform missing from the manifest looks exactly
 * like being up to date, forever, for everyone on it. The names below are the ones a real release
 * run produced, not the ones the documentation describes — they differ.
 */
describe('latest.json', () => {
	const sig = (name: string) => `signature-of-${name}\n`;

	/** What the Collect step leaves behind, once each platform has uploaded. */
	const NAMES = [
		// Installers, under the names Tauri gave them.
		'VersaTiles-Studio_0.1.0_aarch64.dmg',
		'VersaTiles-Studio_0.1.0_x64.dmg',
		'versatiles-studio_0.1.0_amd64.deb',
		'VersaTiles-Studio_0.1.0_amd64.AppImage',
		'VersaTiles-Studio_0.1.0_aarch64.AppImage',
		// macOS updater bundles, renamed because Tauri gives both the same name.
		'darwin-aarch64.app.tar.gz',
		'darwin-aarch64.app.tar.gz.sig',
		'darwin-x86_64.app.tar.gz',
		'darwin-x86_64.app.tar.gz.sig',
		// Linux signs the AppImage itself — there is no .AppImage.tar.gz.
		'VersaTiles-Studio_0.1.0_amd64.AppImage.sig',
		'VersaTiles-Studio_0.1.0_aarch64.AppImage.sig'
	];

	it('serves every platform the release builds', () => {
		const platforms = platformsFor(NAMES, '0.1.0', sig);
		expect(Object.keys(platforms).sort()).toEqual(['darwin-aarch64', 'darwin-x86_64', 'linux-aarch64', 'linux-x86_64']);
	});

	it('points Linux at the AppImage a person also downloads', () => {
		const platforms = platformsFor(NAMES, '0.1.0', sig);
		expect(platforms['linux-x86_64'].url).toContain('VersaTiles-Studio_0.1.0_amd64.AppImage');
		expect(platforms['linux-x86_64'].signature).toBe('signature-of-VersaTiles-Studio_0.1.0_amd64.AppImage.sig');
		// A space in a filename has to survive being a URL, or the updater 404s on every release.
		expect(platforms['linux-aarch64'].url).not.toContain(' ');
	});

	/**
	 * The exact directory the failed v0.1.0 run produced: no renaming, a Linux `.AppImage.sig`
	 * rather than a `.tar.gz`, and four `.tar.gz` files swept out of the deb's staging directory.
	 * It emitted nothing at all. Now the leftovers are named rather than ignored.
	 */
	it('refuses the directory that produced an empty manifest', () => {
		const asItWas = [
			'VersaTiles Studio.app.tar.gz',
			'VersaTiles Studio.app.tar.gz.sig',
			'VersaTiles Studio_0.1.0_aarch64.dmg',
			'VersaTiles-Studio_0.1.0_amd64.AppImage',
			'VersaTiles-Studio_0.1.0_amd64.AppImage.sig',
			'VersaTiles Studio_0.1.0_amd64.deb',
			'VersaTiles Studio_0.1.0_amd64.deb.sig',
			'VersaTiles Studio_0.1.0_x64.dmg',
			'control.tar.gz',
			'data.tar.gz',
			'glyphs.tar.gz',
			'sprites.tar.gz'
		];
		expect(() => platformsFor(asItWas, '0.1.0', sig)).toThrow(/no platform claims/);
	});

	/**
	 * What the first successful release actually shipped: `latest.json` pointed at
	 * `VersaTiles%20Studio_…`, GitHub had stored `VersaTiles.Studio_…`, and every Linux update
	 * would have 404'd. The workflow renames them now; this is what notices if it stops.
	 */
	it('refuses a name GitHub would rewrite on upload', () => {
		const withSpace = ['VersaTiles Studio_0.1.0_amd64.AppImage', 'VersaTiles Studio_0.1.0_amd64.AppImage.sig'];
		expect(() => platformsFor(withSpace, '0.1.0', sig)).toThrow(/GitHub rewrites/);
	});

	it('leaves out a platform that produced nothing', () => {
		const macOnly = NAMES.filter((n) => n.startsWith('darwin-aarch64'));
		expect(Object.keys(platformsFor(macOnly, '0.1.0', sig))).toEqual(['darwin-aarch64']);
	});

	// Publishing an unsigned entry produces an update every installed copy downloads and refuses.
	it('refuses a bundle with no signature beside it', () => {
		expect(() => platformsFor(['darwin-x86_64.app.tar.gz'], '0.1.0', sig)).toThrow(/TAURI_SIGNING_PRIVATE_KEY/);
	});
});

/**
 * Cutting a release (S5.6).
 *
 * The version arithmetic and the changelog grouping are the parts that are wrong quietly: a bad
 * bump spends a version number publicly, and a dropped commit is a change nobody is told about.
 */
describe('release', () => {
	it('bumps the part it was asked for', () => {
		expect(nextVersion('0.1.4', 'patch')).toBe('0.1.5');
		expect(nextVersion('0.1.4', 'minor')).toBe('0.2.0');
		expect(nextVersion('0.1.4', 'major')).toBe('1.0.0');
		expect(nextVersion('0.1.4', '2.0.0-rc.1')).toBe('2.0.0-rc.1');
	});

	it('refuses a word it does not know rather than guessing', () => {
		expect(() => nextVersion('0.1.4', 'next')).toThrow(/neither a version nor/);
		expect(() => nextVersion('0.1.4', '0.2')).toThrow(/neither a version nor/);
	});

	// Comparing versions as text puts 0.10.0 before 0.9.0, which is a release that silently goes
	// backwards.
	it('compares versions as numbers', () => {
		expect(isAhead('0.9.0', '0.10.0')).toBe(true);
		expect(isAhead('0.10.0', '0.9.0')).toBe(false);
		expect(isAhead('0.2.0', '0.2.0')).toBe(false);
		expect(isAhead('0.2.0-rc.1', '0.2.0')).toBe(true);
	});

	it('groups the commits it recognises', () => {
		const section = changelogSection('v0.2.0', '2026-08-22', [
			'feat: crop by rectangle',
			'feat(style): a bundle',
			'fix: the URLs the plain export carried',
			'chore: versatiles-rs 4.9.1'
		]);
		expect(section).toContain('## v0.2.0 — 2026-08-22');
		expect(section).toContain('### Features');
		expect(section).toContain('- crop by rectangle');
		expect(section).toContain('- a bundle');
		expect(section).toContain('### Fixes');
		expect(section.indexOf('### Features')).toBeLessThan(section.indexOf('### Chores'));
	});

	// The one failure a changelog must not have.
	it('keeps a commit whose message has no prefix', () => {
		const section = changelogSection('v0.2.0', '2026-08-22', ['tidied some things up']);
		expect(section).toContain('### Other');
		expect(section).toContain('- tidied some things up');
	});

	it('says so rather than emitting an empty section', () => {
		expect(changelogSection('v0.2.0', '2026-08-22', [])).toContain('No changes recorded');
	});
});

/**
 * The shape of `package.json`'s scripts.
 *
 * **A convention nobody can check is a convention that decays.** This one is `{action}` or
 * `{action}:{context}`, and a bare `{action}` runs every `{action}:*` there is — which is only true
 * if it delegates to the runner rather than naming its members. The previous `check` named five by
 * hand, so a sixth could be added and silently never run: the tick still appears, and the check that
 * was added to catch something catches nothing.
 */
describe('npm scripts', () => {
	const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url).pathname, 'utf8'))
		.scripts as Record<string, string>;

	/** Groups whose members are alternatives rather than a set, so no aggregate is correct. */
	const NO_AGGREGATE = new Set(['assets']);

	it('names every script action-first', () => {
		// `assets:*` is the documented exception: three alternatives on one subject, one of which
		// reaches the network, so sweeping them into an aggregate would be wrong.
		const offenders = Object.keys(scripts).filter((name) => {
			const [head] = name.split(':');
			return name.includes(':') && !scripts[head] && !NO_AGGREGATE.has(head);
		});
		expect(offenders, 'an `x:y` script needs an `x` that runs the group, or an exemption').toEqual([]);
	});

	it('lets every aggregate find its members', () => {
		for (const [name, body] of Object.entries(scripts)) {
			if (name.includes(':') || !body.includes('scripts/run.ts')) continue;
			expect(membersOf(scripts, name), `${name} matches no ${name}:* scripts`).not.toEqual([]);
		}
	});

	/**
	 * An aggregate that names its members is the drift this exists to stop. Anything running
	 * `run.ts` cannot go stale; anything else has to be a single command.
	 */
	it('has no aggregate that hardcodes its members', () => {
		const offenders = Object.entries(scripts)
			.filter(([name, body]) => membersOf(scripts, name).length > 0 && !body.includes('scripts/run.ts'))
			.map(([name]) => name);
		expect(offenders, 'delegate to scripts/run.ts instead of listing the members').toEqual([]);
	});

	// One command, one definition. Two scripts running the same thing is two places to change it.
	it('defines each command once', () => {
		const bodies = Object.entries(scripts).filter(([, body]) => !body.includes('scripts/run.ts'));
		const seen = new Map<string, string>();
		const duplicates: string[] = [];
		for (const [name, body] of bodies) {
			const first = seen.get(body);
			if (first) duplicates.push(`${first} and ${name}: ${body}`);
			else seen.set(body, name);
		}
		expect(duplicates).toEqual([]);
	});
});

/**
 * The runner's tree walk.
 *
 * Matching every descendant rather than the direct children would make `check` run each leaf twice —
 * once through its parent and once on its own — which is invisible except as a check that takes
 * twice as long as it should.
 */
describe('scripts/run.ts', () => {
	const tree = {
		check: '',
		'check:lint': '',
		'check:lint:web': '',
		'check:lint:rust': '',
		'check:types': '',
		other: ''
	};

	it('takes the direct children and not the grandchildren', () => {
		expect(membersOf(tree, 'check')).toEqual(['check:lint', 'check:types']);
		expect(membersOf(tree, 'check:lint')).toEqual(['check:lint:web', 'check:lint:rust']);
	});

	it('keeps the order package.json declares, which is what makes check cheapest-first', () => {
		expect(membersOf({ 'check:z': '', 'check:a': '' }, 'check')).toEqual(['check:z', 'check:a']);
	});

	it('finds nothing for a leaf', () => {
		expect(membersOf(tree, 'check:types')).toEqual([]);
	});
});

/**
 * Bumping `Cargo.lock` (S5.6).
 *
 * `cargo metadata` used to do this and could not: it resolves every target and feature, so under
 * `--offline` it fails on the first crate an ordinary build never fetched, and without it a version
 * bump needs the network. The rule that replaces it — a workspace member is a `[[package]]` with no
 * `source` — has to touch our packages and no others, and there are 700 others.
 */
describe('Cargo.lock', () => {
	const LOCK = [
		'[[package]]',
		'name = "studio-core"',
		'version = "0.1.0"',
		'dependencies = [',
		' "anyhow",',
		']',
		'',
		'[[package]]',
		'name = "anyhow"',
		'version = "1.0.100"',
		'source = "registry+https://github.com/rust-lang/crates.io-index"',
		'',
		'[[package]]',
		'name = "versatiles-studio"',
		'version = "0.1.0"',
		'dependencies = []',
		''
	].join('\n');

	it('bumps the packages in this repository', () => {
		const { text, changed } = withCargoLockVersion(LOCK, '0.2.0');
		expect(changed).toBe(2);
		expect(text).toContain('name = "studio-core"\nversion = "0.2.0"');
		expect(text).toContain('name = "versatiles-studio"\nversion = "0.2.0"');
	});

	// The one thing this must never do. A dependency's version is what the lockfile is for.
	it('leaves every dependency alone', () => {
		const { text } = withCargoLockVersion(LOCK, '0.2.0');
		expect(text).toContain('name = "anyhow"\nversion = "1.0.100"');
	});

	it('refuses a lockfile it does not recognise rather than writing it back unchanged', () => {
		const { changed } = withCargoLockVersion('# not a lockfile\n', '0.2.0');
		expect(changed).toBe(0);
	});

	/** The real file, so the rule is checked against the thing it will actually run on. */
	it('finds exactly the two workspace members in the real lockfile', () => {
		const real = readFileSync(join(new URL('../', import.meta.url).pathname, 'Cargo.lock'), 'utf8');
		const { text, changed } = withCargoLockVersion(real, '9.9.9');
		expect(changed).toBe(2);
		// And nothing else moved: two lines differ, no more.
		const differing = text.split('\n').filter((line, i) => line !== real.split('\n')[i]);
		expect(differing).toEqual(['version = "9.9.9"', 'version = "9.9.9"']);
	});
});

/**
 * The macOS bundle name, wherever it is written down.
 *
 * `tauri.macos.conf.json` decides it, and six other places spell it out — two smoke tests, the
 * cask's `app` stanza and its caveats, the release notes, the README. They are literals on purpose:
 * a shell substitution reading the config is harder to read than the name it produces, and three of
 * the six are user-facing prose where a literal is the only option. What was missing was not
 * indirection but a check that they agree.
 */
describe('the macOS bundle name', () => {
	const root = new URL('../', import.meta.url).pathname;
	const read = (path: string) => readFileSync(join(root, path), 'utf8');

	const expected = `${JSON.parse(read('src-tauri/tauri.macos.conf.json')).productName}.app`;

	it('is what every file that names it says', () => {
		const wrong: string[] = [];
		for (const path of [
			'.github/workflows/ci.yml',
			'.github/workflows/release.yml',
			'packaging/versatiles-studio.rb',
			'README.md'
		]) {
			// Preceded by a quote or a path separator, but not by `//` — otherwise the README's
			// link to https://tauri.app reads as a bundle name.
			for (const [, name] of read(path).matchAll(/(?<=["'/])(?<!\/\/)([A-Za-z][A-Za-z0-9 _.-]*\.app)\b/g)) {
				if (name !== expected) wrong.push(`${path}: ${name}`);
			}
		}
		expect(wrong, `tauri.macos.conf.json says ${expected}`).toEqual([]);
	});

	// Without this, a rename that updated every file consistently but wrongly would still pass.
	it('is actually mentioned, so the check cannot pass by finding nothing', () => {
		expect(read('.github/workflows/ci.yml')).toContain(expected);
		expect(read('packaging/versatiles-studio.rb')).toContain(expected);
	});
});
