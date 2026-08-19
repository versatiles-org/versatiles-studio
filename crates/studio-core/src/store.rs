//! Application state that outlives a window — recent sources and view bookmarks.
//!
//! Distinct from the project model on purpose: this is state about *Studio*, not about any one
//! project, so it lives beside the application's data rather than inside a project folder
//! ([Q21]). It lives in the core because nothing durable may live in the webview ([Q16]) — a
//! reloaded or crashed window comes back with both lists intact.
//!
//! **Separate files, because their recovery policies differ.** Recents and pane layout are
//! disposable and churn constantly, so a corrupt file silently resets. Bookmarks are user-created,
//! so a corrupt file is an error the user hears about — silently discarding them would be data
//! loss.
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
const LAYOUT_FILE: &str = "layout.json";

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

	anyhow::ensure!(
		!path.is_dir(),
		"{} is a directory — this wants the path of a file to write",
		path.display()
	);
	let dir = path.parent().context("target has no parent directory")?;
	std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;

	// Append rather than `with_extension`, which *replaces* the last extension: given a target of
	// `org.versatiles.studio` that produced `org.versatiles.tmp` — a stray file in the shared
	// Application Support directory, next to other applications' data rather than inside ours.
	let mut temp = path.as_os_str().to_owned();
	temp.push(".tmp");
	let temp = std::path::PathBuf::from(temp);
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
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct RecentEntry {
	/// The path or URL exactly as the user gave it.
	pub source: String,
	/// Seconds since the Unix epoch, emitted as a `number` — a double holds them exactly for the
	/// next quarter of a million years, and `u32` would overflow in 2106.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
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

	pub fn save(&self, dir: &Path) -> Result<()> {
		write_atomically(
			&dir.join(RECENTS_FILE),
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
// Layout
// ---------------------------------------------------------------------------------------------

/// Narrower than this and a pane header has nowhere to go; wider and the map stops being the
/// subject. Persisted values are clamped on the way in and out, so a corrupt or hand-edited file
/// cannot produce a pane that cannot be recovered from.
///
/// One range for both panes: they are the same kind of thing at opposite edges, and two sets of
/// limits would be two things to keep in step for no reason anyone could see.
const MIN_PANE_WIDTH: f64 = 180.0;
const MAX_PANE_WIDTH: f64 = 640.0;
const DEFAULT_LEFT_WIDTH: f64 = 264.0;
const DEFAULT_RIGHT_WIDTH: f64 = 304.0;

/// Which left-pane sections are open, and how wide the pane is ([Q22]).
///
/// This lives in the core rather than the webview for the reason everything else here does ([Q16]):
/// a reloaded window must come back looking the way the user left it. Q22 called independent,
/// remembered collapse "load-bearing, not polish" — on the 13-inch laptop Q15 was protecting, a
/// pane that reopens everything on every reload makes the surface unusable.
///
/// **A list of panes, not named fields** ([Q31]). Which panes exist is still a design decision
/// rather than something the webview can invent — the catalogue below is code — but their *order*
/// and *which sidebar they sit in* are data, so moving one is an edit rather than a refactor. The
/// analysis cluster alone adds eight more of them.
///
/// **`default` is for the file, and it shows in the generated bindings.** It exists so a
/// `layout.json` written by an earlier build still loads; the generator cannot know that, so every
/// field arrives in TypeScript as optional even though a command always returns all of them. One
/// struct serving as both a file format and an IPC type is what makes that ambiguous.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Layout {
	/// Every pane, in the order its sidebar shows it. Reconciled against the catalogue on the way
	/// in, so a file from another build is never authoritative about which panes exist.
	pub panes: Vec<PaneState>,
	/// Pane widths in CSS pixels. Both edges are draggable.
	//
	// Emitted as `number`, not `number | null`. Specta is right that JSON cannot hold `NaN` and that
	// `serde_json` writes `null` instead — but every float that crosses this boundary is a camera
	// value, a clamped width or a computed fraction, all finite by construction. Admitting `null`
	// would spread a check for an impossible case through every call site, which is a worse lie than
	// the one it prevents. The same override is on every `f64` that crosses.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub left_width: f64,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub right_width: f64,
	/// Which background map the map sits on, or `none`.
	///
	/// Held as a plain string rather than an enum: the catalogue is a webview concern, and the core
	/// has no reason to know what `graybeard` is. The webview rejects a value it does not recognise,
	/// so an old file cannot break the map.
	pub background: String,
	/// Where the camera was, or `None` if it has never been moved.
	///
	/// Here rather than in a file of its own because it is window state with exactly this recovery
	/// policy — a camera that will not parse costs nothing to forget — and because `background`,
	/// also a map setting rather than a pane one, already lives here.
	///
	/// `None` is not the same as a default camera: it means *nothing to restore*, so a first run
	/// still fits the view to whatever is opened instead of jumping to null island.
	pub view: Option<Camera>,
}

/// Where the map camera is.
///
/// [Q16](../../docs/decisions.md) is the reason this crosses the boundary at all: a reloaded
/// webview must come back looking the way the user left it, and the map is the largest thing in
/// the window to come back wrong.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Camera {
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub lng: f64,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub lat: f64,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub zoom: f64,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub bearing: f64,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub pitch: f64,
}

impl Camera {
	/// Drops a camera that cannot be flown to, and pulls a survivable one into range.
	///
	/// Non-finite is *dropped rather than clamped*: `NaN` here means the file is not describing a
	/// camera at all, and inventing one from its fragments would restore a view the user never had.
	/// Out-of-range but finite is a different thing — a hand-edited pitch of 90 is a real intent
	/// expressed past the limit, so it is clamped to what MapLibre accepts.
	#[must_use]
	fn sanitised(self) -> Option<Self> {
		let finite = [self.lng, self.lat, self.zoom, self.bearing, self.pitch]
			.iter()
			.all(|value| value.is_finite());
		finite.then(|| Self {
			lng: self.lng,
			lat: self.lat.clamp(-90.0, 90.0),
			zoom: self.zoom.clamp(0.0, 24.0),
			bearing: self.bearing.rem_euclid(360.0),
			pitch: self.pitch.clamp(0.0, 85.0),
		})
	}
}

impl Default for Layout {
	fn default() -> Self {
		Self {
			panes: PANES.iter().map(PaneState::from).collect(),
			left_width: DEFAULT_LEFT_WIDTH,
			right_width: DEFAULT_RIGHT_WIDTH,
			// Off, because G5 promises Studio works with no network once its assets are installed.
			// A background is the user asking for remote data, explicitly.
			background: "none".to_string(),
			view: None,
		}
	}
}

/// Which sidebar a pane sits in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub enum Side {
	Left,
	Right,
}

