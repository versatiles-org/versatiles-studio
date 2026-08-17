//! Generating `src/lib/ipc/bindings.ts` from the commands themselves (S0.3, [Q3]).
//!
//! Every type crossing the IPC boundary used to be written twice — once in Rust and once in
//! TypeScript — and `svelte-check` cannot catch the drift, because it flags a *use* of a missing
//! field, not a missing field. Adding one in Rust and forgetting the other side failed nothing
//! until somebody read it.
//!
//! **The generated file is committed**, and the test below fails when it is stale, the way
//! `cargo fmt --check` fails on unformatted code. That is also what makes depending on a
//! pre-1.0 generator reasonable: if `specta` ever breaks, the checked-in bindings keep working and
//! only regeneration needs fixing.
//!
//! [Q3]: ../../docs/decisions.md

#[cfg(test)]
mod tests {
	use specta_typescript::Typescript;

	const OUTPUT: &str = "../src/lib/ipc/bindings.ts";

	const HEADER: &str = "\
// Generated from the Rust commands by `cargo test -p versatiles-studio` — do not edit.
//
// Hand-written wrappers and the reasoning behind each command live in `commands.ts`, which
// re-exports everything here. See src-tauri/src/bindings.rs.
";

	/// `export` writes to a path, so generation goes to a scratch file and is read back. Comparing
	/// text rather than writing in place is what lets the test *fail* on staleness instead of
	/// silently fixing it — a check that repairs what it is checking reports nothing.
	fn generate() -> String {
		let scratch = std::env::temp_dir().join("versatiles-studio-bindings.ts");
		crate::specta_builder()
			.export(Typescript::default().header(HEADER), &scratch)
			.expect("the command types should export");
		std::fs::read_to_string(&scratch).expect("reading the generated bindings")
	}

	/// Regenerates the bindings. Run with `UPDATE_BINDINGS=1 cargo test -p versatiles-studio`.
	#[test]
	fn bindings_are_up_to_date() {
		let generated = generate();
		let path = std::path::Path::new(OUTPUT);
		let current = std::fs::read_to_string(path).unwrap_or_default();

		if current == generated {
			return;
		}
		if std::env::var_os("UPDATE_BINDINGS").is_some() {
			std::fs::write(path, &generated).expect("writing the bindings");
			return;
		}
		panic!(
			"{OUTPUT} is stale — a command or a type changed.\n\
			 Run `UPDATE_BINDINGS=1 cargo test -p versatiles-studio` and commit the result."
		);
	}
}
