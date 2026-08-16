//! Project model — a directory holding a `project.yaml` manifest beside real `.vpl` and
//! `style.json` files (G1, [Q6]).
//!
//! The manifest itself arrives at S5.1. What exists now is [`Recents`], the list of sources the
//! user has opened — **application state, not project state**, which is why it persists next to the
//! app's configuration rather than inside any project.
//!
//! It lives in the core because nothing durable may live in the webview ([Q16]): a reloaded or
//! crashed window has to come back with its recents intact. The core takes a path; deciding *which*
//! path is the platform layer's job.
//!
//! [Q6]: ../../../docs/decisions.md
//! [Q16]: ../../../docs/decisions.md

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// How many entries to keep. Long enough to be useful, short enough that the list stays scannable.
const CAPACITY: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
	/// The path or URL exactly as the user gave it.
	pub source: String,
	/// Seconds since the Unix epoch, for ordering and for showing "when".
	pub opened_at: u64,
}

/// Most-recently-opened sources, newest first.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Recents(Vec<RecentEntry>);

impl Recents {
	/// Reads the list, treating any problem as "no recents".
	///
	/// A corrupt or unreadable file must not stop the application from starting — losing this list
	/// costs a user nothing, and refusing to launch over it costs them everything.
	#[must_use]
	pub fn load(path: &Path) -> Self {
		std::fs::read_to_string(path)
			.ok()
			.and_then(|text| serde_json::from_str(&text).ok())
			.unwrap_or_default()
	}

	pub fn save(&self, path: &Path) -> Result<()> {
		if let Some(dir) = path.parent() {
			std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
		}
		let json = serde_json::to_string_pretty(self).context("serialising recents")?;
		std::fs::write(path, json).with_context(|| format!("writing {}", path.display()))
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
		self.0.truncate(CAPACITY);
	}

	#[must_use]
	pub fn entries(&self) -> &[RecentEntry] {
		&self.0
	}

	/// Drops an entry, for when a user clears one or a path has gone away.
	pub fn forget(&mut self, source: &str) {
		self.0.retain(|entry| entry.source != source);
	}
}

fn now() -> u64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map_or(0, |d| d.as_secs())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn most_recent_comes_first_without_duplicating() {
		let mut recents = Recents::default();
		recents.record("/a.versatiles");
		recents.record("/b.versatiles");
		recents.record("/a.versatiles");

		let sources: Vec<_> = recents.entries().iter().map(|e| e.source.as_str()).collect();
		assert_eq!(
			sources,
			["/a.versatiles", "/b.versatiles"],
			"re-opening moves up, not duplicates"
		);
	}

	#[test]
	fn the_list_stays_bounded() {
		let mut recents = Recents::default();
		for i in 0..40 {
			recents.record(&format!("/{i}.versatiles"));
		}
		assert_eq!(recents.entries().len(), CAPACITY);
		assert_eq!(recents.entries()[0].source, "/39.versatiles");
	}

	#[test]
	fn forgetting_removes_only_that_entry() {
		let mut recents = Recents::default();
		recents.record("/a");
		recents.record("/b");
		recents.forget("/a");
		assert_eq!(recents.entries().len(), 1);
		assert_eq!(recents.entries()[0].source, "/b");
	}

	#[test]
	fn survives_a_round_trip() -> Result<()> {
		let dir = std::env::temp_dir().join("studio-recents-test");
		let path = dir.join("recents.json");
		let _ = std::fs::remove_file(&path);

		let mut recents = Recents::default();
		recents.record("/one");
		recents.save(&path)?;

		assert_eq!(Recents::load(&path).entries()[0].source, "/one");
		std::fs::remove_dir_all(&dir).ok();
		Ok(())
	}

	/// Losing this list costs nothing; refusing to start costs everything.
	#[test]
	fn a_corrupt_file_yields_an_empty_list_rather_than_an_error() {
		let path = std::env::temp_dir().join("studio-recents-corrupt.json");
		std::fs::write(&path, "{ not json").unwrap();
		assert!(Recents::load(&path).entries().is_empty());
		std::fs::remove_file(&path).ok();
	}
}
