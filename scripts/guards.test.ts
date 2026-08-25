import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeSegment, resolveRepo } from './update-assets';
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
	const root = fileURLToPath(new URL('../', import.meta.url));
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

	/** Whichever spelling Tauri turns out to use for the Windows updater artefact. */
	it.each([['versatiles-studio_0.1.0_x64-setup.exe.zip'], ['versatiles-studio_0.1.0_x64-setup.exe']])(
		'serves Windows whether the artefact is %s or not',
		(x64) => {
			const platforms = platformsFor([x64, `${x64}.sig`], '0.1.0', sig);
			expect(Object.keys(platforms).sort()).toEqual(['windows-x86_64']);
			expect(platforms['windows-x86_64'].url).toContain(x64);
		}
	);

	/**
	 * Windows arm64 is not built — `gdal-sys` has no bindings for it (S5.9) — so an arm64 artefact
	 * turning up means the matrix gained a target that this file was not told about. The orphan
	 * guard is what makes that loud: without it the platform would simply be missing from the
	 * manifest, and every user of it would silently never see an update again.
	 */
	it('refuses an arm64 artefact rather than quietly ignoring it', () => {
		const arm = 'versatiles-studio_0.1.0_arm64-setup.exe';
		expect(() => platformsFor([arm, `${arm}.sig`], '0.1.0', sig)).toThrow(/no platform claims/);
	});

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
	const scripts = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
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
		const real = readFileSync(join(fileURLToPath(new URL('../', import.meta.url)), 'Cargo.lock'), 'utf8');
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
 * release notes and the README — and, in another repository, the tap's cask generator. They are literals on purpose:
 * a shell substitution reading the config is harder to read than the name it produces, and three of
 * the six are user-facing prose where a literal is the only option. What was missing was not
 * indirection but a check that they agree.
 */
describe('the macOS bundle name', () => {
	const root = fileURLToPath(new URL('../', import.meta.url));
	const read = (path: string) => readFileSync(join(root, path), 'utf8');

	const expected = `${JSON.parse(read('src-tauri/tauri.macos.conf.json')).productName}.app`;

	it('is what every file that names it says', () => {
		const wrong: string[] = [];
		for (const path of ['.github/workflows/ci.yml', '.github/workflows/release.yml', 'README.md']) {
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
	});
});

/**
 * Turning a `file:` URL into a path, which has exactly one correct spelling.
 *
 * `new URL(…).pathname` is the one everybody writes and it is wrong on Windows: it yields
 * `/D:/a/repo/`, and Node resolves that leading slash against the current drive, so reading
 * `${root}package.json` looks for `D:\D:\a\repo\package.json`. It is also wrong on any platform
 * when the path contains a character URLs escape — a checkout under `my repo` becomes `my%20repo`.
 *
 * Both failures are invisible where they are written: they need a Windows runner, or a space in the
 * checkout path. This cost a red `main` — every `npm run {action}:*` on Windows died in
 * `beforeBuildCommand` before a single Rust file compiled, and the doubled drive letter in the
 * ENOENT was the only clue. `fileURLToPath` is correct on both counts and no longer to write.
 */
describe('turning a file URL into a path', () => {
	const root = fileURLToPath(new URL('../', import.meta.url));

	it('is never done with .pathname', () => {
		const offenders: string[] = [];
		for (const dir of ['scripts', 'src']) {
			for (const file of sources(join(root, dir))) {
				const text = readFileSync(file, 'utf8');
				// The URL and the `.pathname` can be split across lines by the formatter.
				if (/import\.meta\.url\s*\)?\s*\)?\s*\.pathname/s.test(text)) {
					offenders.push(file.slice(root.length));
				}
			}
		}
		expect(offenders, 'use fileURLToPath(new URL(…)) instead — .pathname breaks on Windows').toEqual([]);
	});
});

/** Every `.ts` under `dir`, recursively. */
function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
		return entry.name.endsWith('.ts') || entry.name.endsWith('.svelte') ? [path] : [];
	});
}

/**
 * Starting `npm` from a script, which has one correct spelling and a silent wrong one.
 *
 * On Windows `npm` is `npm.cmd`, and Node refuses to execute a `.cmd` without `shell: true`. A
 * direct `spawnSync('npm', …)` therefore fails before the script runs — and because `spawnSync`
 * reports that in `error` while leaving `status` as `null`, a caller testing only the status prints
 * a failure with no reason. That combination took two CI rounds to read.
 *
 * `spawn.ts` knows both rules. This is what stops the next script from learning them again.
 */
