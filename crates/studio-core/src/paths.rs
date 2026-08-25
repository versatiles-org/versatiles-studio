//! The one place a path built from **data** is checked.
//!
//! **Not every path needs this.** A container someone picked in a file dialog is their own choice -
//! they could open it in any other program - so Studio opens what it is told to. The dangerous ones
//! are paths assembled from *data*: a name in `project.yaml`, an id arriving over IPC, an entry in a
//! `.tar.gz`. Those were written by whoever produced the data, and "whoever produced the data" is not
//! always the person sitting in front of the application.
//!
//! Three places had grown their own version of that check and a fourth had forgotten it, which is
//! the argument for one module: the rule is short, it is easy to write *almost* right, and getting
//! it wrong is silent. `assets::remove` took an id straight from the webview and joined it, so
//! `../../../x` deleted `x.tar.gz` outside the asset directory; `style::bundle` trusted the names
//! inside an archive, which is the classic zip-slip.
//!
//! Both are why the code scanner keeps flagging this crate, and why the answer is a guard rather
//! than a dismissal: among a great deal of noise about paths a user chose deliberately, it was
//! pointing at two real defects.

use anyhow::{Result, ensure};
use std::path::{Component, Path, PathBuf};

/// Checks that `name` is a single filename, usable on every platform Studio ships on.
///
/// Refuses separators of either kind, the two relative names, a Windows drive colon, and the empty
/// string. Deliberately stricter than any one platform: a name that reaches here becomes a filename
/// on macOS, Linux and Windows, and the intersection is what has to hold.
pub fn segment(name: &str) -> Result<()> {
	ensure!(!name.is_empty(), "an empty name cannot be a filename");
	ensure!(
		!name.contains(['/', '\\', ':', '\0']),
		"{name:?} cannot be a filename - it contains a path separator"
	);
	ensure!(name != "." && name != "..", "{name:?} cannot be a filename");
	Ok(())
}

/// `dir` joined with `relative`, provided the result stays inside `dir`.
///
/// **Checked component by component, not by comparing the joined string.** A prefix test on the
/// result is the version everyone writes and it is wrong twice over: `dir.join("../evil")` still
/// starts with `dir` as text, and a legitimate sibling directory named `<dir>-backup` starts with
/// `<dir>` too. Walking the components decides the question the check is actually asking.
///
/// No `canonicalize`: the target usually does not exist yet - it is about to be written - and a
/// check that only works on existing files is a check that is absent exactly when it is needed. This
/// therefore does not resolve symlinks; it stops a path from *naming* somewhere outside `dir`, which
/// is the part an attacker controls when the string comes from data.
pub fn within(dir: &Path, relative: &str) -> Result<PathBuf> {
	let candidate = Path::new(relative);
	ensure!(
		candidate.is_relative(),
		"{relative:?} is an absolute path, and must be inside the target directory"
	);

	let mut depth = 0i32;
	for component in candidate.components() {
		match component {
			Component::Normal(_) => depth += 1,
			// `a/./b` is `a/b`; harmless.
			Component::CurDir => {}
			Component::ParentDir => {
				depth -= 1;
				ensure!(depth >= 0, "{relative:?} points outside the target directory");
			}
			// A root or a `C:` prefix on a path that claimed to be relative.
			Component::RootDir | Component::Prefix(_) => {
				anyhow::bail!("{relative:?} is rooted, and must be inside the target directory")
			}
		}
	}

	Ok(dir.join(candidate))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_plain_name_is_a_filename() {
		for name in ["berlin", "noto_sans", "a.b.c", "with space", "Ünïcøde"] {
			segment(name).unwrap_or_else(|error| panic!("{name:?} should be usable: {error:#}"));
		}
	}

	/// `assets::remove` joined an id straight from the webview, so this list is the exploit.
	#[test]
	fn a_name_that_is_a_path_is_refused() {
		for name in ["", ".", "..", "../x", "a/b", "a\\b", "C:x", "/etc/passwd", "a\0b"] {
			assert!(segment(name).is_err(), "{name:?} should be refused");
		}
	}

	#[test]
	fn a_relative_path_lands_inside() {
		let dir = Path::new("/tmp/out");
		assert_eq!(within(dir, "fonts/a.pbf").unwrap(), dir.join("fonts/a.pbf"));
		assert_eq!(within(dir, "./fonts/a.pbf").unwrap(), dir.join("./fonts/a.pbf"));
		// Down then back up, ending inside: legal, because it names somewhere within `dir`.
		assert_eq!(within(dir, "fonts/../a.pbf").unwrap(), dir.join("fonts/../a.pbf"));
	}

	/// Zip slip: the archive entry names that made `style::bundle` write outside its target.
	#[test]
	fn a_path_leaving_the_directory_is_refused() {
		let dir = Path::new("/tmp/out");
		for relative in [
			"../evil",
			"fonts/../../evil",
			"a/b/../../../evil",
			"/etc/passwd",
			"fonts/../..",
		] {
			assert!(within(dir, relative).is_err(), "{relative:?} should be refused");
		}
	}

	/// The prefix test this deliberately does not use would pass both of these: the first because
	/// `/tmp/out/../evil` starts with `/tmp/out`, the second because `/tmp/out-backup` does too.
	#[test]
	fn the_check_is_not_a_string_prefix() {
		let dir = Path::new("/tmp/out");
		let escaped = dir.join("../evil");
		assert!(escaped.to_string_lossy().starts_with("/tmp/out"), "premise of the test");
		assert!(within(dir, "../evil").is_err());
	}
}
