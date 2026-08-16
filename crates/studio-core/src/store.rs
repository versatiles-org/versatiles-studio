//! Application state that outlives a window — recent sources and view bookmarks.
//!
//! Distinct from the project model on purpose: this is state about *Studio*, not about any one
//! project, so it lives beside the application's data rather than inside a project folder
//! ([Q21]). It lives in the core because nothing durable may live in the webview ([Q16]) — a
//! reloaded or crashed window comes back with both lists intact.
//!
//! **Two files, not one, because their recovery policies differ.** Recents are disposable and churn
//! on every open, so a corrupt file silently resets. Bookmarks are user-created, so a corrupt file
//! is an error the user hears about — silently discarding them would be data loss.
//!
//! The core takes a **directory**, not file paths: the filenames are its own business, so a caller
//! cannot put bookmarks in the recents file or write either somewhere unintended. Deciding *which*
//! directory is the platform layer's job.
//!
//! [Q16]: ../../../docs/decisions.md
//! [Q21]: ../../../docs/decisions.md

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// How many recents to keep. Long enough to be useful, short enough to stay scannable.
const RECENTS_CAPACITY: usize = 12;

/// Filenames are internal — see the module note on why callers pass a directory.
const RECENTS_FILE: &str = "recents.json";
const BOOKMARKS_FILE: &str = "bookmarks.json";

// ---------------------------------------------------------------------------------------------
// Atomic writes
// ---------------------------------------------------------------------------------------------

/// Writes `contents` to `path` atomically.
///
/// Write to a sibling temp file, flush it, then rename over the target: rename is atomic on every
/// platform we ship to, so a crash mid-write leaves the old file intact rather than a truncated
/// one. This is the durability SQLite would have given us, without the schema.
fn write_atomically(path: &Path, contents: &str) -> Result<()> {
	use std::io::Write;

	let dir = path.parent().context("target has no parent directory")?;
	std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;

	let temp = path.with_extension("tmp");
	{
		let mut file = std::fs::File::create(&temp).with_context(|| format!("creating {}", temp.display()))?;
		file
			.write_all(contents.as_bytes())
			.context("writing the temporary file")?;
		file.sync_all().context("flushing the temporary file")?;
	}
	std::fs::rename(&temp, path).with_context(|| format!("replacing {}", path.display()))
}

fn now() -> u64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map_or(0, |d| d.as_secs())
}

// ---------------------------------------------------------------------------------------------
// Recents
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
	/// The path or URL exactly as the user gave it.
	pub source: String,
	/// Seconds since the Unix epoch.
	pub opened_at: u64,
}

/// Most-recently-opened sources, newest first (A7).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Recents(Vec<RecentEntry>);

impl Recents {
	/// Reads the list, treating any problem as "no recents".
	///
	/// Deliberately infallible: losing a most-recently-used list costs a user nothing, and refusing
	/// to start over it costs them everything. Bookmarks take the opposite policy.
	#[must_use]
	pub fn load(dir: &Path) -> Self {
		std::fs::read_to_string(dir.join(RECENTS_FILE))
			.ok()
			.and_then(|text| serde_json::from_str(&text).ok())
			.unwrap_or_default()
	}

	pub fn save(&self, path: &Path) -> Result<()> {
		write_atomically(
			path,
			&serde_json::to_string_pretty(self).context("serialising recents")?,
		)
	}

	/// Records a source as most-recent, moving it up if already present.
	pub fn record(&mut self, source: &str) {
		self.0.retain(|entry| entry.source != source);
		self.0.insert(
			0,
			RecentEntry {
				source: source.to_string(),
				opened_at: now(),
			},
		);
		self.0.truncate(RECENTS_CAPACITY);
	}

	#[must_use]
	pub fn entries(&self) -> &[RecentEntry] {
		&self.0
	}

	pub fn forget(&mut self, source: &str) {
		self.0.retain(|entry| entry.source != source);
	}
}

// ---------------------------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------------------------

/// A named view: where the camera was, and what it was looking at.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
	pub name: String,
	/// The source this view belongs to, so a bookmark can offer to reopen it.
	pub source: Option<String>,
	pub lng: f64,
	pub lat: f64,
	pub zoom: f64,
	#[serde(default)]
	pub bearing: f64,
	#[serde(default)]
	pub pitch: f64,
	pub created_at: u64,
}

/// Named view bookmarks (A7).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Bookmarks(Vec<Bookmark>);

impl Bookmarks {
	/// Reads the list. **Fails loudly**, unlike [`Recents::load`].
	///
	/// A missing file is fine — that is a first run. A file that exists but will not parse is not:
	/// these are user-created, and silently replacing them with an empty list is data loss wearing
	/// the costume of a clean start.
	pub fn load(dir: &Path) -> Result<Self> {
		let path = dir.join(BOOKMARKS_FILE);
		if !path.exists() {
			return Ok(Self::default());
		}
		let text = std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
		serde_json::from_str(&text).with_context(|| {
			format!(
				"{} is not valid bookmark data — it has not been touched",
				path.display()
			)
		})
	}

