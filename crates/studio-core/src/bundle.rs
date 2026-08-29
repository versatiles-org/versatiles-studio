//! A project you can send somebody (G1, S5.1).
//!
//! [`project::save`](crate::project::save) writes a directory whose `.vpl` files are real pipelines,
//! and whose `filename=` arguments point wherever the file was imported from, which on this
//! machine is an absolute path under someone's home directory. Copy that directory to another
//! machine and every pipeline in it names a file that is not there. The project is *readable*
//! anywhere and *runnable* only here.
//!
//! This module closes that gap: it carries the data in, rewrites the pipelines to name their copies,
//! and writes the result either as a directory or as one `.zip`.
//!
//! **A plan, then the writing.** [`plan`] works out what would be carried and what it weighs
//! without touching the destination, so a surface can say "carries 3 files, 240 MB" using the same
//! computation that will do it - the split [`crate::estimate`] and [`crate::export`] already use for
//! the same reason.
//!
//! **What is left alone.** A `https://` source works from anywhere, so it is not carried and not
//! rewritten. A file that is already inside the project directory is already coming along.
//!
//! **What is missing is reported, not fatal.** A pipeline naming a file that has been moved is a
//! project someone still wants a copy of; refusing the whole bundle over one absent source would
//! trade a working nine-tenths for nothing.
//!
//! **Not the style bundle.** S4.6 exports a style with its sprites and glyphs, which is also a
//! folder-or-zip of one thing plus what it needs; that one belongs to [`crate::style`]. This is the
//! project. The surface calls this one "Save a copy…", so the two never meet in a menu.

use crate::vpl::{Document, Node, Pipeline, Span};
use anyhow::{Context, Result};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// The subdirectory carried files land in.
///
/// A subdirectory rather than the project root: a graph called `cities` writes `cities.vpl`, and a
/// CSV called `cities.csv` beside it reads as a pair when it is a coincidence. `data/` also makes
/// the manifest, the pipelines and the style - the parts a person edits - the whole of what they see
/// when they open the folder.
pub const DATA_DIR: &str = "data";

/// Fields whose value names a file.
///
/// **A list, because nothing in the metadata says so.** `field_meta` gives each parameter a
/// `rust_type`, and every one of these is `String` - indistinguishable from `format` or
/// `lon_column`. Nor are they consistently named: `filename` on six operations, and then
/// `data_source_path`, `tilejson_file`, `vector_layers_file`, `tilejson_update_file`.
///
/// Qualified by operation rather than matched by name, so a future `filename` meaning something else
/// cannot silently join the list. Kept beside a test that fails when upstream adds an operation with
/// a file-valued field that is not here, because the failure this list can have is being out of
/// date - and a bundle that quietly leaves a source behind is the worst way to find that out.
///
/// The better fix is upstream marking the field, the same way it marks enum variants; worth an issue
/// now that there are twelve of these rather than one.
const FILE_FIELDS: [(&str, &str); 12] = [
	("filter", "filename"),
	("from_container", "filename"),
	("from_csv", "filename"),
	("from_gdal_dem", "filename"),
	("from_gdal_raster", "filename"),
	("from_geo", "filename"),
	("from_tile", "filename"),
	("from_tilejson", "url"),
	("meta_update", "tilejson_file"),
	("meta_update", "tilejson_update_file"),
	("meta_update", "vector_layers_file"),
	("vector_update_properties", "data_source_path"),
];

/// Whether `operation.field` names a file.
#[must_use]
fn names_a_file(operation: &str, field: &str) -> bool {
	FILE_FIELDS.iter().any(|(op, name)| *op == operation && *name == field)
}

/// What one reference turned out to be.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub enum ReferenceKind {
	/// A URL. Works from anywhere, so it is neither carried nor rewritten.
	Remote,
	/// A file that is there.
	Local {
		#[cfg_attr(feature = "bindings", specta(type = String))]
		path: PathBuf,
		/// Its size, so a surface can say what a bundle will cost before writing it.
		#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
		bytes: u64,
	},
	/// Named, and not where it says. Carried as nothing; the pipeline keeps the name it had, so a
	/// bundle opened somewhere the file *does* exist still works.
	Missing {
		#[cfg_attr(feature = "bindings", specta(type = String))]
		path: PathBuf,
	},
}

