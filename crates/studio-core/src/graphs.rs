//! The set of VPL graphs a project holds (S2.12, [Q32]).
//!
//! [Q25] said one pipeline document per window, and answered "several sources" with a composite
//! node — `from_stacked [ a, b ]`. That merges inputs into **one** tile source. A map style needs
//! several *independently addressable* ones, because a style is vector tiles plus hillshade plus
//! terrain, each named separately in its `sources`. `from_stacked` stays; it answers a different
//! question.
//!
//! **A graph is a named VPL document producing one named tile source.** The name is the identity in
//! three places at once — the server mount, the source name in `style.json`, and the `.vpl`
//! filename — which is what makes renaming one a real operation rather than a label change.
//!
//! **Identity is the id, not the name.** A rename would otherwise invalidate every reference the
//! webview is holding mid-edit; the id survives it, and the name is what the outside world sees.
//!
//! [Q25]: ../../docs/decisions.md
//! [Q32]: ../../docs/decisions.md

use crate::export::Bounds;
use crate::vpl::Document;
use anyhow::{Result, bail, ensure};
use serde::Serialize;
use std::path::PathBuf;

/// Identifies a graph for as long as the project is open.
// `u32` rather than `u64` for the reason `JobId` is: it crosses to the webview, and specta will not
// emit a 64-bit integer as a plain number.
pub type GraphId = u32;

/// How long a graph's name may be.
///
/// It becomes a filename and a URL path segment, so this is about the shortest limit either of
/// those imposes rather than about anything Studio cares about.
const MAX_NAME: usize = 64;

/// One graph: a VPL document, what it is called, and where it came from.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct GraphInfo {
	pub id: GraphId,
	pub name: String,
	/// The `.vpl` this came from, if any, so Save has somewhere to write without asking.
	pub path: Option<String>,
	/// Whether the document differs from what is on disk.
	pub dirty: bool,
	/// What an export of this graph is narrowed to (F2, S5.2) — empty until someone sets one.
	pub crop: Bounds,
}

/// A graph and the parts of it only the core needs.
#[derive(Debug, Clone)]
pub struct Graph {
	pub id: GraphId,
	pub name: String,
	pub document: Document,
	/// Path and the text as last saved, so "is there anything to save" is answered by comparison
	/// rather than by a flag someone has to remember to set.
	pub file: Option<(PathBuf, String)>,
	/// The bbox and zoom range an export of this graph is narrowed to (F2, S5.2).
	///
	/// **On the graph, not on the export dialog.** A crop is something you arrive at by looking at
	/// the map and adjusting — the dialog is a modal that covers it — and it is worth keeping: a
	/// project reopened tomorrow should still be about the same city. It is saved in the manifest
	/// for that reason, and it is what the export and its estimate both narrow to, so the number
	/// shown and the tiles written cannot disagree.
	pub crop: Bounds,
}

impl Graph {
	#[must_use]
	pub fn info(&self) -> GraphInfo {
		GraphInfo {
			id: self.id,
			name: self.name.clone(),
			path: self.file.as_ref().map(|(path, _)| path.to_string_lossy().into_owned()),
			// A graph with no file behind it is dirty as soon as it has content: there is somewhere
			// it could be saved to, and nowhere it has been.
			dirty: self
				.file
				.as_ref()
				.is_none_or(|(_, saved)| saved != self.document.text()),
			crop: self.crop,
		}
	}
}

/// Every graph in the project, in the order they are shown.
#[derive(Debug, Clone, Default)]
pub struct Graphs {
	graphs: Vec<Graph>,
	next_id: GraphId,
}

impl Graphs {
	#[must_use]
	pub fn new() -> Self {
		Self::default()
	}

	#[must_use]
	pub fn is_empty(&self) -> bool {
		self.graphs.is_empty()
	}

	#[must_use]
	pub fn list(&self) -> Vec<GraphInfo> {
		self.graphs.iter().map(Graph::info).collect()
	}

	#[must_use]
	pub fn get(&self, id: GraphId) -> Option<&Graph> {
		self.graphs.iter().find(|graph| graph.id == id)
	}