/// One pane's place in the layout.
///
/// The id is the whole contract with the webview: the core decides where a pane sits and whether it
/// is open, the webview decides what it contains and what it is called. A title is presentation, so
/// it is not stored — it would be one more thing to keep in step across a boundary for no gain.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct PaneState {
	pub id: String,
	pub side: Side,
	pub open: bool,
}

impl From<&(&str, Side, bool)> for PaneState {
	fn from((id, side, open): &(&str, Side, bool)) -> Self {
		Self {
			id: (*id).to_string(),
			side: *side,
			open: *open,
		}
	}
}

/// The panes this build has, in the order a fresh install shows them.
///
/// Adding one here is the whole cost of adding a pane to the application — that is the point of
/// [Q31](../../docs/decisions.md). The webview supplies the title and the contents for each id and
/// ignores any it does not recognise, so the two halves can also land in either order.
const PANES: &[(&str, Side, bool)] = &[
	// Left: the documents. Open, because at S2 it is the only pane with anything in it.
	("pipeline", Side::Left, true),
	// Right: what the pipeline turns out to be. **No `parameters` pane** — the selected node carries
	// its own arguments in the chain ([Q32]), which is what moved [Q31]'s axis from
	// document-versus-selection to what-you-are-building versus what-it-turns-out-to-be.
	("output", Side::Right, true),
	("inspector", Side::Right, true),
];