/// One file a pipeline names.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Reference {
	/// The graph it was found in.
	pub graph: String,
	/// The parameter, as written - `filename`, `data_source_path`, …
	pub field: String,
	/// What it says, before any rewriting.
	pub value: String,
	pub kind: ReferenceKind,
}

/// A file the bundle will carry, and where it will land.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Carried {
	#[cfg_attr(feature = "bindings", specta(type = String))]
	pub from: PathBuf,
	/// Its path inside the bundle, `data/berlin.mbtiles`.
	pub to: String,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub bytes: u64,
}

/// What a bundle would contain, worked out without writing anything.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
	/// The files to carry, each once however many pipelines name it.
	pub carry: Vec<Carried>,
	/// Every reference found, carried or not - what a surface shows to explain the number above.
	pub references: Vec<Reference>,
	/// The graphs with the carried files renamed to where they will be, in the order given; a graph
	/// naming nothing is unchanged, byte for byte. The crop comes along untouched - it is about
	/// which tiles, not about which files.
	pub graphs: Vec<crate::project::SavedGraph>,
}

impl Plan {
	/// What the carried files weigh in total.
	#[must_use]
	pub fn bytes(&self) -> u64 {
		self.carry.iter().map(|file| file.bytes).sum()
	}

	/// The references that name a file that is not there.
	#[must_use]
	pub fn missing(&self) -> Vec<&Reference> {
		self
			.references
			.iter()
			.filter(|reference| matches!(reference.kind, ReferenceKind::Missing { .. }))
			.collect()
	}
}

/// One graph, as a bundle needs it: its name, its text, and where its relative names point.
///
/// `dir` is the directory the graph's own `.vpl` sits in, which is what a relative `filename`
/// resolves against when the pipeline runs - the same rule [`crate::suggest`] follows. A graph that
/// has never been saved has no such directory, and a relative name in it resolves against nothing;
/// it comes out [`ReferenceKind::Missing`], which is the truth.
#[derive(Debug, Clone)]
pub struct Source<'a> {
	pub name: &'a str,
	pub text: &'a str,
	pub dir: Option<&'a Path>,
	/// Carried through to the copy's manifest, so a crop survives being sent to somebody.
	pub crop: crate::export::Bounds,
	/// Whether it is drawn (Q49), carried for the same reason: a copy should open looking the
	/// way the original looked.
	pub enabled: bool,
	/// Which of its operations are switched off (Q49), carried for that same reason.
	pub disabled: Vec<Vec<u32>>,
}

/// Where a reference sits in one graph's text, and what it resolves to.
struct Found {
	field: String,
	value: String,
	span: Span,
	kind: ReferenceKind,
}

/// Works out what a bundle of these graphs would carry.
///
/// Deterministic: the same graphs give the same plan, including the names collisions are resolved
/// to. That is what makes it safe to show a plan and then write it.
pub fn plan(sources: &[Source]) -> Result<Plan> {
	let mut carry: Vec<Carried> = Vec::new();
	// Keyed by the file's own path, so two pipelines naming one file carry it once.
	let mut destination: HashMap<PathBuf, String> = HashMap::new();
	let mut taken: HashMap<String, u32> = HashMap::new();
	let mut references = Vec::new();
	let mut graphs = Vec::with_capacity(sources.len());

	for source in sources {
		let found = find(source)?;
		let mut rewrites: Vec<(usize, String)> = Vec::new();

		for (index, reference) in found.iter().enumerate() {
			references.push(Reference {
				graph: source.name.to_string(),
				field: reference.field.clone(),
				value: reference.value.clone(),
				kind: reference.kind.clone(),
			});

			let ReferenceKind::Local { path, bytes } = &reference.kind else {
				continue;
			};
			let to = destination.entry(path.clone()).or_insert_with(|| {
				let name = unique(path, &mut taken);
				carry.push(Carried {
					from: path.clone(),
					to: name.clone(),
					bytes: *bytes,
				});
				name
			});
			rewrites.push((index, to.clone()));
		}

		graphs.push(crate::project::SavedGraph {
			name: source.name.to_string(),
			vpl: rewrite(source, &rewrites)?,
			crop: source.crop,
			enabled: source.enabled,
			disabled: source.disabled.clone(),
		});
	}

	Ok(Plan {
		carry,
		references,
		graphs,
	})
}

