/**
 * What a copied report says.
 *
 * The redaction especially: this text is written to be pasted into a public issue tracker, and
 * every path Studio reports is a path somebody chose - on all three platforms the home directory
 * carries their account name. A test is the only thing standing between that and a paste.
 */

import { describe, expect, it } from 'vitest';
import type { Environment, Problem } from '../ipc/commands';
import { buildReport, fenced, issueUrl, type Local } from './report';

const REPO = 'https://github.com/versatiles-org/versatiles-studio';

const AT = new Date('2026-08-25T12:00:00.000Z');

const LOCAL: Local = { userAgent: 'Studio/0.2 WebKit/620', renderer: 'Apple M2 Pro' };

const WHERE: Environment = {
	appVersion: '0.2.0',
	os: 'macos',
	arch: 'aarch64',
	webview: '620.1.2',
	home: '/Users/anna',
	log: '/Users/anna/Library/Logs/org.versatiles.studio/problems.jsonl'
};

function problem(over: Partial<Problem> = {}): Problem {
	return {
		id: 1,
		at: 1_787_000_000,
		level: 'error',
		origin: 'webview',
		message: 'could not open berlin.mbtiles',
		detail: null,
		count: 1,
		...over
	};
}

const report = (problems: Problem[], environment: Environment | null = WHERE) =>
	buildReport({ problems, environment, local: LOCAL, at: AT });

