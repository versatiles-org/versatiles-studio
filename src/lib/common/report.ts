/**
 * The text a user copies out of the problems panel (S6.8).
 *
 * **A list of errors is not a bug report.** Half of what makes one actionable is what the person
 * pasting it should not have to assemble: which build, which platform, which webview, which GPU —
 * and a plain rendering of the browser's own error is none of those. This composes both halves into
 * something that can be pasted into an issue as it stands.
 *
 * **A pure function**, and here rather than in the panel, because what a report *says* is the part
 * worth testing: the redaction especially, which is the difference between a helpful paste and one
 * carrying somebody's name to a public tracker.
 *
 * Nothing is ever sent anywhere. The report is text, on a clipboard, under the eye of the person
 * who chose to copy it — which is also why it needs no consent screen and collects no telemetry.
 */

import type { Environment, Problem } from '../ipc/commands';

/** What the webview knows about itself, which the core cannot answer for it. */
export interface Local {
	/** `navigator.userAgent` — which engine, at which version. */
	userAgent: string;
	/**
	 * The GPU, as WebGL will admit to it.
	 *
	 * Worth the awkwardness of asking: a good half of map rendering bugs are driver bugs, and a
	 * report that omits this leads to a day of trying to reproduce them on the wrong hardware.
	 */
	renderer: string | null;
}

/** How many problems a report carries before it starts summarising instead. */
const LIMIT = 100;

/**
 * The report, as Markdown.
 *
 * Markdown because every place this is going — a GitHub issue, a chat, an email to the person who
 * wrote the pipeline — renders it, and the one place that does not still reads as plain text.
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
	 * the previous session describes a run that is over — very likely one that crashed — so its
	 * problems are not evidence about the build the reader is looking at unless they know that.
	 */
	session?: 'this' | 'previous';
}): string {
	const { problems, environment, local, at, session = 'this' } = input;
	const hide = redactor(environment?.home ?? null);

	const lines = [
		'## VersaTiles Studio — problem report',
		'',
		`- Reported: ${at.toISOString()}`,
		`- Version: ${environment?.appVersion ?? 'unknown'}`,
		`- Platform: ${environment ? `${environment.os} ${environment.arch}` : 'unknown'}`,
		`- Webview: ${environment?.webview ?? 'unknown'}`,
		`- GPU: ${local.renderer ?? 'unknown'}`,
		`- User agent: ${local.userAgent}`,
		'',
		session === 'previous'
			? `## Problems from the previous session (${problems.length})`
			: `## Problems (${problems.length})`,
		''
	];

	if (session === 'previous') {
		// The environment above is *this* run's, which is the only one anybody can still ask. Saying
		// so is the difference between a caveat and a wrong fact.
		lines.push('_Recorded by an earlier run of Studio. The environment above is the current one._', '');
	}

	if (problems.length === 0) {
		lines.push(session === 'previous' ? 'That run recorded no problems.' : 'Nothing has gone wrong this session.');
		return `${lines.join('\n')}\n`;
	}

	// **Truncated loudly.** A report that silently dropped the tail would read as complete, and the
	// reader would draw conclusions from an absence that is this function's doing.
	for (const problem of problems.slice(0, LIMIT)) lines.push(...describe(problem, hide));
	if (problems.length > LIMIT) {
		lines.push(`_… and ${problems.length - LIMIT} older problems, not included._`, '');
	}

	return `${lines.join('\n')}\n`;
}

/** One problem: its headline, then whatever detail it carried, fenced so a stack keeps its shape. */
function describe(problem: Problem, hide: (text: string) => string): string[] {
	const when = new Date(problem.at * 1000).toISOString();
	const repeats = problem.count > 1 ? ` ×${problem.count}` : '';
	const lines = [
		`### ${problem.level} · ${problem.origin}${repeats}`,
		'',
		`- When: ${when}`,
		`- ${hide(problem.message)}`
	];
	if (problem.detail) lines.push('', '```', hide(problem.detail), '```');
	lines.push('');
	return lines;
}

/**
 * Replaces the user's home directory with `~` wherever it appears.
 *
 * **Every path Studio reports is a path somebody chose**, and on all three platforms the home
 * directory carries their account name — often their real one. Redacting it costs nothing that a
 * reader of the report needed: `~/maps/berlin.mbtiles` says everything `/Users/anna/maps/…` did.
 *
 * Case-insensitively on Windows and macOS, whose filesystems are, and where a path can therefore
 * come back from an API in a case the home directory was not spelled in.
 */
function redactor(home: string | null): (text: string) => string {
	if (!home) return (text) => text;
	// Trailing separators trimmed so `/Users/anna/` and `/Users/anna` both match — and a home of `/`
	// is ignored rather than replacing every slash in the report with a tilde.
	const trimmed = home.replace(/[/\\]+$/, '');
	if (trimmed.length < 2) return (text) => text;
	const pattern = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
	return (text) => text.replace(pattern, '~');
}

/**
 * How much of a report fits in a URL.
 *
 * Browsers and servers both stop somewhere around eight kilobytes, and the number is nobody's
 * promise — so this stays well under it. Percent-encoding is what is measured, since a report is
 * mostly newlines and punctuation and inflates by roughly three times on the way into a query.
 */
const URL_LIMIT = 6000;

/** What is said in place of the part that did not fit. */
const TRIMMED = '\n\n_The rest of this report did not fit in a link. It is on your clipboard — paste it here._';

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
	const body = `_What were you doing when this happened?_\n\n---\n\n${report}`;
	return `${repository}/issues/new?body=${encodeURIComponent(fit(body))}`;
}

/** The longest prefix of `body` that leaves room for the note, cut at a line rather than a word. */
function fit(body: string): string {
	if (encodeURIComponent(body).length <= URL_LIMIT) return body;

	let kept = body;
	// Ninety per cent at a time: a handful of passes on any real report, and no arithmetic that has
	// to be right about how many bytes a character becomes.
	while (kept.length > 0 && encodeURIComponent(kept + TRIMMED).length > URL_LIMIT) {
		kept = kept.slice(0, Math.floor(kept.length * 0.9));
	}
	return kept.slice(0, Math.max(kept.lastIndexOf('\n'), 0)) + TRIMMED;
}

/**
 * Asks WebGL what it is drawing with.
 *
 * `WEBGL_debug_renderer_info` is the only way to a real answer, and it is absent in some browsers by
 * design — hence `null` rather than a guess. The context is created and dropped here: holding one
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
		// A context can be refused outright — a machine with no GPU left to give, or a policy that
		// blocks WebGL. Neither is worth failing a report over.
		return null;
	}
}