/// A path inside the bundle for `path`, distinct from every one handed out before it.
///
/// Two sources called `cities.csv` in different directories would otherwise become one file, and
/// the second pipeline would silently read the first's data. Numbered rather than hashed so that
/// what lands in `data/` still reads as the file it came from.
fn unique(path: &Path, taken: &mut HashMap<String, u32>) -> String {
	let name = path
		.file_name()
		.map_or_else(|| "source".to_string(), |name| name.to_string_lossy().into_owned());

	let count = taken.entry(name.clone()).or_insert(0);
	*count += 1;
	if *count == 1 {
		return format!("{DATA_DIR}/{name}");
	}

	let stem = Path::new(&name)
		.file_stem()
		.map_or_else(String::new, |s| s.to_string_lossy().into_owned());
	let extension = Path::new(&name)
		.extension()
		.map_or_else(String::new, |e| format!(".{}", e.to_string_lossy()));
	format!("{DATA_DIR}/{stem}-{count}{extension}")
}

/// Every file reference in one graph, in the order a walk of the pipeline meets them.
///
/// The order is the contract between this and [`rewrite`]: an edit changes a value's length and so
/// every span after it, and re-walking the rebuilt document is what keeps the two in step.
fn find(source: &Source) -> Result<Vec<Found>> {
	let document =
		Document::parse(source.text).map_err(|error| anyhow::anyhow!("{}: {}", source.name, error.message))?;
	let mut out = Vec::new();
	walk(document.pipeline(), source.dir, &mut out);
	Ok(out)
}

/// Every file reference rewritten as it should be written beside `to`.
///
/// **Relative when it can be, absolute when it cannot.** A pipeline saved above the data it reads -
/// beside it, or anywhere below - becomes a thing you can move, copy or commit as a unit, because
/// nothing in it names a directory outside itself. A reference that would need `../` to reach stays
/// absolute: a path that climbs out is fragile in both directions, breaking when either end moves,
/// and unreadable besides.
///
/// **Which also makes "save as" correct.** Saving wrote the text unchanged and then moved what
/// relative paths *mean* to the new directory - so a pipeline saved from `/a` to `/b` kept
/// `filename=data.mbtiles` and started looking for `/b/data.mbtiles`, silently. `from` is what those
/// paths meant when they were written; `to` is where they are going.
///
/// URLs are left exactly as they are: they work from anywhere, so there is nothing to anchor.
///
/// **Not canonicalised.** Resolving symlinks would rewrite a path someone chose into one they have
/// never seen, and the case it would help - a project reached through a link - is rarer than the
/// case it would surprise. A symlinked directory keeps absolute paths, which still work.
pub fn reanchor(text: &str, from: Option<&Path>, to: &Path) -> Result<String> {
	let mut document = Document::parse(text).map_err(|error| anyhow::anyhow!("{}", error.message))?;
	let to = normalise(to);

	// Re-walked after every edit, because setting a value moves the spans after it - the same reason
	// `rewrite` does it, one index at a time.
	let mut index = 0;
	loop {
		let mut found = Vec::new();
		walk(document.pipeline(), from, &mut found);
		let Some(reference) = found.get(index) else {
			return Ok(document.text().to_string());
		};
		index += 1;

		let path = match &reference.kind {
			ReferenceKind::Remote => continue,
			ReferenceKind::Local { path, .. } | ReferenceKind::Missing { path } => normalise(path),
		};

		let written = match path.strip_prefix(&to) {
			// Below `to`, so it can be named from there without climbing out. `/` rather than the
			// platform separator: a `.vpl` is text that travels, and both platforms read `/`.
			Ok(relative) => relative
				.components()
				.map(|part| part.as_os_str().to_string_lossy())
				.collect::<Vec<_>>()
				.join("/"),
			Err(_) => path.to_string_lossy().into_owned(),
		};

		if written != reference.value {
			document
				.set_value(reference.span, &written)
				.map_err(|error| anyhow::anyhow!("{}", error.message))?;
		}
	}
}

