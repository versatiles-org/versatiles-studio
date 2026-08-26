/**
 * The text a user copies out of the problems panel (S6.8).
 *
 * **A list of errors is not a bug report.** Half of what makes one actionable is what the person
 * pasting it should not have to assemble: which build, which platform, which webview, which GPU -
 * and a plain rendering of the browser's own error is none of those. This composes both halves into
 * something that can be pasted into an issue as it stands.
 *
 * **A pure function**, and here rather than in the panel, because what a report *says* is the part
 * worth testing: the redaction especially, which is the difference between a helpful paste and one
 * carrying somebody's name to a public tracker.
 *
 * Nothing is ever sent anywhere. The report is text, on a clipboard, under the eye of the person
 * who chose to copy it - which is also why it needs no consent screen and collects no telemetry.
 */

import type { Environment, Problem } from '../ipc/commands';

/** What the webview knows about itself, which the core cannot answer for it. */
export interface Local {
	/** `navigator.userAgent` - which engine, at which version. */
	userAgent: string;
	/**
	 * The GPU, as WebGL will admit to it.
	 *
	 * Worth the awkwardness of asking: a good half of map rendering bugs are driver bugs, and a
	 * report that omits this leads to a day of trying to reproduce them on the wrong hardware.
	 */
	renderer: string | null;
}

/** How many folded groups a report lists before it starts summarising instead. */
const LIMIT = 50;

/** How many groups carry their full detail. The rest are a line each. */
const DETAILS = 3;

/** How much of a stack is worth reading. The answer is near the top or it is not in there. */
const FRAMES = 12;

/**
 * The report, as plain text.
 *
 * **Plain, and fenced by whoever renders it.** This used to be Markdown, which meant the text
 * *inside* it - paths, layer names, upstream error strings - was parsed as Markdown too. An `sftp://
 * anna@fileserver/…` in a failed source pinged whoever owns that GitHub name, a `#4` cross-posted
 * the report onto someone else's issue, and a TileJSON attribution string (`<a href=…>`) rendered as
 * a link. `fenced` closes all of that at once, and does it without having to be right about escaping
 * one character at a time.
 *
 * **Folded, newest first, and short.** A session that answers a thousand tiles records a thousand
 * problems; the core folds only exact repeats, so a 404 per tile is a thousand distinct entries with
 * a different coordinate in each. Grouping on the *shape* of a message turns that into one line
 * saying ×1000 - which is both shorter and more use than the first hundred of them.
 */
export function buildReport(input: {
	problems: Problem[];
	environment: Environment | null;
	local: Local;
	/** When the report was made. Passed in rather than read, so the output is a pure function. */
	at: Date;
	/**
	 * Which run these problems are from.
	 *
	 * **Said out loud, because the two read identically and mean opposite things.** A report from
	 * the previous session describes a run that is over - very likely one that crashed - so its
	 * problems are not evidence about the build the reader is looking at unless they know that.
	 */
	session?: 'this' | 'previous';
	/**
	 * Leaves out the details, for the copy that has to fit in a URL.
	 *
	 * The link and the clipboard carry different reports rather than the same one cut short: a
	 * prefix keeps whatever happened to be at the top, which is the least useful half.
	 */
	brief?: boolean;
}): string {
	const { problems, environment, local, at, session = 'this', brief = false } = input;
	const hide = redactor(environment?.home ?? null);

	const lines = [
		[
			`Studio ${environment?.appVersion ?? 'unknown'}`,
			environment ? `${environment.os} ${environment.arch}` : 'unknown platform',
			`webview ${environment?.webview ?? 'unknown'}`,
			local.renderer ?? 'unknown GPU',
			at.toISOString()
		].join(' · '),
		''
	];

	const groups = fold(problems, hide);
	const total = groups.reduce((sum, group) => sum + group.count, 0);
	const when = session === 'previous' ? 'in the previous session' : 'this session';

	if (groups.length === 0) {
		lines.push(session === 'previous' ? 'That run recorded nothing.' : 'Nothing has gone wrong this session.');
		return `${lines.join('\n')}\n`;
	}

	lines.push(
		`${total} problem${total === 1 ? '' : 's'} ${when}, in ${groups.length} kind${groups.length === 1 ? '' : 's'}:`,
		''
	);

	// The environment above is *this* run's, which is the only one anybody can still ask. Saying so
	// is the difference between a caveat and a wrong fact.
	if (session === 'previous') lines.push('(recorded by an earlier run; the line above is the current one)', '');

	const shown = groups.slice(0, LIMIT);
	const width = Math.max(...shown.map((group) => String(group.count).length));
	for (const group of shown) lines.push(row(group, width));

	// **Truncated loudly.** A report that silently dropped the tail would read as complete, and the
	// reader would draw conclusions from an absence that is this function's doing.
	if (groups.length > LIMIT) lines.push(`  … and ${groups.length - LIMIT} other kinds, not listed.`);

	if (!brief) {
		for (const group of shown.filter((candidate) => candidate.detail).slice(0, DETAILS)) {
			lines.push('', `--- ${group.level} · ${group.origin} ---`, trim(group.detail!));
		}
		const withheld = shown.filter((candidate) => candidate.detail).length - DETAILS;
		if (withheld > 0) lines.push('', `(${withheld} more with detail, not included)`);
	}

	lines.push('', redactionNote(environment?.home ?? null));
	return `${lines.join('\n')}\n`;
}

