/**
 * Turning the core's `Result` into a promise that resolves or throws.
 *
 * **Its own module because it is the only behaviour in the command layer.** `commands.ts` is
 * sixty-odd one-line wrappers over the generated bindings - mechanical, and mocked by every test
 * that would otherwise call one, so its coverage is a fact about mocking rather than about Studio.
 * This is the one thing in there that decides something, so it lives where a test can reach it.
 *
 * **The error is thrown as it arrived, not wrapped.** Every caller is a `catch` that hands it to
 * `status.fail`, which is the one place that decides how an error becomes text - re-wrapping here
 * would put a second opinion in front of it.
 */

/** What a `#[tauri::command]` returning `Result<T, E>` looks like on this side. */
export type Outcome<T, E> = { status: 'ok'; data: T } | { status: 'error'; error: E };

export async function unwrap<T, E>(result: Promise<Outcome<T, E>>): Promise<T> {
	const outcome = await result;
	if (outcome.status === 'error') throw outcome.error;
	return outcome.data;
}