/// A path with `.` and `..` resolved, without asking the filesystem anything.
///
/// Lexical because `strip_prefix` is: `/a/b/../b/c` and `/a/b/c` are the same file and not the same
/// text, and a reference that arrived with a `..` in it would otherwise never be seen as being
/// below anything.
fn normalise(path: &Path) -> PathBuf {
	let mut out = PathBuf::new();
	for part in path.components() {
		match part {
			std::path::Component::CurDir => {}
			std::path::Component::ParentDir => {
				if !out.pop() {
					out.push("..");
				}
			}
			other => out.push(other),
		}
	}
	out
}

fn walk(pipeline: &Pipeline, dir: Option<&Path>, out: &mut Vec<Found>) {
	for node in &pipeline.nodes {
		collect(node, dir, out);
	}
}

fn collect(node: &Node, dir: Option<&Path>, out: &mut Vec<Found>) {
	for property in &node.properties {
		if !names_a_file(&node.name, &property.key) {
			continue;
		}
		// A list-valued file parameter would need one destination per item; none of the twelve is
		// one, and rewriting only what it can name is safer than rewriting the whole list to a
		// single path.
		let crate::vpl::Value::Single(value) = &property.value else {
			continue;
		};
		out.push(Found {
			field: property.key.clone(),
			value: value.value.clone(),
			span: value.span,
			kind: classify(&value.value, dir),
		});
	}
	for nested in &node.sources {
		walk(nested, dir, out);
	}
}

/// What a written value points at.
fn classify(value: &str, dir: Option<&Path>) -> ReferenceKind {
	if is_url(value) {
		return ReferenceKind::Remote;
	}

	let written = Path::new(value);
	let path = if written.is_absolute() {
		written.to_path_buf()
	} else {
		match dir {
			Some(dir) => dir.join(written),
			None => written.to_path_buf(),
		}
	};

	match std::fs::metadata(&path) {
		Ok(meta) if meta.is_file() => ReferenceKind::Local {
			path,
			bytes: meta.len(),
		},
		_ => ReferenceKind::Missing { path },
	}
}

/// Whether a value is a URL rather than a path.
///
/// Matched on the scheme rather than parsed: a single-letter scheme is a Windows drive letter, and
/// `C:\tiles` is a path however much it looks like one.
fn is_url(value: &str) -> bool {
	value
		.split_once("://")
		.is_some_and(|(scheme, _)| scheme.len() > 1 && scheme.chars().all(|c| c.is_ascii_alphanumeric() || c == '+'))
}

/// The graph's text with the given references renamed.
///
/// **One edit at a time, re-walking between them.** Every edit rebuilds the document and moves the
/// spans after it, so a list of spans taken from the original text is stale after the first
/// replacement. The indices survive that: edits change values, never structure, so the *n*-th
/// reference is still the *n*-th reference.
///
/// The quoting is the tree's, which is what makes this safe for a path with a space or an
/// apostrophe in it - the same reason `Document::set_value` exists at all.
fn rewrite(source: &Source, rewrites: &[(usize, String)]) -> Result<String> {
	if rewrites.is_empty() {
		return Ok(source.text.to_string());
	}

	let mut document =
		Document::parse(source.text).map_err(|error| anyhow::anyhow!("{}: {}", source.name, error.message))?;

	for (index, value) in rewrites {
		let mut found = Vec::new();
		walk(document.pipeline(), source.dir, &mut found);
		let span = found
			.get(*index)
			.with_context(|| format!("{}: the pipeline changed while it was being bundled", source.name))?
			.span;
		document
			.set_value(span, value)
			.map_err(|error| anyhow::anyhow!("{}: {}", source.name, error.message))?;
	}

	Ok(document.text().to_string())
}

// ---------------------------------------------------------------------------------------------
// Writing it
// ---------------------------------------------------------------------------------------------

/// Writes a self-contained project directory: the plan's pipelines, the files they name, the
/// manifest and the style.
///
/// The destination is somewhere the user chose, so this must not be a project *and* the source of
/// its own data: copying a file onto itself would truncate it. Guarded below rather than assumed.
/// The files a bundle carries, as entries - the data, not the project's own three.
fn carried(plan: &Plan) -> Vec<crate::archive::Entry> {
	plan
		.carry
		.iter()
		.map(|file| crate::archive::Entry::file(&file.to, &file.from))
		.collect()
}