/** One group as a line: how many, how bad, from where, when last, and what it said. */
function row(group: Group, width: number): string {
	const count = `${String(group.count).padStart(width)} ×`;
	const time = new Date(group.at * 1000).toISOString().slice(11, 19);
	return `  ${count}  ${group.level.padEnd(5)}  ${group.origin.padEnd(7)}  ${time}  ${group.message}`;
}

/** The top of a stack. What is below `FRAMES` is the runtime's own frames far more often than not. */
function trim(detail: string): string {
	const lines = detail.split('\n');
	if (lines.length <= FRAMES) return detail;
	return [...lines.slice(0, FRAMES), `    … ${lines.length - FRAMES} more lines`].join('\n');
}

interface Group {
	level: string;
	origin: string;
	message: string;
	detail: string | null;
	count: number;
	/** The newest occurrence, because that is the one someone is reporting. */
	at: number;
}

/**
 * Problems grouped by the shape of what they said, newest first.
 *
 * **Newest first is a fix, not a preference.** The core hands these over oldest first, and every cut
 * this file makes keeps a prefix - so the report used to drop the newest problems and keep the ones
 * from start-up. The newest is the one the person is writing about.
 */
function fold(problems: Problem[], hide: (text: string) => string): Group[] {
	const groups = new Map<string, Group & { messages: Set<string> }>();

	for (const problem of problems) {
		const message = hide(problem.message);
		const shape = normalize(message);
		const key = `${problem.level}\u0000${problem.origin}\u0000${shape}`;
		const seen = groups.get(key);
		if (seen) {
			seen.count += problem.count;
			seen.messages.add(message);
			if (problem.at >= seen.at) {
				seen.at = problem.at;
				seen.detail = problem.detail ? hide(problem.detail) : seen.detail;
			}
			continue;
		}
		groups.set(key, {
			level: problem.level,
			origin: problem.origin,
			message,
			messages: new Set([message]),
			detail: problem.detail ? hide(problem.detail) : null,
			count: problem.count,
			at: problem.at
		});
	}

	return [...groups.values()]
		.map((group) => ({
			...group,
			// One message when they all said the same thing; the shape when they did not, because
			// showing one of a thousand implies a specificity the line does not have.
			message: group.messages.size === 1 ? group.message : normalize(group.message)
		}))
		.sort((a, b) => b.at - a.at || b.count - a.count);
}

/**
 * What a message is, with what varied taken out.
 *
 * Tile coordinates first, since a tile per problem is the volume this exists for. Then long runs of
 * digits - ids, offsets, byte counts - but not short ones: `404` is the answer, not noise.
 */
