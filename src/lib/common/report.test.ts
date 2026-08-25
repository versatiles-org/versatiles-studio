/**
 * What a copied report says.
 *
 * The redaction especially: this text is written to be pasted into a public issue tracker, and
 * every path Studio reports is a path somebody chose — on all three platforms the home directory
 * carries their account name. A test is the only thing standing between that and a paste.
 */

import { describe, expect, it } from 'vitest';
import type { Environment, Problem } from '../ipc/commands';
import { buildReport, type Local } from './report';

const AT = new Date('2026-08-25T12:00:00.000Z');

const LOCAL: Local = { userAgent: 'Studio/0.2 WebKit/620', renderer: 'Apple M2 Pro' };

const WHERE: Environment = {
	appVersion: '0.2.0',
	os: 'macos',
	arch: 'aarch64',
	webview: '620.1.2',
	home: '/Users/anna'
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

describe('the report a user pastes into an issue', () => {
	it('names the build, the platform and the hardware', () => {
		const text = report([problem()]);
		expect(text).toContain('- Version: 0.2.0');
		expect(text).toContain('- Platform: macos aarch64');
		expect(text).toContain('- Webview: 620.1.2');
		// Half of all map bugs are driver bugs, and the report that omits this costs a day of trying
		// to reproduce them on the wrong hardware.
		expect(text).toContain('- GPU: Apple M2 Pro');
		expect(text).toContain('- Reported: 2026-08-25T12:00:00.000Z');
	});

	it('says what it cannot answer rather than leaving a blank', () => {
		const text = report([problem()], null);
		expect(text).toContain('- Version: unknown');
		expect(text).toContain('- Platform: unknown');
	});

	it('carries the message and the detail of each problem', () => {
		const text = report([problem({ detail: 'Error: could not open\n    at open (ipc.ts:20)' })]);
		expect(text).toContain('could not open berlin.mbtiles');
		expect(text).toContain('at open (ipc.ts:20)');
		expect(text).toContain('### error · webview');
	});

	it('says how many times something happened rather than repeating it', () => {
		expect(report([problem({ count: 412 })])).toContain('×412');
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

	it('leaves paths alone when there is no home to redact', () => {
		const text = report([problem({ message: 'could not open /srv/tiles/berlin.mbtiles' })], {
			...WHERE,
			home: null
		});
		expect(text).toContain('/srv/tiles/berlin.mbtiles');
	});

	/** A home of `/` would otherwise turn every path in the report into a row of tildes. */
	it('refuses a home too short to mean anything', () => {
		const text = report([problem({ message: 'could not open /srv/tiles' })], { ...WHERE, home: '/' });
		expect(text).toContain('/srv/tiles');
	});

	it('is worth copying even when nothing has gone wrong', () => {
		const text = report([]);
		expect(text).toContain('## Problems (0)');
		expect(text).toContain('Nothing has gone wrong this session.');
	});

	/**
	 * **Truncated loudly.** A report that silently dropped the tail would read as complete, and its
	 * reader would draw conclusions from an absence that the reporting code invented.
	 */
	it('says so when it leaves problems out', () => {
		const many = Array.from({ length: 130 }, (_, index) => problem({ id: index, message: `problem ${index}` }));
		const text = report(many);
		expect(text).toContain('## Problems (130)');
		expect(text).toContain('problem 99');
		expect(text).not.toContain('problem 100');
		expect(text).toContain('30 older problems, not included');
	});
});
