/**
 * Cutting a release, end to end (S5.6, S5.7, S5.8).
 *
 *   npm run release -- 0.2.0        an explicit version
 *   npm run release -- minor        or bump the current one
 *   npm run release -- minor --dry-run
 *
 * **One confirmation, and it is the only one.** Everything before it is local and reversible -
 * checks, a version bump, a changelog, a commit and a tag, all of which `git reset` undoes. The
 * prompt names exactly what is about to become public; past it the script pushes and the workflow
 * takes over, publishing once it has verified the release. Two prompts for one decision teaches
 * people to press return twice.
 *
 * **The order is deliberate.** Nothing public happens until the full test suite has passed and a
 * human has read the notes, because a tag is cheap to make and expensive to retract: an installed
 * copy that has seen `latest.json` cannot be told to forget it.
 *
 * **The notes this writes are the notes that ship.** `release.yml`'s first job reads this
 * `CHANGELOG.md` section straight off the tagged commit, appends `.github/release-install.md`, and
 * opens the draft with the result - before a single build starts. So the section written here is
 * the top of the release page, and a missing one fails the run in about five seconds rather than
 * after two hours of building.
 *
 * **What it does not do.** Write the Homebrew cask. The tap generates its own from the published
 * release, triggered by the release workflow - one place that knows what a cask looks like, reading
 * the assets rather than being told about them.
 */

import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInherited } from './spawn';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CHANGELOG = `${ROOT}CHANGELOG.md`;
const BRANCH = 'main';

// ------------------------------------------------------------------------------------------------
// Running things
// ------------------------------------------------------------------------------------------------

/** A command whose output is the answer. Throws with the command in the message. */
function capture(command: string, args: string[]): string {
	try {
		return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8' }).trim();
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`${command} ${args.join(' ')} failed:\n${detail}`, { cause: error });
	}
}

/** A command whose *output* is the point - inherited, so `npm run check` scrolls past as it runs. */
function run(command: string, args: string[]): void {
	const problem = runInherited(command, args, ROOT);
	if (problem) throw new Error(problem);
}

function say(step: string): void {
	process.stdout.write(`\n\x1b[1m▸ ${step}\x1b[0m\n`);
}

// ------------------------------------------------------------------------------------------------
// The version
// ------------------------------------------------------------------------------------------------

/** The files that state the version, and how to rewrite each one. */
const VERSION_FILES: { path: string; replace: (text: string, version: string) => string }[] = [
	{
		path: 'package.json',
		replace: (text, version) => text.replace(/^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`)
	},
	{
		path: 'src-tauri/tauri.conf.json',
		replace: (text, version) => text.replace(/^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`)
	},
	{
		// The workspace version, which both crates inherit with `version.workspace = true`. Anchored
		// to `[workspace.package]`'s first `version =` - a plain match would find a dependency's.
		path: 'Cargo.toml',
		replace: (text, version) => text.replace(/^version = "[^"]*"$/m, `version = "${version}"`)
	}
];

/**
 * `0.2.0`, or what `patch`/`minor`/`major` means for `current`.
 *
 * Exported for the tests: an off-by-one here is a version number spent, and a wrong one is spent
 * publicly.
 */
export function nextVersion(current: string, wanted: string): string {
	if (/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(wanted)) return wanted;

	const parts = current.split('.').map(Number);
	if (parts.length !== 3 || parts.some(Number.isNaN)) {
		throw new Error(`the current version "${current}" is not semver - pass an explicit one`);
	}
	const [major, minor, patch] = parts;
	switch (wanted) {
		case 'major':
			return `${major + 1}.0.0`;
		case 'minor':
			return `${major}.${minor + 1}.0`;
		case 'patch':
			return `${major}.${minor}.${patch + 1}`;
		default:
			throw new Error(`"${wanted}" is neither a version nor one of major, minor, patch`);
	}
}

/** Whether `next` is actually ahead of `current`, comparing numerically rather than as text. */
export function isAhead(current: string, next: string): boolean {
	const parse = (v: string) => v.split('-')[0].split('.').map(Number);
	const [a, b] = [parse(current), parse(next)];
	for (let i = 0; i < 3; i += 1) {
		if (a[i] !== b[i]) return b[i] > a[i];
	}
	// Equal releases differ only by a pre-release suffix, and `0.2.0` is ahead of `0.2.0-rc.1`.
	return current.includes('-') && !next.includes('-');
}