function normalize(message: string): string {
	return message
		.replace(/\b\d+\/\d+\/\d+\b/g, 'z/x/y')
		.replace(/\b\d{4,}\b/g, 'N')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Says what was taken out, so nobody debugs a URL that is not the one that failed. */
function redactionNote(home: string | null): string {
	const parts = ['URL credentials and query strings removed', 'paths shortened'];
	if (home) parts.unshift('home directory shown as ~');
	return `(${parts.join(', ')})`;
}

/**
 * Replaces the user's home directory with `~` wherever it appears.
 *
 * **Every path Studio reports is a path somebody chose**, and on all three platforms the home
 * directory carries their account name - often their real one. Redacting it costs nothing that a
 * reader of the report needed: `~/maps/berlin.mbtiles` says everything `/Users/anna/maps/…` did.
 *
 * Case-insensitively on Windows and macOS, whose filesystems are, and where a path can therefore
 * come back from an API in a case the home directory was not spelled in.
 */
function redactor(home: string | null): (text: string) => string {
	if (!home) return (text) => text;
	// Trailing separators trimmed so `/Users/anna/` and `/Users/anna` both match - and a home of `/`
	// is ignored rather than replacing every slash in the report with a tilde.
	const trimmed = home.replace(/[/\\]+$/, '');
	if (trimmed.length < 2) return (text) => text;
	const pattern = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
	return (text) => shorten(text.replace(pattern, '~'));
}

/**
 * What is left of a path or a URL once the parts that identify somebody are gone.
 *
 * **A home directory was never the whole of it.** `~` covers the common case and misses every other
 * way a name reaches a report: an external drive (`/Volumes/Acme Client/2026 tender/…` names a
 * customer), a network share, an `ssh_identity=` in a pipeline. And the sharpest of them is not a
 * path at all - `from_container` takes remote URLs, so a signed one (`?X-Amz-Signature=…`) or a
 * `user:pass@host` can reach an error message and from there a public tracker.
 *
 * Run after the home replacement, so a path already reduced to `~/…` is left alone.
 */
function shorten(text: string): string {
	return (
		text
			// Credentials in a URL, which are the thing that must never travel.
			.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1')
			// And the query, which is where a signature or a token rides.
			.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#]*)\?[^\s#]*/gi, '$1?…')
			// Whatever absolute path is left: the basename is all a reader needed.
			//
			// Not after `~`, a word character, `:` or `/` - which is what keeps it off a URL that the
			// two rules above have already dealt with. Without the last two, `https://host/a/b` had
			// its own path shortened to `https:/…/b`, mangling the one thing a reader needs to
			// recognise the request.
			.replace(/(?<![\w~:/])(?:\/[\w.-]+){2,}/g, (path) => `…/${path.slice(path.lastIndexOf('/') + 1)}`)
			// The Windows spelling of the same thing.
			.replace(/(?<![\w])[A-Za-z]:\\(?:[\w.-]+\\)+([\w.-]+)/g, '…\\$1')
	);
}

/**
 * How much of a report fits in a URL.
 *
 * Browsers and servers both stop somewhere around eight kilobytes, and the number is nobody's
 * promise - so this stays well under it. Percent-encoding is what is measured, since a report is
 * mostly newlines and punctuation and inflates by roughly three times on the way into a query.
 */
const URL_LIMIT = 6000;

/**
 * What is said in place of the part that did not fit.
 *
 * Plain, because it is now inside the fence with everything else.
 */
const TRIMMED = '\n\n… the rest did not fit in a link. The whole report is on your clipboard - paste it here.';

/**
 * A report in a fence, so nothing in it is read as Markdown.
 *
 * **The opening fence is longer than any run of backticks inside it.** A detail carrying its own
 * ``` would otherwise close the block early and let the rest out - which is the one way this is
 * worse than escaping. CommonMark requires the closing fence to be at least as long as the opening
 * one and forbids a line inside from matching it, so one more backtick than the longest run is
 * exact rather than a guess.
 */
export function fenced(report: string): string {
	const longest = Math.max(0, ...[...report.matchAll(/`+/g)].map((run) => run[0].length));
	const fence = '`'.repeat(Math.max(3, longest + 1));
	return `${fence}text\n${report}\n${fence}`;
}

/**
 * A prefilled issue on the repository, carrying as much of the report as a URL will hold.
 *
 * **The prompt comes first, and empty.** What the report cannot say is what the person was doing,
 * and an issue that opens with somewhere to write it gets an answer far more often than one that
 * opens with a wall of diagnostics.
 *
 * **Truncated out loud, and never silently**: the note says the rest is on the clipboard, which is
 * why copying happens before this is opened rather than as an alternative to it.
 */
export function issueUrl(repository: string, report: string): string {
	return `${repository}/issues/new?body=${encodeURIComponent(fit(report))}`;
}

/** The prompt, then the report in a fence. */
function wrap(report: string): string {
	return `_What were you doing when this happened?_\n\n---\n\n${fenced(report)}`;
}

/**
 * The longest prefix of the report that leaves room for the note, cut at a line rather than a word.
 *
 * **The report is trimmed, not the body.** Cutting the finished body would take the closing fence
 * with it and leave the issue holding an unterminated code block - everything typed after it in that
 * box would be swallowed by the fence.
 */
function fit(report: string): string {
	if (encodeURIComponent(wrap(report)).length <= URL_LIMIT) return wrap(report);

	let kept = report;
	// Ninety per cent at a time: a handful of passes on any real report, and no arithmetic that has
	// to be right about how many bytes a character becomes.
	while (kept.length > 0 && encodeURIComponent(wrap(kept + TRIMMED)).length > URL_LIMIT) {
		kept = kept.slice(0, Math.floor(kept.length * 0.9));
	}
	return wrap(kept.slice(0, Math.max(kept.lastIndexOf('\n'), 0)) + TRIMMED);
}

/**
 * Asks WebGL what it is drawing with.
 *
 * `WEBGL_debug_renderer_info` is the only way to a real answer, and it is absent in some browsers by
 * design - hence `null` rather than a guess. The context is created and dropped here: holding one
 * costs a GPU context, and this is called once, when a report is copied.
 */
export function gpuRenderer(canvas: HTMLCanvasElement): string | null {
	try {
		const gl = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
		if (!(gl instanceof WebGLRenderingContext)) return null;
		const info = gl.getExtension('WEBGL_debug_renderer_info');
		if (!info) return null;
		const renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as unknown;
		return typeof renderer === 'string' ? renderer : null;
	} catch {
		// A context can be refused outright - a machine with no GPU left to give, or a policy that
		// blocks WebGL. Neither is worth failing a report over.
		return null;
	}
}
