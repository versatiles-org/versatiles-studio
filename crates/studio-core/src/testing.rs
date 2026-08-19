//! Scratch files and directories for this crate's tests.
//!
//! Four modules had grown their own near-identical version of this, differing mainly in the prefix
//! they used to keep out of each other's way — `studio-project-tests`, `studio-store-tests`,
//! `versatiles-studio-export-…`. That prefix was load-bearing: `project` and `store` both have
//! tests called `roundtrip` and `atomic`, and they only avoided each other because each module
//! spelled its temp path differently. A shared helper that kept labels alone would have made those
//! collide, and tests run in threads of one process.
//!
//! **So uniqueness comes from a counter, not from the label.** The label stays for readability when
//! looking at what a failing test left behind; the number is what guarantees no two calls — in one
//! module or across four — are handed the same directory.
//!
//! It also means these are the only filesystem calls in the crate's tests, which is the other half
//! of why they are here: everything else asks for a path and is given one.

use std::path::{Path, PathBuf};
use std::sync::Once;
use std::sync::atomic::{AtomicU32, Ordering};

static SEQUENCE: AtomicU32 = AtomicU32::new(0);

/// Everything the tests write, under one directory — emptied once per run.
///
/// The numbered directories below never repeat, so nothing overwrites anything within a run; across
/// runs they would simply pile up. Clearing the root on first use bounds that to one run's worth,
/// and replaces the per-test tidying this took over, which could only ever remove files it knew the
/// name of.
fn root() -> PathBuf {
	static CLEAN: Once = Once::new();
	let root = std::env::temp_dir().join("versatiles-studio-tests");
	CLEAN.call_once(|| {
		let _ = std::fs::remove_dir_all(&root);
	});
	root
}

/// An empty directory of its own, named for readability and numbered for uniqueness.
pub fn dir(label: &str) -> PathBuf {
	let ordinal = SEQUENCE.fetch_add(1, Ordering::Relaxed);
	let path = root().join(format!("{label}-{ordinal}"));
	// Removed first in case a previous run was killed before it could clean up — the counter makes
	// a collision within one run impossible, but not one across two.
	let _ = std::fs::remove_dir_all(&path);
	std::fs::create_dir_all(&path).expect("creating a test directory");
	path
}

/// A path in a directory of its own, with **nothing at it**.
///
/// For tests that assert about what a write leaves behind: the file not existing beforehand is the
/// premise, so it is guaranteed here rather than assumed.
pub fn path(name: &str) -> PathBuf {
	dir(stem(name)).join(name)
}

/// A file with `contents`, in a directory of its own.
pub fn file(name: &str, contents: &str) -> PathBuf {
	let path = path(name);
	std::fs::write(&path, contents).expect("writing a test file");
	path
}

/// The label a filename suggests — `berlin.versatiles` becomes `berlin`, so the directory left
/// behind says which test made it.
fn stem(name: &str) -> &str {
	Path::new(name)
		.file_stem()
		.and_then(|stem| stem.to_str())
		.unwrap_or(name)
}

#[cfg(test)]
mod tests {
	#[test]
	fn labels_shared_between_modules_do_not_collide() {
		let a = crate::testing::dir("roundtrip");
		let b = crate::testing::dir("roundtrip");
		assert_ne!(a, b, "two calls with one label must not share a directory");
	}
}