/**
 * The version of this repository's own packages in `Cargo.lock`.
 *
 * **Edited directly, rather than by asking cargo to rewrite it.** `cargo metadata` resolves the
 * whole graph across every target and feature, so it wants crates an ordinary build never fetches -
 * under `--offline` it fails on the first of them, and without `--offline` a version bump depends on
 * the network. Neither is a reasonable thing for renaming a number.
 *
 * A workspace member is a `[[package]]` with no `source`: a path dependency has nowhere to have come
 * from. That is the whole rule, and it needs no list to keep in step with `[workspace] members`.
 */
export function withCargoLockVersion(lock: string, version: string): { text: string; changed: number } {
	let changed = 0;
	const text = lock.replace(
		/(\[\[package\]\]\nname = "[^"]+"\nversion = )"[^"]*"(\n(?!source = ))/g,
		(_match, head: string, tail: string) => {
			changed += 1;
			return `${head}"${version}"${tail}`;
		}
	);
	return { text, changed };
}

function bumpCargoLock(version: string): void {
	const path = `${ROOT}Cargo.lock`;
	const { text, changed } = withCargoLockVersion(readFileSync(path, 'utf8'), version);

	// Cargo would rewrite this on the next build anyway, so a miss is not fatal at once - it is a
	// lockfile that turns up dirty in somebody's unrelated commit a week later, which is worse to
	// diagnose than to prevent.
	if (changed === 0) throw new Error('no workspace member found in Cargo.lock - has its format changed?');
	writeFileSync(path, text);
	process.stdout.write(`  Cargo.lock (${changed} packages)\n`);
}

// ------------------------------------------------------------------------------------------------
// The notes
// ------------------------------------------------------------------------------------------------

const GROUPS: [prefix: string, heading: string][] = [
	['feat', 'Features'],
	['fix', 'Fixes'],
	['perf', 'Performance'],
	['refactor', 'Refactoring'],
	['docs', 'Documentation'],
	['test', 'Tests'],
	['build', 'Build'],
	['ci', 'CI'],
	['chore', 'Chores']
];

/**
 * A changelog section from conventional-commit subjects.
 *
 * **A starting point, not the output.** Every line here is a commit message, written for the next
 * developer; release notes are written for someone deciding whether to update. So this is opened in
 * an editor before it is committed, and the generated shape exists to make sure nothing is
 * forgotten rather than to be shipped as-is.
 *
 * A subject with no recognised prefix still appears, under `Other` - dropping a change because its
 * message was informal is the one failure a changelog must not have.
 */
export function changelogSection(version: string, date: string, subjects: string[]): string {
	const buckets = new Map<string, string[]>();
	const other: string[] = [];

	for (const subject of subjects) {
		const match = /^([a-z]+)(\([^)]*\))?!?:\s*(.+)$/.exec(subject);
		const group = match && GROUPS.find(([prefix]) => prefix === match[1]);
		if (group && match) {
			const [, heading] = group;
			buckets.set(heading, [...(buckets.get(heading) ?? []), match[3]]);
		} else {
			other.push(subject);
		}
	}

	const lines = [`## ${version} - ${date}`, ''];
	for (const [, heading] of GROUPS) {
		const items = buckets.get(heading);
		if (!items) continue;
		lines.push(`### ${heading}`, '', ...items.map((item) => `- ${item}`), '');
	}
	if (other.length > 0) {
		lines.push('### Other', '', ...other.map((item) => `- ${item}`), '');
	}
	if (buckets.size === 0 && other.length === 0) {
		lines.push('_No changes recorded - write them here._', '');
	}
	return lines.join('\n');
}

