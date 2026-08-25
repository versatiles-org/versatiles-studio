// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
	// **`--version`, before anything else starts.** Not a feature - a way for a release to prove
	// that what it just bundled actually runs. Studio links GDAL statically (Q19, Q20) and WebKit
	// dynamically, so "the installer was produced" and "the binary starts" are genuinely different
	// claims, and only the second one matters to whoever downloads it.
	//
	// Handled here rather than in `run()` because it has to answer without a window, a server or a
	// webview - on a CI runner with no display, all three would fail for reasons that say nothing
	// about the bundle.
	if std::env::args().any(|arg| arg == "--version" || arg == "-V") {
		println!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"));
		return;
	}

	versatiles_studio_lib::run()
}
