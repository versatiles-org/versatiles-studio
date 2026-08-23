//! Writing a set of files as a folder or as one `.zip`.
//!
//! Two features wanted this and each grew its own: [`crate::bundle`] makes a *project* portable,
//! [`crate::style::bundle`] makes a *style* self-contained. They are different features and should
//! stay separate — but "write these entries, either way round" is not what makes them different,
//! and having it twice produced two answers to a question with one:
//!
//! * the project bundle stored anything whose extension looked already-compressed and deflated the
//!   rest; the style bundle deflated `.json` and stored everything else. A `.json` is a `.json`.
//! * only one of the two checked that an entry stays inside the directory it is written to, which is
//!   the guard that stops a hostile archive escaping ([`crate::paths`]).
//!
//! **Bytes or a path, because both are real.** A style bundle holds glyph ranges already in memory;
//! a project bundle carries tile containers that are routinely larger than free disk. One is written
//! from a buffer and the other streamed from where it already is, and the caller says which by
//! choosing a [`Content`].

use crate::paths;
use anyhow::{Context, Result};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Where an entry's bytes come from.
pub enum Content {
	/// Already in memory — a rendered `style.json`, a glyph range read out of an archive.
	Bytes(Vec<u8>),
	/// Still on disk, and copied or streamed rather than loaded. A `.versatiles` is gigabytes.
	File(PathBuf),
}

/// One file on its way into a bundle.
pub struct Entry {
	/// Its path inside the bundle, always relative — `data/berlin.mbtiles`, `style.json`.
	pub path: String,
	pub content: Content,
}

impl Entry {
	pub fn bytes(path: impl Into<String>, bytes: impl Into<Vec<u8>>) -> Self {
		Self {
			path: path.into(),
			content: Content::Bytes(bytes.into()),
		}
	}

	pub fn file(path: impl Into<String>, from: impl Into<PathBuf>) -> Self {
		Self {
			path: path.into(),
			content: Content::File(from.into()),
		}
	}
}

/// The path only. A failing assertion should not print a glyph range.
impl std::fmt::Debug for Entry {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match &self.content {
			Content::Bytes(bytes) => write!(f, "Entry({:?}, {} bytes)", self.path, bytes.len()),
			Content::File(from) => write!(f, "Entry({:?}, from {})", self.path, from.display()),
		}
	}
}

/// Whether deflating this would be work for nothing.
///
/// **One rule, and it is about the contents rather than the caller.** Tile containers hold tiles
/// that are already gzip or webp, and a `.png` is a `.png` whichever bundle it is in; deflating any
/// of them spends minutes to save nothing. Everything else — a manifest, a pipeline, a style — is
/// text and compresses well.
fn is_compressed(path: &str) -> bool {
	const ALREADY: [&str; 9] = [
		"versatiles",
		"mbtiles",
		"pmtiles",
		"gz",
		"zip",
		"png",
		"jpg",
		"jpeg",
		"webp",
	];
	Path::new(path)
		.extension()
		.and_then(|extension| extension.to_str())
		.is_some_and(|extension| ALREADY.contains(&extension.to_ascii_lowercase().as_str()))
}

/// Writes the entries into `dir`, creating the directories they need.
///
/// Every path is checked against `dir` before anything is written: an entry may be named by data —
/// an archive's own table of contents — and `../` in one of those is how a bundle writes outside
/// the folder someone chose.
pub fn write_directory(dir: &Path, entries: &[Entry]) -> Result<()> {
	for entry in entries {
		let path = paths::within(dir, &entry.path)?;
		let parent = path.parent().context("a bundle entry with no directory")?;
		std::fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;

		match &entry.content {
			Content::Bytes(bytes) => {
				std::fs::write(&path, bytes).with_context(|| format!("writing {}", path.display()))?;
			}
			Content::File(from) => {
				// The destination is a directory someone chose, and it could be the one the source
				// is already in — copying a file onto itself truncates it.
				anyhow::ensure!(
					!same_file(from, &path),
					"{} is already where the bundle would put it",
					from.display()
				);
				std::fs::copy(from, &path).with_context(|| format!("copying {} to {}", from.display(), path.display()))?;
			}
		}
	}
	Ok(())
}