impl Layout {
	/// Reads the layout, treating any problem as "the default one".
	///
	/// Disposable like [`Recents::load`] and for the same reason: refusing to start because a pane
	/// width would not parse is a far worse outcome than opening at the default width.
	#[must_use]
	pub fn load(dir: &Path) -> Self {
		std::fs::read_to_string(dir.join(LAYOUT_FILE))
			.ok()
			.and_then(|text| serde_json::from_str::<Self>(&text).ok())
			.map(Self::normalised)
			.unwrap_or_default()
	}

	pub fn save(&self, dir: &Path) -> Result<()> {
		write_atomically(
			&dir.join(LAYOUT_FILE),
			&serde_json::to_string_pretty(&self.clone().normalised()).context("serialising layout")?,
		)
	}

	/// Makes any `Layout` a usable one: widths in range, camera in range, panes reconciled against
	/// the catalogue.
	///
	/// The single normalisation point, called on load, on save and by `set_layout` — a caller
	/// holding a layout in memory needs the same value that would be written to disk, and
	/// normalising only on save would let the two drift.
	#[must_use]
	pub fn normalised(mut self) -> Self {
		self.left_width = clamp_width(self.left_width, DEFAULT_LEFT_WIDTH);
		self.right_width = clamp_width(self.right_width, DEFAULT_RIGHT_WIDTH);
		self.panes = reconcile_panes(std::mem::take(&mut self.panes));
		self.view = self.view.and_then(Camera::sanitised);
		self
	}
}

/// Brings a stored pane list back in line with the panes this build has.
///
/// Three things it fixes, all of which a real `layout.json` will eventually contain:
///
/// * **A pane this build does not have** — from a newer version, or one that was removed — is
///   dropped. Rendering is by id, so an unknown one would be an empty box with a heading.
/// * **A pane the file has never heard of** is appended, so upgrading gains the new pane rather
///   than hiding it until someone deletes their layout. Appended *last in its sidebar*, because a
///   remembered order is the user's and a new arrival has not earned a place in the middle of it.
/// * **A duplicate** keeps its first appearance. Nothing produces one, but a hand-edited file can,
///   and two panes with one id would render the same content twice and toggle together.
fn reconcile_panes(stored: Vec<PaneState>) -> Vec<PaneState> {
	let mut panes: Vec<PaneState> = Vec::with_capacity(PANES.len());
	for pane in stored {
		let known = PANES.iter().any(|(id, _, _)| *id == pane.id);
		if known && !panes.iter().any(|kept| kept.id == pane.id) {
			panes.push(pane);
		}
	}
	for entry in PANES {
		if !panes.iter().any(|pane| pane.id == entry.0) {
			panes.push(PaneState::from(entry));
		}
	}
	panes
}

/// Forces a width into the usable range, including when it is `NaN` — which `f64::clamp`
/// propagates rather than resolving, and which JSON can carry in from a hand-edited file.
fn clamp_width(width: f64, fallback: f64) -> f64 {
	if width.is_finite() {
		width.clamp(MIN_PANE_WIDTH, MAX_PANE_WIDTH)
	} else {
		fallback
	}
}

// ---------------------------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------------------------