/** The new section, above whatever is already there. */
function prependChangelog(section: string): void {
	const header =
		'# Changelog\n\nWhat changed in each release. Written for someone deciding whether\nto update, not for the next developer - the commit log is that.\n';
	const existing = existsSync(CHANGELOG)
		? readFileSync(CHANGELOG, 'utf8').replace(/^# Changelog\n\n[\s\S]*?\n(?=## |$)/, '')
		: '';
	writeFileSync(CHANGELOG, `${header}\n${section}${existing ? `\n${existing.trimStart()}` : ''}`);
}

// ------------------------------------------------------------------------------------------------
// The flow
// ------------------------------------------------------------------------------------------------

/**
 * That the updater can be signed, checked before a tag exists.
 *
 * **The failure this prevents costs a version number.** Signing happens near the end of a build that
 * takes up to an hour, on a tag that is already pushed - so a missing secret is discovered at the
 * most expensive possible moment. Reading the names here costs one API call.
 *
 * **Only the key is checked.** `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is deliberately not set: the
 * key was generated without a password, and an unset secret expands to the empty string that means
 * exactly that. Warning about it would fire on every release for a state that is correct and
 * permanent, which is how a check teaches people to stop reading it.
 */
function checkSigningSecrets(): void {
	let names: string[];
	try {
		names = capture('gh', ['secret', 'list', '--json=name', '--jq=.[].name']).split('\n').filter(Boolean);
	} catch {
		// Listing secrets needs admin. Not having it is normal, and is not a reason to refuse.
		process.stdout.write('  could not read the repository secrets - skipping the signing check\n');
		return;
	}

	if (!names.includes('TAURI_SIGNING_PRIVATE_KEY')) {
		throw new Error(
			'TAURI_SIGNING_PRIVATE_KEY is not set - the updater bundles cannot be signed.\n' +
				'Generate a key with `npx tauri signer generate` and add it to the repository secrets.'
		);
	}
}

/**
 * `y` to go ahead. Anything else, including a bare return, stops.
 *
 * Defaulting to no is the whole safety of it: the expensive mistake is an absent-minded return, and
 * this is the one prompt standing between a local commit and a published release.
 */
/**
 * Refuses to release a commit CI has not passed.
 *
 * **A gate, not a wait.** Making the release *workflow* depend on the CI workflow would put thirteen
 * minutes in front of a forty-minute build, re-running checks this script has already run. What is
 * actually missing is different: the local run happens on whatever machine you are sitting at, so a
 * Linux-only failure would be tagged and published without anyone seeing it. Asking whether the
 * commit is already green costs one request and closes exactly that gap.
 *
 * **HEAD, before the version bump.** The bump commit does not exist yet at this point in the run,
 * and would have no CI run of its own if it did - it changes three version numbers and a changelog.
 * The commit being released is the one under it.
 *
 * A consequence worth knowing: an unpushed commit has no CI run, so releasing now means pushing
 * first and waiting. That is the guarantee, not a side effect - code CI has never seen is precisely
 * what this refuses to tag.
 */
function checkCiIsGreen(): void {
	const sha = capture('git', ['rev-parse', 'HEAD']);
	const [status, conclusion] = capture('gh', [
		'api',
		// The full 40 characters: `head_sha` is an exact match, and an abbreviated one silently
		// returns nothing - which would read as "no CI run" for a commit that has one.
		`/repos/{owner}/{repo}/actions/workflows/ci.yml/runs?head_sha=${sha}`,
		'--jq',
		'[(.workflow_runs[0].status // ""), (.workflow_runs[0].conclusion // "")] | @tsv'
	]).split('\t');

	const short = sha.slice(0, 7);
	if (!status) {
		throw new Error(
			`no CI run for ${short} - push it and let CI finish first.\n` +
				'Releasing a commit CI has never seen is what this check exists to prevent.'
		);
	}
	if (status !== 'completed') {
		throw new Error(`CI is still ${status} on ${short} - wait for it, then run this again`);
	}
	if (conclusion !== 'success') {
		throw new Error(`CI ${conclusion} on ${short} - fix it before releasing`);
	}
	process.stdout.write(`  CI is green on ${short}\n`);
}

async function confirm(question: string): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await rl.question(question);
	rl.close();
	return answer.trim().toLowerCase() === 'y';
}

/** One job, as `gh` reports it. */
interface Job {
	name: string;
	status: string;
	conclusion: string | null;
}

/**
 * How wide the table is allowed to be. A release is watched in whatever terminal is open, and 56
 * fits every one of them.
 */
const WIDTH = 56;

/** What is left for a job's name: the width, less `  ✓ ` and the longest state word. */
const NAME_WIDTH = WIDTH - 4 - 'in_progress'.length;

const MARK: Record<string, string> = {
	success: '\x1b[32m✓\x1b[0m',
	failure: '\x1b[31m✗\x1b[0m',
	cancelled: '\x1b[31m✗\x1b[0m',
	skipped: '\x1b[2m-\x1b[0m',
	in_progress: '\x1b[33m•\x1b[0m',
	queued: '\x1b[2m·\x1b[0m'
};

/** `4m12s`. */
function elapsed(seconds: number): string {
	return `${Math.floor(seconds / 60)}m${String(Math.floor(seconds % 60)).padStart(2, '0')}s`;
}