describe('the issue a report can open', () => {
	it('opens with somewhere to say what you were doing', () => {
		const body = decodeURIComponent(issueUrl(REPO, 'the report').split('?body=')[1]);
		// A wall of diagnostics with no prompt gets no answer to the one question the report cannot
		// answer for itself - and the prompt stays outside the fence, or the first thing anybody does
		// is type into a code block.
		expect(body.startsWith('_What were you doing when this happened?_')).toBe(true);
		expect(body).toContain('the report');
		expect(body.indexOf('_What were you doing')).toBeLessThan(body.indexOf('```'));
	});

	it('points at the repository, and nowhere else', () => {
		// The capability scopes the opener to this one host; a URL outside it simply would not open.
		expect(issueUrl(REPO, 'x').startsWith(`${REPO}/issues/new?body=`)).toBe(true);
	});

	/** Browsers and servers both stop somewhere around eight kilobytes, and neither promises where. */
	it('keeps a long report inside what a URL will carry', () => {
		const huge = Array.from({ length: 400 }, (_, index) => `problem ${index}: something went wrong`).join('\n');
		expect(issueUrl(REPO, huge).length).toBeLessThan(7000);
	});

	it('says that it truncated, and where the rest is', () => {
		const body = decodeURIComponent(issueUrl(REPO, 'x'.repeat(40_000)).split('?body=')[1]);
		// Silently dropping the tail would leave the reader concluding things from an absence this
		// function invented - and not knowing the whole of it is already on the clipboard.
		expect(body).toContain('did not fit in a link');
		expect(body).toContain('on your clipboard');
	});

	/**
	 * Cutting the finished body would take the closing fence with it, and everything the reporter
	 * then typed into the issue would be swallowed by the open code block.
	 */
	it('still closes its fence when it had to truncate', () => {
		const body = decodeURIComponent(issueUrl(REPO, 'x'.repeat(40_000)).split('?body=')[1]);
		const fences = body.match(/^`{3,}/gm) ?? [];
		expect(fences).toHaveLength(2);
		expect(body.trimEnd().endsWith(fences[0] ?? '')).toBe(true);
	});

	it('leaves a report that fits exactly as it was', () => {
		const body = decodeURIComponent(issueUrl(REPO, 'one small problem').split('?body=')[1]);
		expect(body).not.toContain('did not fit');
		expect(body).toContain('one small problem');
	});
});

/**
 * **The text in a report is not ours.** Paths, layer names, VPL fragments and upstream error strings
 * all end up in it, and rendering them as Markdown is how a report pings a stranger or quietly loses
 * half of itself.
 */
describe('the fence around a report', () => {
	it('keeps an @name from reaching whoever owns it on GitHub', () => {
		const text = fenced('could not read sftp://anna@fileserver/maps');
		expect(text.startsWith('```text\n')).toBe(true);
		expect(text.endsWith('\n```')).toBe(true);
	});

	/** The one way a fence is worse than escaping, if it is not guarded. */
	it('cannot be broken out of by a stack that carries its own fence', () => {
		const nasty = 'before\n```\nout\n```\nafter';
		const text = fenced(nasty);
		const opening = text.slice(0, text.indexOf('text'));
		expect(opening.length).toBeGreaterThan(3);
		// No run of backticks inside can close a fence this long, which is what CommonMark requires.
		const runs = [...nasty.matchAll(/`+/g)].map((run) => run[0].length);
		expect(Math.max(...runs)).toBeLessThan(opening.length);
	});

	it('stays at three backticks for ordinary text', () => {
		expect(fenced('nothing special').startsWith('```text')).toBe(true);
	});
});

describe('the report a user pastes into an issue', () => {
	it('names the build, the platform and the hardware on one line', () => {
		const text = report([problem()]);
		expect(text).toContain('Studio 0.2.0');
		expect(text).toContain('macos aarch64');
		expect(text).toContain('webview 620.1.2');
		// Half of all map bugs are driver bugs, and the report that omits this costs a day of trying
		// to reproduce them on the wrong hardware.
		expect(text).toContain('Apple M2 Pro');
		expect(text).toContain('2026-08-25T12:00:00.000Z');
	});

	it('says what it cannot answer rather than leaving a blank', () => {
		const text = report([problem()], null);
		expect(text).toContain('Studio unknown');
		expect(text).toContain('unknown platform');
	});

	it('carries the message and the detail of each problem', () => {
		const text = report([problem({ detail: 'Error: could not open\n    at open (ipc.ts:20)' })]);
		expect(text).toContain('could not open berlin.mbtiles');
		expect(text).toContain('at open (ipc.ts:20)');
		expect(text).toContain('error · webview');
	});

	it('says how many times something happened rather than repeating it', () => {
		expect(report([problem({ count: 412 })])).toContain('412 ×');
	});

	/**
	 * The volume this exists for. The core folds only exact repeats, so a 404 per tile is one entry
	 * per tile - a thousand of them, differing by a coordinate. Grouping on the shape says the same
	 * thing in one line, and says it better.
	 */
	it('folds problems that differ only in the tile they are about', () => {
		const many = Array.from({ length: 300 }, (_, index) =>
			problem({ id: index, at: 1_787_000_000 + index, message: `HTTP 404 for tile 12/2200/${index}` })
		);
		const text = report(many);
		expect(text).toContain('300 ×');
		expect(text).toContain('z/x/y');
		// The status code is the answer, not noise - only long runs of digits are shapes.
		expect(text).toContain('404');
		expect(text).not.toContain('2200/17');
	});

	it('keeps a message as it was when nothing varied', () => {
		expect(report([problem({ count: 3 })])).toContain('could not open berlin.mbtiles');
	});

	/**
	 * Every cut here keeps a prefix, and the core hands problems over oldest first - so the report
	 * used to drop the newest and keep the ones from start-up. The newest is the one being reported.
	 */
	it('puts the newest first, so what gets left out is the oldest', () => {
		const text = report([
			problem({ id: 1, at: 1_787_000_000, message: 'the oldest thing' }),
			problem({ id: 2, at: 1_787_000_900, message: 'the newest thing' })
		]);
		expect(text.indexOf('the newest thing')).toBeLessThan(text.indexOf('the oldest thing'));
	});

	/** The whole reason `home` crosses the IPC boundary. */
	it('replaces the home directory with a tilde, wherever it appears', () => {
		const text = report([
			problem({
				message: 'could not open /Users/anna/maps/berlin.mbtiles',
				detail: 'tried /Users/Anna/maps and /Users/anna/other'
			})
		]);

		expect(text).toContain('~/maps/berlin.mbtiles');
		// Case-insensitively: macOS and Windows filesystems are, so a path can come back in a case
		// the home directory was not spelled in.
		expect(text).toContain('~/maps and ~/other');
		expect(text).not.toContain('anna');
		expect(text).not.toContain('Anna');
	});

	/**
	 * `~` was never the whole of it. An external drive names a customer in its path, and a signed URL
	 * carries a credential outright - both straight into a public tracker.
	 */
	it('takes the credentials out of a URL', () => {
		const text = report([problem({ message: 'could not read https://anna:hunter2@tiles.example/osm' })]);
		expect(text).not.toContain('hunter2');
		expect(text).not.toContain('anna');
		expect(text).toContain('https://tiles.example/osm');
	});

	it('takes the query string out of a URL', () => {
		const text = report([
			problem({ message: 'GET https://s3.example/berlin.pmtiles?X-Amz-Signature=deadbeef failed' })
		]);
		expect(text).not.toContain('deadbeef');
		expect(text).not.toContain('X-Amz');
		expect(text).toContain('https://s3.example/berlin.pmtiles?…');
	});

	it('shortens an absolute path that is nobody’s home', () => {
		const text = report([problem({ message: 'could not open /Volumes/tender-2026/berlin.mbtiles' })]);
		expect(text).not.toContain('tender-2026');
		expect(text).toContain('…/berlin.mbtiles');
	});

	it('shortens the Windows spelling too', () => {
		const text = report([problem({ message: 'could not open D:\\clients\\acme\\berlin.mbtiles' })]);
		expect(text).not.toContain('acme');
		expect(text).toContain('berlin.mbtiles');
	});

	it('says what it took out, so nobody debugs a URL that is not the one that failed', () => {
		const text = report([problem()]);
		expect(text).toContain('query strings removed');
	});

	/**
	 * The two read identically and mean opposite things: a previous-session report describes a run
	 * that is over - very likely the one that crashed - while the environment above it is this run's,
	 * because that is the only one anybody can still ask.
	 */
	it('says when it is describing a run that is already over', () => {
		const text = buildReport({
			problems: [problem()],
			environment: WHERE,
			local: LOCAL,
			at: AT,
			session: 'previous'
		});
		expect(text).toContain('in the previous session');
		expect(text).toContain('recorded by an earlier run');
	});

	it('is worth copying even when nothing has gone wrong', () => {
		expect(report([])).toContain('Nothing has gone wrong this session.');
	});

	/**
	 * **Truncated loudly.** A report that silently dropped the tail would read as complete, and its
	 * reader would draw conclusions from an absence that the reporting code invented.
	 */
	it('says so when it leaves kinds out', () => {
		const many = Array.from({ length: 80 }, (_, index) =>
			problem({ id: index, at: 1_787_000_000 + index, message: `problem ${String.fromCharCode(65 + index)}` })
		);
		const text = report(many);
		expect(text).toContain('other kinds, not listed');
	});

	/** A stack is answered near its top or not at all, and the rest is the runtime's own frames. */
	it('keeps the top of a long stack and says how much it left', () => {
		const stack = Array.from({ length: 40 }, (_, index) => `    at frame${index} (x.ts:${index})`).join('\n');
		const text = report([problem({ detail: stack })]);
		expect(text).toContain('at frame0');
		expect(text).not.toContain('at frame30');
		expect(text).toContain('28 more lines');
	});

	// The link and the clipboard carry different reports rather than the same one cut short.
	it('leaves the details out of the brief form', () => {
		const input = {
			problems: [problem({ detail: 'a stack nobody needs in a URL' })],
			environment: WHERE,
			local: LOCAL,
			at: AT
		};
		expect(buildReport({ ...input, brief: true })).not.toContain('a stack nobody needs');
		expect(buildReport(input)).toContain('a stack nobody needs');
	});
});