	pub fn save(&self, dir: &Path) -> Result<()> {
		write_atomically(
			&dir.join(BOOKMARKS_FILE),
			&serde_json::to_string_pretty(self).context("serialising bookmarks")?,
		)
	}

	/// Adds a bookmark, replacing any with the same name.
	pub fn add(&mut self, mut bookmark: Bookmark) {
		bookmark.created_at = now();
		self.0.retain(|b| b.name != bookmark.name);
		self.0.push(bookmark);
		self.0.sort_by(|a, b| a.name.cmp(&b.name));
	}

	#[must_use]
	pub fn entries(&self) -> &[Bookmark] {
		&self.0
	}

	pub fn remove(&mut self, name: &str) -> bool {
		let before = self.0.len();
		self.0.retain(|b| b.name != name);
		self.0.len() != before
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// A clean directory per test, so they cannot tread on each other.
	fn temp_dir(label: &str) -> std::path::PathBuf {
		let dir = std::env::temp_dir().join("studio-store-tests").join(label);
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		dir
	}

	#[test]
	fn most_recent_comes_first_without_duplicating() {
		let mut recents = Recents::default();
		recents.record("/a");
		recents.record("/b");
		recents.record("/a");
		let sources: Vec<_> = recents.entries().iter().map(|e| e.source.as_str()).collect();
		assert_eq!(sources, ["/a", "/b"], "re-opening moves up, not duplicates");
	}

	#[test]
	fn recents_stay_bounded() {
		let mut recents = Recents::default();
		for i in 0..40 {
			recents.record(&format!("/{i}"));
		}
		assert_eq!(recents.entries().len(), RECENTS_CAPACITY);
		assert_eq!(recents.entries()[0].source, "/39");
	}

	/// Losing an MRU list costs nothing; refusing to start costs everything.
	#[test]
	fn corrupt_recents_reset_silently() {
		let dir = temp_dir("corrupt-recents");
		std::fs::write(dir.join("recents.json"), "{ not json").unwrap();
		assert!(Recents::load(&dir).entries().is_empty());
	}

	/// The opposite policy: these are user-created, so silence would be data loss.
	#[test]
	fn corrupt_bookmarks_are_an_error_and_the_file_is_left_alone() {
		let dir = temp_dir("corrupt-bookmarks");
		let path = dir.join("bookmarks.json");
		std::fs::write(&path, "{ not json").unwrap();

		let error = Bookmarks::load(&dir).unwrap_err();
		assert!(format!("{error:#}").contains("has not been touched"));
		assert_eq!(
			std::fs::read_to_string(&path).unwrap(),
			"{ not json",
			"a failed load must not modify the file"
		);
	}

	#[test]
	fn a_missing_bookmarks_file_is_a_first_run_not_an_error() -> Result<()> {
		let dir = temp_dir("first-run");
		assert!(Bookmarks::load(&dir)?.entries().is_empty());
		Ok(())
	}

	#[test]
	fn bookmarks_replace_by_name_and_stay_sorted() {
		let mut marks = Bookmarks::default();
		for name in ["zebra", "alpha"] {
			marks.add(Bookmark {
				name: name.into(),
				source: None,
				lng: 0.0,
				lat: 0.0,
				zoom: 4.0,
				bearing: 0.0,
				pitch: 0.0,
				created_at: 0,
			});
		}
		marks.add(Bookmark {
			name: "alpha".into(),
			source: None,
			lng: 13.4,
			lat: 52.5,
			zoom: 12.0,
			bearing: 0.0,
			pitch: 0.0,
			created_at: 0,
		});

		let names: Vec<_> = marks.entries().iter().map(|b| b.name.as_str()).collect();
		assert_eq!(names, ["alpha", "zebra"], "sorted, and no duplicate alpha");
		assert_eq!(marks.entries()[0].zoom, 12.0, "the newer alpha replaced the older");
	}

	#[test]
	fn bookmarks_survive_a_round_trip() -> Result<()> {
		let dir = temp_dir("roundtrip");
		let mut marks = Bookmarks::default();
		marks.add(Bookmark {
			name: "Berlin".into(),
			source: Some("/berlin.versatiles".into()),
			lng: 13.405,
			lat: 52.52,
			zoom: 11.0,
			bearing: 15.0,
			pitch: 30.0,
			created_at: 0,
		});
		marks.save(&dir)?;

		let loaded = Bookmarks::load(&dir)?;
		assert_eq!(loaded.entries()[0].name, "Berlin");
		assert_eq!(loaded.entries()[0].bearing, 15.0);
		Ok(())
	}

	/// The point of write-then-rename: an interrupted write must not destroy what was there.
	#[test]
	fn an_atomic_write_leaves_no_temporary_file_behind() -> Result<()> {
		let dir = temp_dir("atomic");
		Bookmarks::default().save(&dir)?;
		let path = dir.join("bookmarks.json");
		assert!(path.exists());
		assert!(
			!path.with_extension("tmp").exists(),
			"the temp file should have been renamed away"
		);
		Ok(())
	}
}