/// Writes a self-contained project directory: the plan's pipelines, the files they name, the
/// manifest and the style.
///
/// **The project's own files still go through [`crate::project::save`], and that is not an
/// oversight.** It writes each one temp-then-rename, so an interrupted save cannot leave a manifest
/// naming a `.vpl` that is not there - and it refuses a graph name that is a path. A bundle is
/// usually a fresh directory where neither matters, but it is a directory *someone chose*, and it
/// may be a project already. The carried data has no such history and is written plainly.
pub fn write_directory(dir: &Path, plan: &Plan, recipe: &crate::style::Recipe, style: Option<&str>) -> Result<()> {
	std::fs::create_dir_all(dir.join(DATA_DIR)).with_context(|| format!("creating {}", dir.display()))?;
	crate::archive::write_directory(dir, &carried(plan))?;
	crate::project::save(dir, &plan.graphs, recipe, style)
}

/// Writes the same thing as one `.zip`.
///
/// Nothing is staged: a `Content::File` is streamed straight into the archive, because the data a
/// project carries is tiles and a container is routinely larger than the disk has room for twice.
pub fn write_zip(path: &Path, plan: &Plan, recipe: &crate::style::Recipe, style: Option<&str>) -> Result<()> {
	let mut entries = Vec::new();
	for graph in &plan.graphs {
		crate::project::check_name(&graph.name)?;
		entries.push(crate::archive::Entry::bytes(
			format!("{}.vpl", graph.name),
			graph.vpl.as_bytes(),
		));
	}
	if let Some(style) = style {
		entries.push(crate::archive::Entry::bytes(
			crate::project::STYLE_FILE,
			style.as_bytes(),
		));
	}
	entries.push(crate::archive::Entry::bytes(
		crate::project::MANIFEST_FILE,
		crate::project::manifest_text(&plan.graphs, recipe)?.as_bytes(),
	));
	entries.extend(carried(plan));

	crate::archive::write_zip(path, &entries)
}

#[cfg(test)]
mod reanchor_tests {
	use super::*;

	fn at(dir: &str) -> PathBuf {
		PathBuf::from(dir)
	}

	/// What a reference says, whatever quoting the tree chose for it.
	fn written(text: &str) -> Vec<String> {
		let document = Document::parse(text).unwrap();
		let mut found = Vec::new();
		walk(document.pipeline(), None, &mut found);
		found.into_iter().map(|reference| reference.value).collect()
	}

	/// The point of it: a pipeline saved above its data names it from there, so the two travel
	/// together.
	#[test]
	fn a_file_below_the_save_becomes_relative() {
		let text = "from_container filename='/home/anna/maps/berlin.mbtiles'";
		let out = reanchor(text, None, &at("/home/anna/maps")).unwrap();
		assert_eq!(written(&out), ["berlin.mbtiles"]);
	}

	#[test]
	fn a_file_deeper_still_keeps_the_path_below() {
		let text = "from_container filename='/home/anna/maps/data/berlin.mbtiles'";
		let out = reanchor(text, None, &at("/home/anna/maps")).unwrap();
		assert_eq!(written(&out), ["data/berlin.mbtiles"]);
	}

	/// The rule, stated: relative only when it can be written without climbing out. A `../` path is
	/// fragile in both directions and unreadable besides.
	#[test]
	fn a_file_outside_stays_absolute() {
		let text = "from_container filename='/home/anna/other/berlin.mbtiles'";
		let out = reanchor(text, None, &at("/home/anna/maps")).unwrap();
		assert_eq!(written(&out), ["/home/anna/other/berlin.mbtiles"]);
		assert!(!out.contains(".."), "{out}");
	}

	/// **What "save as" broke.** The text was written unchanged and the meaning of its relative paths
	/// moved with the file, so a pipeline saved elsewhere quietly looked for its inputs in the new
	/// directory.
	#[test]
	fn saving_somewhere_else_keeps_pointing_at_the_same_file() {
		let text = "from_container filename=berlin.mbtiles";
		let out = reanchor(text, Some(&at("/home/anna/maps")), &at("/tmp/elsewhere")).unwrap();
		assert_eq!(written(&out), ["/home/anna/maps/berlin.mbtiles"]);
	}

