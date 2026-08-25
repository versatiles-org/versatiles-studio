/**
 * Which command failed, attached to the failure itself (S6.8).
 *
 * **A core error arrives as a bare sentence.** `Result<T, String>` is the whole convention, so
 * "no such file" reaches the webview with nothing around it — no stack, because it did not happen
 * here, and no name, because the string is all the core sent. In the status bar that is exactly
 * right; in a problem report an hour later it is a sentence with nowhere to put it, and the one
 * fact that would locate it — which of sixty-odd commands was being called — is known at the call
 * and thrown away one line later.
 *
 * **Named by a proxy rather than by sixty call sites.** `commands.ts` wraps each generated function
 * by hand already, and passing a name through each of those wrappers would be sixty chances to
 * paste the wrong one and no way to notice. The key the proxy was asked for *is* the name, so a
 * command added next year is named without anyone remembering to.
 *
 * **`unwrap` is untouched**, and still throws what arrived: by the time it sees the outcome, the
 * name is already part of it. The one place that decides how an error becomes text stays the one
 * place.
 */

/**
 * A command that answered with an error, and which command it was.
 *
 * `message` is the core's sentence and nothing else, so everything that shows an error to a person
 * — the status bar, above all — reads exactly as it did before this existed.
 */
export class CommandFailed extends Error {
	/** The name as the webview calls it: `saveProject`, not `save_project`. */
	readonly command: string;

	constructor(command: string, reason: unknown) {
		super(text(reason));
		this.name = 'CommandFailed';
		this.command = command;
		// The original, for anything that wants more than the sentence. `cause` rather than a field
		// of our own, because that is where the language decided this goes.
		this.cause = reason;
	}
}

/** What an error from the core says, whether it came as a string or as something with a message. */
function text(reason: unknown): string {
	if (typeof reason === 'string') return reason;
	if (typeof reason === 'object' && reason !== null && 'message' in reason) {
		return String((reason as { message: unknown }).message);
	}
	return String(reason);
}

/** The `{ status: 'error' }` half of the generated convention, before `unwrap` turns it into a throw. */
interface Failed {
	status: 'error';
	error: unknown;
}

function failed(outcome: unknown): outcome is Failed {
	return typeof outcome === 'object' && outcome !== null && (outcome as { status?: unknown }).status === 'error';
}

/**
 * The generated commands, each one naming itself when it fails.
 *
 * Only failures are touched. A command that succeeds returns exactly what it returned, and so does
 * one whose answer is not an outcome at all — several of the generated functions return a plain
 * value, and a proxy that assumed otherwise would rewrite something it had not understood.
 */
export function namingFailures<T extends object>(commands: T): T {
	return new Proxy(commands, {
		get(target, key, receiver) {
			const value = Reflect.get(target, key, receiver) as unknown;
			if (typeof value !== 'function' || typeof key !== 'string') return value;

			return (...args: unknown[]) => {
				const answer = (value as (...called: unknown[]) => unknown).apply(target, args);
				// Not every generated function is async — and one that throws on the way to returning
				// a promise is a webview with no bridge, which is not this module's story to tell.
				if (!(answer instanceof Promise)) return answer;
				return answer.then((outcome: unknown) =>
					failed(outcome) ? { status: 'error', error: new CommandFailed(key, outcome.error) } : outcome
				);
			};
		}
	}) as T;
}