	#[must_use]
	pub fn get_mut(&mut self, id: GraphId) -> Option<&mut Graph> {
		self.graphs.iter_mut().find(|graph| graph.id == id)
	}

	#[must_use]
	pub fn by_name(&self, name: &str) -> Option<&Graph> {
		self.graphs.iter().find(|graph| graph.name == name)
	}

	pub fn iter(&self) -> impl Iterator<Item = &Graph> {
		self.graphs.iter()
	}

	/// Adds a graph, making its name unique against the ones already here.
	///
	/// The suggested name is a suggestion: two GeoJSONs called `places.geojson` in different folders
	/// both want to be `places`, and the second becoming `places-2` is better than a refusal or a
	/// silent overwrite of the first.
	pub fn add(&mut self, suggested: &str, document: Document, file: Option<(PathBuf, String)>) -> GraphId {
		self.next_id += 1;
		let id = self.next_id;
		let name = self.unique(&sanitise(suggested), None);
		self.graphs.push(Graph {
			id,
			name,
			document,
			file,
			crop: Bounds::default(),
		});
		id
	}

	/// Narrows what an export of this graph writes. `false` when there is no such graph.
	///
	/// Checked here rather than at the write, so an inside-out box is refused while the field that
	/// caused it is still on screen — the reason [`Bounds::check`] exists.
	pub fn set_crop(&mut self, id: GraphId, crop: Bounds) -> Result<bool> {
		crop.check()?;
		let Some(graph) = self.get_mut(id) else {
			return Ok(false);
		};
		graph.crop = crop;
		Ok(true)
	}

	/// Removes a graph. `false` when there was none with that id.
	pub fn remove(&mut self, id: GraphId) -> bool {
		let before = self.graphs.len();
		self.graphs.retain(|graph| graph.id != id);
		self.graphs.len() != before
	}

	/// Renames a graph, and reports the name it actually took.
	///
	/// **Rejected rather than adjusted.** Unlike [`add`](Self::add), where a suggestion comes from a
	/// filename nobody chose, a rename is something a person typed — silently turning `basemap` into
	/// `basemap-2` because the name is taken is a worse answer than saying so.
	///
	/// The style references this name ([Q32]); rewriting those references is the caller's other half
	/// of the operation, and it has to happen with this or not at all.
	pub fn rename(&mut self, id: GraphId, name: &str) -> Result<String> {
		let cleaned = sanitise(name);
		ensure!(!cleaned.is_empty(), "a graph needs a name");
		ensure!(
			cleaned.len() <= MAX_NAME,
			"a graph name may be at most {MAX_NAME} characters"
		);
		if self.graphs.iter().any(|graph| graph.id != id && graph.name == cleaned) {
			bail!("another graph is already called '{cleaned}'");
		}
		let Some(graph) = self.get_mut(id) else {
			bail!("no such graph");
		};
		graph.name.clone_from(&cleaned);
		Ok(cleaned)
	}

	/// A name not already taken, adding `-2`, `-3` … until it is free.
	fn unique(&self, wanted: &str, except: Option<GraphId>) -> String {
		let base = if wanted.is_empty() { "graph" } else { wanted };
		let taken = |name: &str| {
			self
				.graphs
				.iter()
				.any(|graph| Some(graph.id) != except && graph.name == name)
		};
		if !taken(base) {
			return base.to_string();
		}
		(2..)
			.map(|n| format!("{base}-{n}"))
			.find(|candidate| !taken(candidate))
			.unwrap_or_else(|| base.to_string())
	}
}