/// A named view: where the camera was, and what it was looking at.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Bookmark {
	pub name: String,
	/// The source this view belongs to, so a bookmark can offer to reopen it.
	pub source: Option<String>,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub lng: f64,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub lat: f64,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub zoom: f64,
	#[serde(default)]
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub bearing: f64,
	#[serde(default)]
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub pitch: f64,
	/// Seconds since the Unix epoch, emitted as a `number` — a double holds them exactly for the
	/// next quarter of a million years, and `u32` would overflow in 2106.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
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
		let dir = crate::testing::dir("corrupt-recents");
		std::fs::write(dir.join("recents.json"), "{ not json").unwrap();
		assert!(Recents::load(&dir).entries().is_empty());
	}

	/// The gap that let a real bug through: every existing recents test worked on an in-memory
	/// `Recents` and never wrote one to disk, so `save` taking a *file* path while every caller
	/// passed a *directory* type-checked and shipped. Recents silently stopped persisting — the
	/// failure went to stderr, because an MRU list is not worth failing an open over.
	#[test]
	fn recents_are_saved_into_the_directory_they_are_given() -> Result<()> {
		let dir = crate::testing::dir("recents-roundtrip");
		let mut recents = Recents::default();
		recents.record("/a.versatiles");
		recents.record("/b.versatiles");
		recents.save(&dir)?;

		assert!(
			dir.join("recents.json").is_file(),
			"the file belongs inside the directory"
		);
		let reloaded = Recents::load(&dir);
		let sources: Vec<_> = reloaded.entries().iter().map(|e| e.source.as_str()).collect();
		assert_eq!(sources, ["/b.versatiles", "/a.versatiles"]);
		Ok(())
	}

	/// Both lists take a directory and name their own file, so neither can land on the other's.
	#[test]
	fn the_two_lists_do_not_share_a_file() -> Result<()> {
		let dir = crate::testing::dir("two-files");
		Recents::default().save(&dir)?;
		Bookmarks::default().save(&dir)?;
		assert!(dir.join("recents.json").is_file());
		assert!(dir.join("bookmarks.json").is_file());
		Ok(())
	}

	/// What the caller actually did wrong: handing over the directory itself. Renaming onto a
	/// directory fails with a bare `Is a directory (os error 21)`, which says nothing about which
	/// call was wrong.
	#[test]
	fn writing_onto_a_directory_says_so() {
		let dir = crate::testing::dir("not-a-file");
		let error = write_atomically(&dir, "{}").unwrap_err();
		assert!(format!("{error:#}").contains("is a directory"), "got {error:#}");
	}

	/// The temp file must stay inside the target directory. `with_extension` did not: for a target
	/// with a dotted name it replaced the last segment, putting the temp file in the parent.
	#[test]
	fn the_temporary_file_stays_beside_its_target() -> Result<()> {
		let parent = crate::testing::dir("temp-placement");
		let dir = parent.join("org.versatiles.studio");
		std::fs::create_dir_all(&dir)?;
		Recents::default().save(&dir)?;

		let strays: Vec<_> = std::fs::read_dir(&parent)?
			.filter_map(std::result::Result::ok)
			.map(|e| e.file_name().to_string_lossy().into_owned())
			.filter(|name| name != "org.versatiles.studio")
			.collect();
		assert!(
			strays.is_empty(),
			"nothing should be written beside the directory: {strays:?}"
		);
		Ok(())
	}

	fn pane(id: &str, side: Side, open: bool) -> PaneState {
		PaneState {
			id: id.to_string(),
			side,
			open,
		}
	}

	#[test]
	fn a_layout_survives_a_round_trip() -> Result<()> {
		let dir = crate::testing::dir("layout-roundtrip");
		let mut layout = Layout {
			left_width: 320.0,
			right_width: 360.0,
			background: "eclipse".to_string(),
			..Layout::default()
		};
		// A moved, reordered and collapsed pane — the three things the list exists to remember.
		layout.panes = vec![
			pane("output", Side::Left, false),
			pane("pipeline", Side::Left, true),
			pane("inspector", Side::Right, false),
		];
		layout.save(&dir)?;
		assert_eq!(Layout::load(&dir), layout);
		Ok(())
	}

	/// Q22 wants each pane to collapse independently, and [Q31] makes that per-pane state rather
	/// than a flag per section — so collapsing one has to leave the others exactly as they were.
	#[test]
	fn panes_collapse_independently() -> Result<()> {
		let dir = crate::testing::dir("layout-independent");
		let mut layout = Layout::default();
		for state in &mut layout.panes {
			state.open = state.id == "pipeline";
		}
		layout.save(&dir)?;

		let loaded = Layout::load(&dir);
		assert!(loaded.panes.iter().find(|p| p.id == "pipeline").unwrap().open);
		assert!(loaded.panes.iter().filter(|p| p.id != "pipeline").all(|p| !p.open));
		Ok(())
	}

	/// A pane this build does not have must not reach the webview, which renders by id and would
	/// draw an empty box with a heading.
	#[test]
	fn a_pane_this_build_does_not_have_is_dropped() {
		let layout = Layout {
			panes: vec![
				pane("pipeline", Side::Left, true),
				pane("from-the-future", Side::Left, true),
			],
			..Layout::default()
		}
		.normalised();

		assert!(layout.panes.iter().all(|p| p.id != "from-the-future"));
		assert!(layout.panes.iter().any(|p| p.id == "pipeline"));
	}

	/// And the other direction: upgrading has to *gain* the new pane, not hide it until somebody
	/// deletes their layout file.
	#[test]
	fn a_pane_the_file_has_never_heard_of_is_added() {
		let layout = Layout {
			panes: vec![pane("pipeline", Side::Left, false)],
			..Layout::default()
		}
		.normalised();

		let ids: Vec<&str> = layout.panes.iter().map(|p| p.id.as_str()).collect();
		assert_eq!(ids, ["pipeline", "output", "inspector"]);
		assert!(!layout.panes[0].open, "the remembered pane kept its own state");
	}

	/// A remembered order is the user's; a pane arriving in a new version has not earned a place in
	/// the middle of it.
	#[test]
	fn a_remembered_order_survives_and_new_panes_go_last() {
		let layout = Layout {
			panes: vec![pane("inspector", Side::Right, true), pane("pipeline", Side::Left, true)],
			..Layout::default()
		}
		.normalised();

		let ids: Vec<&str> = layout.panes.iter().map(|p| p.id.as_str()).collect();
		assert_eq!(ids, ["inspector", "pipeline", "output"]);
	}

	/// Nothing produces a duplicate, but a hand-edited file can — and two panes with one id would
	/// render the same content twice and toggle together.
	#[test]
	fn a_duplicated_pane_keeps_its_first_appearance() {
		let layout = Layout {
			panes: vec![pane("pipeline", Side::Left, false), pane("pipeline", Side::Right, true)],
			..Layout::default()
		}
		.normalised();

		let pipelines: Vec<&PaneState> = layout.panes.iter().filter(|p| p.id == "pipeline").collect();
		assert_eq!(pipelines.len(), 1);
		assert_eq!(pipelines[0].side, Side::Left);
		assert!(!pipelines[0].open);
	}

	/// A `layout.json` from before the pane list existed has no `panes` key at all. It must open at
	/// the defaults rather than with no panes — which would be an application with no interface.
	#[test]
	fn a_layout_file_from_before_the_pane_list_still_opens() {
		let old =
			r#"{"pipelineOpen":true,"styleOpen":false,"leftWidth":300.0,"rightWidth":340.0,"background":"eclipse"}"#;
		let layout: Layout = serde_json::from_str::<Layout>(old).unwrap().normalised();

		assert_eq!(
			layout.panes,
			Layout::default().panes,
			"the panes fall back to the catalogue"
		);
		assert_eq!(layout.left_width, 300.0, "and everything still recognised is kept");
		assert_eq!(layout.background, "eclipse");
	}

	/// A width from a corrupt or hand-edited file must not be able to produce a pane that has
	/// swallowed the map, or one too narrow to grab and drag back.
	#[test]
	fn an_absurd_width_is_clamped_rather_than_obeyed() -> Result<()> {
		let dir = crate::testing::dir("layout-clamp");
		for (written, expected) in [(0.0, MIN_PANE_WIDTH), (99_999.0, MAX_PANE_WIDTH), (300.0, 300.0)] {
			Layout {
				left_width: written,
				right_width: written,
				..Layout::default()
			}
			.save(&dir)?;
			let loaded = Layout::load(&dir);
			assert_eq!(loaded.left_width, expected, "left width {written}");
			assert_eq!(loaded.right_width, expected, "right width {written}");
		}
		Ok(())
	}

	/// `f64::clamp` propagates `NaN` instead of resolving it, and JSON can carry one in.
	#[test]
	fn a_non_finite_width_falls_back_to_the_default() {
		let dir = crate::testing::dir("layout-nan");
		std::fs::write(dir.join("layout.json"), r#"{"leftWidth": null}"#).unwrap();
		assert_eq!(Layout::load(&dir).left_width, DEFAULT_LEFT_WIDTH);

		let recovered = Layout {
			left_width: f64::NAN,
			..Layout::default()
		}
		.normalised();
		assert_eq!(recovered.left_width, DEFAULT_LEFT_WIDTH);
	}

	/// The camera is the largest thing in the window, so a reload that forgets it is the most
	/// visible way [Q16]'s invariant can be broken — and it was, until `view` existed.
	#[test]
	fn the_camera_survives_a_round_trip() -> Result<()> {
		let dir = crate::testing::dir("layout-camera");
		let camera = Camera {
			lng: 13.4,
			lat: 52.5,
			zoom: 11.25,
			bearing: 30.0,
			pitch: 45.0,
		};
		Layout {
			view: Some(camera),
			..Layout::default()
		}
		.save(&dir)?;

		assert_eq!(Layout::load(&dir).view, Some(camera));
		Ok(())
	}

	/// Never moved is not the same as moved to 0/0: one has nothing to restore and must leave the
	/// map free to fit whatever is opened, the other is a view the user chose.
	#[test]
	fn a_camera_that_was_never_moved_stays_absent() -> Result<()> {
		let dir = crate::testing::dir("layout-no-camera");
		Layout::default().save(&dir)?;
		assert_eq!(Layout::load(&dir).view, None);
		Ok(())
	}

	#[test]
	fn a_non_finite_camera_is_dropped_rather_than_repaired() {
		let recovered = Layout {
			view: Some(Camera {
				lng: f64::NAN,
				lat: 52.5,
				zoom: 11.0,
				bearing: 0.0,
				pitch: 0.0,
			}),
			..Layout::default()
		}
		.normalised();

		assert_eq!(recovered.view, None, "half a camera is not a view the user ever had");
	}

	#[test]
	fn a_finite_camera_out_of_range_is_pulled_back_in() {
		let recovered = Layout {
			view: Some(Camera {
				lng: 13.4,
				lat: 120.0,
				zoom: 99.0,
				bearing: 400.0,
				pitch: 90.0,
			}),
			..Layout::default()
		}
		.normalised();

		let view = recovered.view.expect("finite values are clamped, not dropped");
		assert_eq!(view.lat, 90.0);
		assert_eq!(view.zoom, 24.0);
		assert_eq!(view.bearing, 40.0);
		assert_eq!(view.pitch, 85.0);
	}

	/// Same policy as recents: losing pane state costs nothing, refusing to start costs everything.
	#[test]
	fn a_corrupt_layout_resets_silently() {
		let dir = crate::testing::dir("layout-corrupt");
		std::fs::write(dir.join("layout.json"), "{ not json").unwrap();
		assert_eq!(Layout::load(&dir), Layout::default());
	}

	/// A field added in a later stage must not invalidate a file written by an earlier one.
	#[test]
	fn an_older_layout_file_still_loads() {
		let dir = crate::testing::dir("layout-forward");
		std::fs::write(dir.join("layout.json"), r#"{"background": "eclipse"}"#).unwrap();
		let loaded = Layout::load(&dir);
		assert_eq!(loaded.background, "eclipse", "what the file said is honoured");
		assert_eq!(loaded.left_width, DEFAULT_LEFT_WIDTH, "what it omits takes the default");
		assert_eq!(
			loaded.panes,
			Layout::default().panes,
			"and the panes fall back to the catalogue"
		);
	}

	/// Off by default: Studio has to work with no network once its assets are installed (G5).
	#[test]
	fn no_background_until_one_is_chosen() {
		assert_eq!(Layout::default().background, "none");
	}

	/// The opposite policy: these are user-created, so silence would be data loss.
	#[test]
	fn corrupt_bookmarks_are_an_error_and_the_file_is_left_alone() {
		let dir = crate::testing::dir("corrupt-bookmarks");
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
		let dir = crate::testing::dir("first-run");
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
		let dir = crate::testing::dir("roundtrip");
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
		let dir = crate::testing::dir("atomic");
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