/// Writes the entries as one `.zip`.
///
/// A `Content::File` is streamed rather than read: the whole point of carrying a tile container is
/// that it does not fit in memory twice.
pub fn write_zip(path: &Path, entries: &[Entry]) -> Result<()> {
	use zip::write::SimpleFileOptions;

	let file = std::fs::File::create(path).with_context(|| format!("creating {}", path.display()))?;
	let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(file));

	let deflated = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
	let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

	for entry in entries {
		// Checked here too. A zip entry named `../x` is extracted outside the target by anything
		// that trusts it, and plenty does.
		paths::within(Path::new(""), &entry.path)?;

		let options = if is_compressed(&entry.path) { stored } else { deflated };
		zip.start_file(&entry.path, options)
			.with_context(|| format!("adding {}", entry.path))?;

		match &entry.content {
			Content::Bytes(bytes) => {
				zip.write_all(bytes)
					.with_context(|| format!("writing {}", entry.path))?;
			}
			Content::File(from) => {
				let mut source = std::fs::File::open(from).with_context(|| format!("reading {}", from.display()))?;
				std::io::copy(&mut source, &mut zip).with_context(|| format!("copying {}", from.display()))?;
			}
		}
	}

	zip.finish().context("finishing the archive")?;
	Ok(())
}

/// Whether two paths are the same file, as far as can be told without opening them.
///
/// `canonicalize` fails on a path that does not exist yet, which is the ordinary case for a
/// destination — and two paths that cannot both be resolved cannot be the same file.
fn same_file(a: &Path, b: &Path) -> bool {
	match (a.canonicalize(), b.canonicalize()) {
		(Ok(a), Ok(b)) => a == b,
		_ => false,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn entries() -> Vec<Entry> {
		vec![
			Entry::bytes("project.yaml", "version: 1"),
			Entry::bytes("nested/style.json", r#"{"version":8}"#),
		]
	}

	#[test]
	fn a_directory_gets_the_entries_and_the_folders_they_need() {
		let dir = crate::testing::dir("archive-directory");
		write_directory(&dir, &entries()).unwrap();

		assert_eq!(std::fs::read_to_string(dir.join("project.yaml")).unwrap(), "version: 1");
		assert_eq!(
			std::fs::read_to_string(dir.join("nested/style.json")).unwrap(),
			r#"{"version":8}"#
		);
	}

	#[test]
	fn a_zip_holds_the_same_entries() {
		let path = crate::testing::path("archive.zip");
		write_zip(&path, &entries()).unwrap();

		let zip = zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();
		let names: Vec<String> = zip.file_names().map(str::to_string).collect();
		assert!(names.contains(&"project.yaml".to_string()), "{names:?}");
		assert!(names.contains(&"nested/style.json".to_string()), "{names:?}");
	}

	/// A file too big to hold twice is the reason `Content::File` exists.
	#[test]
	fn a_file_entry_is_carried_by_path() {
		let source = crate::testing::file("berlin.mbtiles", "tiles");
		let dir = crate::testing::dir("archive-file");
		write_directory(&dir, &[Entry::file("data/berlin.mbtiles", &source)]).unwrap();

		assert_eq!(
			std::fs::read_to_string(dir.join("data/berlin.mbtiles")).unwrap(),
			"tiles"
		);
	}

	/// Both writers refuse it, because both are reachable with a name that came from data.
	#[test]
	fn an_entry_cannot_escape_the_target() {
		let dir = crate::testing::dir("archive-escape");
		let escaping = vec![Entry::bytes("../pwned", "x")];

		assert!(write_directory(&dir, &escaping).is_err());
		assert!(
			!dir.parent().unwrap().join("pwned").exists(),
			"written outside the target"
		);
		assert!(write_zip(&crate::testing::path("escape.zip"), &escaping).is_err());
	}

	/// The destination can be where the source already lives; copying a file onto itself empties it.
	#[test]
	fn a_file_is_not_copied_onto_itself() {
		let dir = crate::testing::dir("archive-onto-itself");
		std::fs::create_dir_all(dir.join("data")).unwrap();
		let source = dir.join("data/berlin.mbtiles");
		std::fs::write(&source, "tiles").unwrap();

		let error = write_directory(&dir, &[Entry::file("data/berlin.mbtiles", &source)]).unwrap_err();
		assert!(format!("{error:#}").contains("already where"), "{error:#}");
		assert_eq!(
			std::fs::read_to_string(&source).unwrap(),
			"tiles",
			"and did not truncate it"
		);
	}

	/// The rule the two bundles used to disagree about.
	#[test]
	fn what_is_already_compressed_is_stored_rather_than_deflated() {
		for name in ["a.versatiles", "a.mbtiles", "a.png", "a.JPEG", "fonts/x.gz"] {
			assert!(is_compressed(name), "{name} should be stored");
		}
		for name in ["project.yaml", "style.json", "berlin.vpl", "x.pbf"] {
			assert!(!is_compressed(name), "{name} should be deflated");
		}
	}
}