	#[test]
	fn saving_in_place_leaves_a_relative_path_alone() {
		let text = "from_container filename='data/berlin.mbtiles'";
		let dir = at("/home/anna/maps");
		let out = reanchor(text, Some(&dir), &dir).unwrap();
		assert_eq!(written(&out), ["data/berlin.mbtiles"]);
	}

	/// A URL works from anywhere, so there is nothing to anchor it to.
	#[test]
	fn a_url_is_left_exactly_as_it_is() {
		let text = "from_tilejson url='https://example.org/tiles.json'";
		let out = reanchor(text, None, &at("/home/anna/maps")).unwrap();
		assert_eq!(written(&out), ["https://example.org/tiles.json"]);
	}

	/// A reference to something that is not there is still somebody's intent, and moving the file it
	/// is written in must not change which path it means.
	#[test]
	fn a_missing_file_is_anchored_like_any_other() {
		let text = "from_container filename='/home/anna/maps/gone.mbtiles'";
		let out = reanchor(text, None, &at("/home/anna/maps")).unwrap();
		assert_eq!(written(&out), ["gone.mbtiles"]);
	}

	/// `/a/b/../b/c` and `/a/b/c` are one file and two strings, and `strip_prefix` is text.
	#[test]
	fn a_path_that_doubles_back_is_still_below() {
		let text = "from_container filename='/home/anna/maps/../maps/berlin.mbtiles'";
		let out = reanchor(text, None, &at("/home/anna/maps")).unwrap();
		assert_eq!(written(&out), ["berlin.mbtiles"]);
	}

	/// Every node in the chain, not the first one.
	#[test]
	fn every_reference_in_the_pipeline_is_anchored() {
		let text = "from_container filename='/home/anna/maps/a.mbtiles' | filter filename='/home/anna/maps/b.geojson'";
		let out = reanchor(text, None, &at("/home/anna/maps")).unwrap();
		assert_eq!(written(&out), ["a.mbtiles", "b.geojson"]);
	}

