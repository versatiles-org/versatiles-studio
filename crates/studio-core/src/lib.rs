//! VersaTiles Studio core.
//!
//! A plain Rust library with **no Tauri types**, so it can be driven by ordinary tests with no
//! Tauri runtime ([Q3](../../../docs/decisions.md)). `src-tauri` is a thin binding over this.
//!
//! Modules mirror the core services in `docs/architecture.md`.

/// Names Studio in the `User-Agent` of every request the library makes ([vt#248]).
///
/// Without it, every remote container Studio opens reaches a provider's log looking like
/// `versatiles convert` — the library identifies itself and the application it is embedded in does
/// not exist. Upstream appends rather than substitutes, so `versatiles/4.9.1 …` stays first and
/// anything that recognises VersaTiles traffic keeps working.
///
/// **Called once, as early as possible.** Upstream takes the first call and logs the rest, so this
/// belongs at start-up, before anything can fetch. A hyphen in the name because a product token may
/// not contain a space.
///
/// Failure is reported and not fatal: a malformed token is a bug in the two literals below, and a
/// window that refuses to open over a header nobody sees would be the wrong trade.
///
/// [vt#248]: https://github.com/versatiles-org/versatiles-rs/issues/248
pub fn identify(version: &str) -> anyhow::Result<()> {
	versatiles_core::io::set_product("VersaTiles-Studio", version, Some("https://versatiles.org/studio"))
}

pub mod analysis;
pub mod archive;
pub mod assets;
pub mod bundle;
pub mod diagnostics;
pub mod estimate;
pub mod export;
pub mod graphs;
pub mod history;
pub mod import;
pub mod jobs;
pub mod paths;
pub mod preview;
pub mod project;
pub mod server;
pub mod store;
pub mod style;
pub mod suggest;
pub mod tabular;
#[cfg(test)]
mod testing;
pub mod vpl;

#[cfg(test)]
mod identity_tests {
	/// The two literals above are the whole of what can be wrong here, and upstream refuses a name
	/// with a space in it — which is what "VersaTiles Studio" would have been.
	#[test]
	fn studio_names_itself_in_the_user_agent() {
		super::identify("0.0.0").expect("the product token should be valid");

		let header = versatiles_core::io::user_agent();
		assert!(header.starts_with("versatiles/"), "{header}");
		assert!(header.contains("VersaTiles-Studio/0.0.0"), "{header}");
	}
}