/// Reduces a name to what is safe as a URL path segment and a filename at once.
///
/// Lowercase ASCII, digits and `-`. That is stricter than either constraint alone, deliberately: a
/// name has to survive a mount URL, a `.vpl` filename on three filesystems and a JSON key in
/// `style.json`, and the intersection is small enough that guessing at it per platform is not worth
/// the bugs.
/// The name a source suggests: its filename, without directories or extension.
///
/// One rule for both ways a graph is created — opening a `.vpl`, and importing anything else — so
/// that `berlin.mbtiles` and `berlin.vpl` cannot disagree about what the graph is called. [Q35]
/// makes this the only moment the name is derived: saving to a different filename later does not
/// rename anything, so getting it right here is the whole of getting it right.
///
/// Falls back to `graph` when there is no usable stem — a bare directory, or a name that sanitises
/// away to nothing — which is what [`Graphs::add`] would have produced regardless.
#[must_use]
pub fn name_for_source(source: &str) -> String {
	std::path::Path::new(source)
		.file_stem()
		.map(|stem| stem.to_string_lossy().into_owned())
		.filter(|stem| !sanitise(stem).is_empty())
		.unwrap_or_else(|| "graph".to_string())
}

#[must_use]
pub fn sanitise(name: &str) -> String {
	let mut out = String::with_capacity(name.len());
	for ch in name.trim().chars() {
		if ch.is_ascii_alphanumeric() {
			out.push(ch.to_ascii_lowercase());
		} else if !out.ends_with('-') {
			out.push('-');
		}
	}
	out.trim_matches('-').chars().take(MAX_NAME).collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	fn doc(text: &str) -> Document {
		Document::parse(text).unwrap()
	}

	fn graphs() -> Graphs {
		Graphs::new()
	}

	#[test]
	fn a_name_survives_a_url_a_filename_and_a_json_key() {
		assert_eq!(sanitise("Berlin Extract"), "berlin-extract");
		assert_eq!(sanitise("  spaced  out  "), "spaced-out");
		assert_eq!(sanitise("osm/2024"), "osm-2024");
		assert_eq!(sanitise("a...b"), "a-b", "a run of punctuation is one separator");
		assert_eq!(sanitise("--edges--"), "edges");
		assert_eq!(sanitise("Grüße"), "gr-e", "non-ASCII is not smuggled into a URL");
		assert_eq!(sanitise("!!!"), "");
		assert!(sanitise(&"x".repeat(200)).len() <= MAX_NAME);
	}

	/// Two `places.geojson` files in different folders both want to be `places`.
	#[test]
	fn a_suggested_name_gives_way_to_one_already_taken() {
		let mut graphs = graphs();
		graphs.add("places", doc("from_debug format=png"), None);
		let second = graphs.add("places", doc("from_debug format=webp"), None);
		let third = graphs.add("Places", doc("from_debug format=jpg"), None);

		assert_eq!(graphs.get(second).unwrap().name, "places-2");
		assert_eq!(
			graphs.get(third).unwrap().name,
			"places-3",
			"and sanitising happens first"
		);
	}

	/// A rename is something a person typed, so a clash is reported rather than papered over.
	#[test]
	fn a_rename_onto_a_taken_name_is_refused() {
		let mut graphs = graphs();
		let a = graphs.add("basemap", doc("from_debug format=png"), None);
		let b = graphs.add("hillshade", doc("from_debug format=png"), None);

		let error = graphs.rename(b, "basemap").unwrap_err();
		assert!(format!("{error:#}").contains("already called"), "{error:#}");
		assert_eq!(graphs.get(b).unwrap().name, "hillshade", "and nothing changed");
		assert_eq!(graphs.get(a).unwrap().name, "basemap");
	}

	#[test]
	fn a_rename_cleans_what_it_accepts() {
		let mut graphs = graphs();
		let id = graphs.add("basemap", doc("from_debug format=png"), None);

		assert_eq!(graphs.rename(id, "Berlin Extract").unwrap(), "berlin-extract");
		assert_eq!(graphs.get(id).unwrap().name, "berlin-extract");
		// Renaming to what it already is must not collide with itself.
		assert_eq!(graphs.rename(id, "berlin-extract").unwrap(), "berlin-extract");
	}

	#[test]
	fn a_name_that_sanitises_to_nothing_is_refused() {
		let mut graphs = graphs();
		let id = graphs.add("basemap", doc("from_debug format=png"), None);

		assert!(graphs.rename(id, "!!!").is_err());
		assert!(graphs.rename(id, "   ").is_err());
		assert_eq!(graphs.get(id).unwrap().name, "basemap");
	}

	/// The reason identity is the id: a rename must not invalidate a reference held mid-edit.
	#[test]
	fn an_id_outlives_the_name_it_started_with() {
		let mut graphs = graphs();
		let id = graphs.add("basemap", doc("from_debug format=png"), None);

		graphs.rename(id, "osm").unwrap();
		assert_eq!(graphs.get(id).unwrap().name, "osm");
		assert!(graphs.by_name("basemap").is_none());
		assert_eq!(graphs.by_name("osm").map(|g| g.id), Some(id));
	}

	/// Ids are never reused, so a stale reference to a removed graph resolves to nothing rather
	/// than to whatever was created next.
	#[test]
	fn a_removed_graphs_id_is_not_handed_out_again() {
		let mut graphs = graphs();
		let first = graphs.add("a", doc("from_debug format=png"), None);
		assert!(graphs.remove(first));
		assert!(!graphs.remove(first), "removing twice is not an error, it is a no-op");

		let second = graphs.add("b", doc("from_debug format=png"), None);
		assert_ne!(first, second);
		assert!(graphs.get(first).is_none());
	}

	#[test]
	fn a_source_names_its_graph_after_the_file() {
		assert_eq!(name_for_source("berlin.mbtiles"), "berlin");
		assert_eq!(name_for_source("/data/tiles/berlin.mbtiles"), "berlin");
		assert_eq!(name_for_source("places.geojson"), "places");
		// A URL is a path as far as the stem is concerned.
		assert_eq!(name_for_source("https://example.org/tiles/osm.versatiles"), "osm");
	}

	/// The two ways a graph is created must not disagree: `open_vpl` derives the same name.
	#[test]
	fn a_vpl_and_the_container_it_reads_agree_on_the_stem() {
		assert_eq!(name_for_source("berlin.vpl"), name_for_source("berlin.mbtiles"));
	}

	#[test]
	fn a_source_with_no_usable_stem_falls_back() {
		assert_eq!(name_for_source("/data/tiles/"), "tiles");
		assert_eq!(name_for_source(""), "graph");
		// Sanitises away to nothing, so it is no better than the fallback.
		assert_eq!(name_for_source("///"), "graph");
	}

	/// The stem is a *suggestion*: `add` still makes it unique, which is the whole reason two
	/// `places.geojson` in different folders can both be opened.
	#[test]
	fn two_files_with_one_name_do_not_collide() {
		let mut graphs = graphs();
		let first = graphs.add(
			&name_for_source("/a/places.geojson"),
			doc("from_debug format=png"),
			None,
		);
		let second = graphs.add(
			&name_for_source("/b/places.geojson"),
			doc("from_debug format=png"),
			None,
		);

		assert_eq!(graphs.get(first).unwrap().name, "places");
		assert_eq!(graphs.get(second).unwrap().name, "places-2");
	}

	/// A freed name becomes available again — otherwise a project would accumulate `-2`s forever.
	#[test]
	fn removing_a_graph_frees_its_name() {
		let mut graphs = graphs();
		let first = graphs.add("places", doc("from_debug format=png"), None);
		graphs.remove(first);

		let second = graphs.add("places", doc("from_debug format=png"), None);
		assert_eq!(graphs.get(second).unwrap().name, "places");
	}

	#[test]
	fn dirty_is_a_comparison_not_a_flag() {
		let mut graphs = graphs();
		let saved = "from_debug format=png";
		let id = graphs.add("a", doc(saved), Some((PathBuf::from("/tmp/a.vpl"), saved.to_string())));
		assert!(!graphs.get(id).unwrap().info().dirty);

		graphs.get_mut(id).unwrap().document = doc("from_debug format=webp");
		assert!(graphs.get(id).unwrap().info().dirty);

		// A graph with no file is dirty from the start: somewhere to save, nowhere it has been.
		let unsaved = graphs.add("b", doc(saved), None);
		assert!(graphs.get(unsaved).unwrap().info().dirty);
	}
}