/**
 * One line per job, redrawn in place until the run finishes.
 *
 * **Rather than `gh run watch`.** That prints the full job tree with every step, which wraps in any
 * terminal narrower than very wide and turns a forty-minute wait into thousands of lines of
 * scrollback. What is actually wanted is three rows and a clock.
 *
 * Polled every fifteen seconds: the jobs take tens of minutes, and the API has a rate limit worth
 * respecting when the wait is this long.
 */
async function watch(runId: string): Promise<void> {
	const started = Date.now();
	let drawn = 0;

	for (;;) {
		const raw = capture('gh', [
			'run',
			'view',
			runId,
			'--json=status,conclusion,jobs',
			'--jq=[.status, (.conclusion // ""), (.jobs | map({name, status, conclusion: (.conclusion // null)}))] | @json'
		]);
		const [status, conclusion, jobs] = JSON.parse(raw) as [string, string, Job[]];

		const lines = jobs.map((job) => {
			const state = job.conclusion ?? job.status;
			const mark = MARK[state] ?? '\x1b[2m?\x1b[0m';
			// Truncated rather than wrapped: a wrapped row breaks the redraw, because the cursor has
			// to move back over a number of lines this cannot then predict.
			const name = job.name.length > NAME_WIDTH ? `${job.name.slice(0, NAME_WIDTH - 1)}…` : job.name;
			// `in_progress` is left blank: the dot already says it, and the word is the widest here.
			return `  ${mark} ${name.padEnd(NAME_WIDTH)}${state === 'in_progress' ? '' : state}`;
		});
		lines.push(`  \x1b[2m${elapsed((Date.now() - started) / 1000)} elapsed\x1b[0m`);

		// Back over what was printed last time, clearing each line before rewriting it - otherwise a
		// shorter row leaves the tail of the longer one behind it.
		if (drawn > 0) process.stdout.write(`\x1b[${drawn}A`);
		process.stdout.write(lines.map((line) => `\x1b[2K${line}`).join('\n') + '\n');
		drawn = lines.length;

		if (status === 'completed') {
			if (conclusion !== 'success') {
				// **What failed is recoverable per job, and saying so is the difference between a
				// twenty-minute fix and a two-hour one.** Every bundle uploads into the draft as it
				// finishes, so a run that lost one platform still has the other four sitting on the
				// release; re-running the failed job alone fills the gap. The draft is deliberately
				// left behind for exactly this - see the note at the end of `release.yml`.
				const failed = jobs.filter((job) => job.conclusion && job.conclusion !== 'success');
				throw new Error(
					[
						`the release build ${conclusion} - ${failed.map((job) => job.name).join(', ') || 'see the run above'}`,
						'',
						'  The draft release holds whatever did succeed, and is invisible until published.',
						`  Re-run just the failed jobs:  gh run rerun ${runId} --failed`,
						'  Or start clean:               gh release delete <tag>'
					].join('\n')
				);
			}
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 15_000));
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const dryRun = args.includes('--dry-run');
	const wanted = args.find((arg) => !arg.startsWith('-'));
	if (!wanted) throw new Error('usage: npm run release -- <version|patch|minor|major> [--dry-run]');

	// --- nothing has changed yet -----------------------------------------------------------

	say('Checking the working tree');
	if (capture('git', ['status', '--porcelain'])) {
		throw new Error('the working tree is not clean - commit or stash first');
	}
	const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
	if (branch !== BRANCH) throw new Error(`on ${branch}, not ${BRANCH}`);

	capture('git', ['fetch', 'origin', BRANCH, '--tags']);
	const [behind, ahead] = capture('git', ['rev-list', '--left-right', '--count', `origin/${BRANCH}...HEAD`])
		.split(/\s+/)
		.map(Number);
	if (behind > 0) throw new Error(`${behind} commits behind origin/${BRANCH} - pull first`);
	if (ahead > 0) process.stdout.write(`  ${ahead} commits to push\n`);

	// `gh` is what publishes, and finding out it is missing after the tag is pushed would leave a
	// release half-cut.
	if (!dryRun) {
		try {
			capture('gh', ['auth', 'status']);
		} catch (error) {
			throw new Error('gh is not installed or not authenticated - run `gh auth login`', { cause: error });
		}
		checkSigningSecrets();
		checkCiIsGreen();
	}

	const current = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')).version as string;
	const version = nextVersion(current, wanted);
	if (!isAhead(current, version)) throw new Error(`${version} is not ahead of ${current}`);
	const tag = `v${version}`;
	if (capture('git', ['tag', '--list', tag])) throw new Error(`${tag} already exists`);
	process.stdout.write(`  ${current} → ${version}\n`);

	say('Running every check');
	run('npm', ['run', 'check']);

	// --- local, and reversible with `git reset --hard` ---------------------------------------

	say('Bumping the version');
	for (const { path, replace } of VERSION_FILES) {
		const file = `${ROOT}${path}`;
		const before = readFileSync(file, 'utf8');
		const after = replace(before, version);
		if (before === after) throw new Error(`nothing to replace in ${path} - has it changed shape?`);
		writeFileSync(file, after);
		process.stdout.write(`  ${path}\n`);
	}
	// Both lockfiles record the version of the packages in this repository, and a lockfile left
	// behind is a diff in the next unrelated commit.
	run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--silent']);
	bumpCargoLock(version);

	say('Writing the release notes');
	const previous = capture('git', ['tag', '--list', 'v*', '--sort=-v:refname']).split('\n')[0];
	const range = previous ? `${previous}..HEAD` : 'HEAD';
	const subjects = capture('git', ['log', range, '--no-merges', '--pretty=%s']).split('\n').filter(Boolean);
	process.stdout.write(`  ${subjects.length} commits since ${previous || 'the beginning'}\n`);

	// **Written, not opened.** An editor in the middle of a release is a prompt that has to be
	// answered before anything else can happen, and the answer is almost always ":wq". The section
	// is a commit-by-commit list; editing it into prose is a thing to do afterwards, in a normal
	// commit, when there is time to write rather than a release waiting.
	prependChangelog(changelogSection(tag, new Date().toISOString().slice(0, 10), subjects));
	process.stdout.write('  CHANGELOG.md written\n');

	if (dryRun) {
		say('Dry run - stopping here');
		process.stdout.write('  the version files and CHANGELOG.md are changed; `git checkout .` undoes it\n');
		return;
	}

	say('Committing and tagging');
	run('git', ['add', '-A']);
	run('git', ['commit', '-m', `chore(release): ${tag}`]);
	run('git', ['tag', '-a', tag, '-m', tag]);

	// --- the only public step ----------------------------------------------------------------

	say('Ready to publish');
	process.stdout.write(
		[
			`  push       ${BRANCH} and ${tag} to origin`,
			`  draft      a hidden release, carrying the notes you just wrote`,
			`  build      .deb, AppImage and two .dmgs, signed for the updater`,
			`  publish    the draft once the manifest verifies, which reaches every installed copy`,
			'',
			'  Everything so far is local. `git reset --hard HEAD~1 && git tag -d ' + tag + '` undoes it.',
			''
		].join('\n')
	);
	if (!(await confirm('  Go ahead? [y/N] '))) {
		process.stdout.write('\n  Stopped. Nothing was pushed.\n');
		return;
	}

	say('Pushing');
	run('git', ['push', 'origin', BRANCH]);
	run('git', ['push', 'origin', tag]);

	say('Waiting for the build');
	process.stdout.write('  this takes up to an hour on a cold cache - GDAL is built from source\n');
	// Give the tag push a moment to become a run; `gh run list` on a ref that has none is an empty
	// answer rather than an error, and would otherwise look like a finished build.
	await new Promise((resolve) => setTimeout(resolve, 10_000));
	const runId = capture('gh', [
		'run',
		'list',
		'--workflow=release.yml',
		`--branch=${tag}`,
		'--limit=1',
		'--json=databaseId',
		'--jq=.[0].databaseId'
	]);
	if (!runId) {
		throw new Error(`no release run for ${tag} - check the Actions tab; the tag is pushed, so re-run it there`);
	}
	await watch(runId);

	// **Published by the workflow, not from here.** It publishes once it has verified that every URL
	// in `latest.json` names an asset that exists - a better gate than this script being the only
	// route, which left a hand-pushed tag stopping at a draft nobody was told about.
	process.stdout.write(`  https://github.com/versatiles-org/versatiles-studio/releases/tag/${tag}\n`);

	say('The Homebrew cask');
	// Updated by the tap, not from here: `release.yml` triggers `update_cask.yml` in
	// versatiles-org/homebrew-versatiles once the release is published, and `bin/make_cask.sh` over
	// there reads the assets that now exist. A copy of the cask in this repository was a second thing
	// to keep in step, and it fell out of step three times while the naming was being settled.
	process.stdout.write('  versatiles-org/homebrew-versatiles updates itself from the published release\n\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error: unknown) => {
		process.stderr.write(`\n\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\n`);
		process.exitCode = 1;
	});
}