	/// Saving twice must not keep rewriting: the second pass resolves the relative path it wrote
	/// against the same directory and arrives at the same text.
	#[test]
	fn anchoring_what_is_already_anchored_changes_nothing() {
		let dir = at("/home/anna/maps");
		let once = reanchor("from_container filename='/home/anna/maps/berlin.mbtiles'", None, &dir).unwrap();
		let twice = reanchor(&once, Some(&dir), &dir).unwrap();
		assert_eq!(once, twice);
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::style::Recipe;

	fn source<'a>(name: &'a str, text: &'a str, dir: Option<&'a Path>) -> Source<'a> {
		Source {
			name,
			text,
			dir,
			crop: crate::export::Bounds::default(),
			enabled: true,
			disabled: Vec::new(),
		}
	}

	#[test]
	fn a_url_is_left_alone() {
		let vpl = "from_container filename='https://example.org/berlin.versatiles'";
		let plan = plan(&[source("berlin", vpl, None)]).unwrap();

		assert!(plan.carry.is_empty(), "a URL works from anywhere");
		assert_eq!(plan.graphs[0].vpl, vpl, "and so is not rewritten");
		assert_eq!(plan.references[0].kind, ReferenceKind::Remote);
	}

	/// The failure this whole module exists for: an imported file is named absolutely, and that
	/// path means nothing on another machine.
	#[test]
	fn an_absolute_path_is_carried_and_the_pipeline_renamed() {
		let data = crate::testing::file("berlin.mbtiles", "tiles");
		let vpl = format!("from_container filename='{}' | vector_repair", data.display());
		let plan = plan(&[source("berlin", &vpl, None)]).unwrap();

		assert_eq!(plan.carry.len(), 1);
		assert_eq!(plan.carry[0].to, "data/berlin.mbtiles");
		assert_eq!(plan.carry[0].bytes, 5);
		assert_eq!(
			plan.graphs[0].vpl, "from_container filename='data/berlin.mbtiles' | vector_repair",
			"the pipeline names the copy, and nothing else about it changed"
		);
	}

	/// A relative name means *beside the pipeline* - the same rule the pipeline itself follows.
	#[test]
	fn a_relative_name_resolves_against_the_graphs_own_directory() {
		let data = crate::testing::file("quakes.csv", "lon,lat\n1,2\n");
		let dir = data.parent().unwrap();
		let vpl = "from_csv filename=quakes.csv lon_column=lon lat_column=lat";

		let plan = plan(&[source("quakes", vpl, Some(dir))]).unwrap();
		assert_eq!(plan.carry.len(), 1);
		assert_eq!(plan.carry[0].from, data);
	}

	/// The same file named by two graphs is one file in the bundle.
	#[test]
	fn one_file_named_twice_is_carried_once() {
		let data = crate::testing::file("shared.mbtiles", "tiles");
		let vpl = format!("from_container filename='{}'", data.display());
		let plan = plan(&[source("a", &vpl, None), source("b", &vpl, None)]).unwrap();

		assert_eq!(plan.carry.len(), 1);
		assert_eq!(plan.graphs[0].vpl, plan.graphs[1].vpl);
		assert!(plan.graphs[0].vpl.contains("data/shared.mbtiles"));
	}

	/// Two different files with one name would otherwise become one, and the second pipeline would
	/// read the first's data without saying so.
	#[test]
	fn two_files_sharing_a_name_do_not_collide() {
		let one = crate::testing::file("cities.csv", "name\nBerlin\n");
		let two = crate::testing::file("cities.csv", "name\nParis\n");
		assert_ne!(one, two);

		let a = format!("from_csv filename='{}'", one.display());
		let b = format!("from_csv filename='{}'", two.display());
		let plan = plan(&[source("a", &a, None), source("b", &b, None)]).unwrap();

		assert_eq!(plan.carry.len(), 2);
		assert_eq!(plan.carry[0].to, "data/cities.csv");
		assert_eq!(plan.carry[1].to, "data/cities-2.csv");
		assert!(
			plan.graphs[1].vpl.contains("data/cities-2.csv"),
			"{}",
			plan.graphs[1].vpl
		);
	}

	/// Reported rather than fatal: a project with one moved source is still a project worth copying.
	#[test]
	fn a_missing_file_is_reported_and_left_as_written() {
		let vpl = "from_container filename='/nowhere/berlin.mbtiles'";
		let plan = plan(&[source("berlin", vpl, None)]).unwrap();

		assert!(plan.carry.is_empty());
		assert_eq!(plan.missing().len(), 1);
		assert_eq!(plan.graphs[0].vpl, vpl, "the name it had is the best guess there is");
	}

	/// Every span after an edit moves, and there are three edits here.
	#[test]
	fn several_references_in_one_graph_are_all_rewritten() {
		let a = crate::testing::file("a.csv", "x\n1\n");
		let b = crate::testing::file("b.csv", "x\n2\n");
		let vpl = format!(
			"from_stacked [ from_csv filename='{}', from_csv filename='{}' ]",
			a.display(),
			b.display()
		);

		let plan = plan(&[source("both", &vpl, None)]).unwrap();
		assert_eq!(plan.carry.len(), 2);
		assert_eq!(
			plan.graphs[0].vpl,
			"from_stacked [ from_csv filename='data/a.csv', from_csv filename='data/b.csv' ]"
		);
	}

	/// The comments and layout that make a hand-written pipeline worth keeping survive the rewrite.
	#[test]
	fn everything_but_the_paths_is_untouched() {
		let data = crate::testing::file("berlin.mbtiles", "tiles");
		let vpl = format!(
			"# Berlin\nfrom_container filename='{}' # the input\n  | vector_repair\n",
			data.display()
		);

		let plan = plan(&[source("berlin", &vpl, None)]).unwrap();
		assert_eq!(
			plan.graphs[0].vpl,
			"# Berlin\nfrom_container filename='data/berlin.mbtiles' # the input\n  | vector_repair\n"
		);
	}

	/// A path with a space in it has to come back quoted, or the bundle writes a pipeline that does
	/// not parse.
	#[test]
	fn a_name_needing_quotes_gets_them() {
		let data = crate::testing::file("my tiles.mbtiles", "tiles");
		let vpl = format!("from_container filename='{}'", data.display());

		let plan = plan(&[source("berlin", &vpl, None)]).unwrap();
		assert_eq!(plan.graphs[0].vpl, "from_container filename='data/my tiles.mbtiles'");
		assert!(Document::parse(&plan.graphs[0].vpl).is_ok());
	}

	/// A graph that names nothing comes out byte for byte, so bundling a project cannot rewrite a
	/// pipeline it had no reason to touch.
	#[test]
	fn a_graph_naming_no_file_is_unchanged() {
		let vpl = "from_debug format=png\n  | raster_overview level=2\n";
		let plan = plan(&[source("debug", vpl, None)]).unwrap();
		assert_eq!(plan.graphs[0].vpl, vpl);
		assert!(plan.references.is_empty());
	}

	#[test]
	fn a_written_directory_is_a_project_that_opens() {
		let data = crate::testing::file("berlin.mbtiles", "tiles");
		let vpl = format!("from_container filename='{}'", data.display());
		let plan = plan(&[source("berlin", &vpl, None)]).unwrap();

		let out = crate::testing::dir("bundle-directory");
		write_directory(&out, &plan, &Recipe::default(), Some("{\"version\":8}")).unwrap();

		assert!(crate::project::is_project(&out));
		assert_eq!(
			std::fs::read_to_string(out.join("data/berlin.mbtiles")).unwrap(),
			"tiles"
		);

		let loaded = crate::project::load(&out).unwrap();
		assert_eq!(loaded.graphs[0].vpl, "from_container filename='data/berlin.mbtiles'");
	}

	#[test]
	fn a_zip_holds_the_project_and_its_data() {
		let data = crate::testing::file("berlin.mbtiles", "tiles");
		let vpl = format!("from_container filename='{}'", data.display());
		let plan = plan(&[source("berlin", &vpl, None)]).unwrap();

		let path = crate::testing::path("berlin.zip");
		write_zip(&path, &plan, &Recipe::default(), Some("{\"version\":8}")).unwrap();

		let mut archive = zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();
		let names: Vec<String> = archive.file_names().map(str::to_string).collect();
		for expected in ["berlin.vpl", "style.json", "project.yaml", "data/berlin.mbtiles"] {
			assert!(names.contains(&expected.to_string()), "{names:?}");
		}

		use std::io::Read;
		let mut text = String::new();
		archive
			.by_name("berlin.vpl")
			.unwrap()
			.read_to_string(&mut text)
			.unwrap();
		assert_eq!(text, "from_container filename='data/berlin.mbtiles'");
	}

	/// The destination is a directory the user picked, and it could be the one the data is in.
	#[test]
	fn a_bundle_refuses_to_copy_a_file_onto_itself() {
		let out = crate::testing::dir("bundle-onto-itself");
		std::fs::create_dir_all(out.join(DATA_DIR)).unwrap();
		let data = out.join(DATA_DIR).join("berlin.mbtiles");
		std::fs::write(&data, "tiles").unwrap();

		let vpl = format!("from_container filename='{}'", data.display());
		let plan = plan(&[source("berlin", &vpl, None)]).unwrap();

		let error = write_directory(&out, &plan, &Recipe::default(), None).unwrap_err();
		assert!(format!("{error:#}").contains("already where"), "{error:#}");
		assert_eq!(
			std::fs::read_to_string(&data).unwrap(),
			"tiles",
			"and did not truncate it"
		);
	}

	#[test]
	fn a_windows_path_is_not_mistaken_for_a_url() {
		assert!(!is_url("C:\\tiles\\berlin.mbtiles"));
		assert!(is_url("https://example.org/a"));
		assert!(is_url("s3://bucket/a"));
		assert!(!is_url("data/berlin.mbtiles"));
	}

	/// The list above is the one thing here that can go quietly out of date: an operation upstream
	/// adds with a file-valued field would be left behind by every bundle, and nothing would say so.
	#[test]
	fn every_file_valued_field_upstream_is_listed() {
		let mut unlisted = Vec::new();
		for operation in crate::vpl::operations() {
			for field in &operation.fields {
				let looks_like_a_file = ["file", "path", "url", "dir"]
					.iter()
					.any(|hint| field.name.contains(hint));
				if looks_like_a_file && !names_a_file(&operation.name, &field.name) {
					unlisted.push(format!("{}.{}", operation.name, field.name));
				}
			}
		}
		unlisted.sort();
		assert!(
			unlisted.is_empty(),
			"upstream has file-valued fields FILE_FIELDS does not list, so a bundle would leave them \
			 behind: {unlisted:?}"
		);
	}
}