describe('starting a child process', () => {
	const root = fileURLToPath(new URL('../', import.meta.url));

	it('goes through spawn.ts, never straight at npm', () => {
		const offenders: string[] = [];
		for (const file of readdirSync(join(root, 'scripts'))) {
			if (!file.endsWith('.ts') || file === 'spawn.ts' || file.endsWith('.test.ts')) continue;
			const text = readFileSync(join(root, 'scripts', file), 'utf8');
			if (/(spawnSync|execFileSync|execFile|spawn)\(\s*['"`]npm/.test(text)) offenders.push(file);
		}
		expect(offenders, 'use runInherited from spawn.ts — npm needs a shell on Windows').toEqual([]);
	});
});

/**
 * The `e2e` feature compiles a WebDriver server into the binary so the end-to-end tests can drive
 * it — including on macOS, which no external driver can reach.
 *
 * **A remote-control server must never ship.** Studio's pitch to public administrations is that it
 * is local, accountless and auditable ([Q1](../docs/decisions.md)), and a listener inside a released
 * binary would falsify that whatever the intent. The feature is off by default and nothing that
 * builds a release turns it on; both halves are asserted here rather than remembered, because the
 * failure mode is silent and only visible to somebody reading a shipped binary.
 */
/**
 * What keeps the end-to-end suite worth reading ([the plan](../docs/scope-e2e.md)).
 *
 * A suite this small has no room for a test nobody believes. Two rules carry most of that, and both
 * are the kind that erode quietly — a retry added while chasing one bad afternoon, a wait added
 * without a message because the failure was obvious *at the time*.
 */
describe('the end-to-end suite', () => {
	const root = fileURLToPath(new URL('../', import.meta.url));
	const specs = readdirSync(join(root, 'e2e'), { recursive: true, encoding: 'utf8' })
		.filter((name) => name.endsWith('.ts'))
		.map((name) => join('e2e', name));

	it('has stories to check', () => {
		expect(specs.length).toBeGreaterThan(3);
	});

	/**
	 * **Nothing is retried.** A story that passes on the second attempt is a story that has told you
	 * something and been ignored — either the application is racy, which is a bug, or the story is,
	 * which is a bug in the story. Retries turn both into noise, and the suite has one job that a
	 * retry destroys: being believed.
	 */
	it('retries nothing', () => {
		const config = readFileSync(join(root, 'wdio.conf.ts'), 'utf8');
		const configured = /^\s*(specFileRetries\w*|retries)\s*:/m.exec(config);
		expect(configured?.[0] ?? null, 'a flaky story is deleted, not retried').toBeNull();
	});

	/**
	 * **Every wait says what it was waiting for.** Without a message a timeout reports the wait's own
	 * source, which names the helper and not the seam — "waitUntil condition timed out" is the same
	 * sentence whether the window never opened or the export never finished.
	 */
	it('says what each wait was for', () => {
		const silent: string[] = [];
		for (const path of specs) {
			const text = readFileSync(join(root, path), 'utf8');
			for (const match of text.matchAll(/\bwait(?:Until|ForExist|ForDisplayed|ForClickable)\(/g)) {
				const from = match.index + match[0].length - 1;
				if (!callAt(text, from).includes('timeoutMsg')) {
					silent.push(`${path}: ${match[0]} at ${text.slice(0, from).split('\n').length}`);
				}
			}
		}
		expect(silent, 'give it a timeoutMsg naming what did not happen').toEqual([]);
	});
});

/** The text of the call whose opening bracket is at `from`, brackets balanced. */
function callAt(text: string, from: number): string {
	let depth = 0;
	for (let at = from; at < text.length; at++) {
		if (text[at] === '(') depth++;
		else if (text[at] === ')' && --depth === 0) return text.slice(from, at + 1);
	}
	return text.slice(from);
}

describe('the e2e feature', () => {
	const root = fileURLToPath(new URL('../', import.meta.url));
	const manifest = readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8');

	it('exists, so the tests have something to enable', () => {
		expect(manifest).toMatch(/^e2e = \[/m);
	});

	it('is not in the default feature set', () => {
		const defaults = /^default = \[(.*)\]/m.exec(manifest);
		expect(defaults?.[1] ?? '', 'a default `e2e` would put a WebDriver server in every build').not.toContain('e2e');
	});

	it('is not enabled by anything that builds a release', () => {
		// The string is expected in `e2e:build`, which is what the tests run against and never ships.
		// What must not carry it is anything producing an artefact somebody installs.
		const feature = /--features[= ]\S*e2e/;
		const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts as Record<string, string>;
		const building = Object.entries(scripts).filter(([name]) => name.startsWith('bundle') || name === 'release');
		expect(building.length, 'no release-building script found — has one been renamed?').toBeGreaterThan(0);

		for (const [name, body] of building) {
			expect(body, `\`${name}\` builds a release; it must not pass the e2e feature`).not.toMatch(feature);
		}
		// `ci.yml` is here because it now holds both: a job that runs the suite and a job that builds
		// a release. The suite's job says `npm run e2e:build` rather than the flag, so this stays clean
		// while catching the flag turning up in the bundle step beside it.
		for (const path of [
			'scripts/release.ts',
			'scripts/bundle-local.ts',
			'.github/workflows/release.yml',
			'.github/workflows/ci.yml'
		]) {
			expect(readFileSync(join(root, path), 'utf8'), `${path} must not pass the e2e feature`).not.toMatch(feature);
		}
	});
});
