//! Project model — a directory holding a `project.yaml` manifest beside real `.vpl` and
//! `style.json` files (G1, [Q6]).
//!
//! **Reference, do not embed** ([Q6]). Each graph is a real `.vpl` the CLI can run and the style is
//! a real MapLibre style, with `project.yaml` naming them by relative path — the same shape
//! `versatiles serve --config` already uses. Embedding a text DSL in a structured file would mean
//! escaped newlines and unreadable diffs.
//!
//! **The style is written and not read back** ([Q36]). What the manifest carries is the *recipe* —
//! a preset, its adjustments, the layers someone changed — and `style.json` is rendered from it by
//! whoever has the generator. A project reopened from its own directory rebuilds the style; a
//! `style.json` edited by hand is somebody else's file, and saying so is honest rather than
//! pretending to round-trip it.
//!
//! Recent sources and bookmarks are **not** here: they are application state, not project state,
//! and live in [`crate::store`] ([Q21](../../../docs/decisions.md)).
//!
//! [Q36]: ../../../docs/decisions.md
//!
//! [Q6]: ../../../docs/decisions.md

use anyhow::{Context, Result};
use std::path::Path;

/// Writes a pipeline to a `.vpl` file, atomically.
///
/// Saving a *project* — the manifest, the style and the pipeline as a directory — is G1 at S5.1.
/// This is the narrower thing: the pipeline as the file the CLI already reads, which is what
/// [C9](../../../docs/features.md) opens. They stay separate commands because they have different
/// scopes: one writes a file, the other a folder.
///
/// Temp-then-rename, for the same reason the store does it: an interrupted write must not leave a
/// truncated pipeline where a working one was.
pub fn save_vpl(path: &Path, text: &str) -> Result<()> {
	// Guarded here as well as at the command, for the reason `export::write` gives about itself: a
	// library function has to be safe on its own. S5.1's project save will be the second caller, and
	// it should not have to remember this.
	anyhow::ensure!(
		crate::import::is_pipeline(path),
		"cannot write {}: a pipeline is saved as .{}",
		path.display(),
		crate::import::pipeline_extensions().join(" or .")
	);

	write_atomically(path, text)
}

/// Writes `text` to `path` through a temporary file beside it.
///
/// **Beside, not in the system temp directory**, for the reason `Recents::save` and
/// `export::scratch_path` both give: a rename is atomic only within one filesystem, and a temp
/// directory is routinely on another. A half-written file where a whole one used to be is the
/// failure this exists to prevent.
///
/// Shared by every text a project writes — a `.vpl`, and a style ([S4.6](../../docs/scope-release-1.md)).
/// The guard about *what* may be written belongs to the caller; this one is about writing it safely.
pub fn write_atomically(path: &Path, text: &str) -> Result<()> {
	let dir = path.parent().context("target has no parent directory")?;
	let mut temp = path.as_os_str().to_owned();
	temp.push(".tmp");
	let temp = std::path::PathBuf::from(temp);

	std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
	{
		use std::io::Write;
		let mut file = std::fs::File::create(&temp).with_context(|| format!("creating {}", temp.display()))?;
		file.write_all(text.as_bytes()).context("writing the temporary file")?;
		file.sync_all().context("flushing the temporary file")?;
	}
	std::fs::rename(&temp, path).with_context(|| format!("replacing {}", path.display()))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::vpl::Document;

	/// The guard belongs to the writer, not only to the command above it: S5.1 adds a second caller
	/// that saves a project's `.vpl` files, and it should not have to remember this.
	#[test]
	fn a_destination_that_is_not_a_pipeline_is_refused() {
		let dir = crate::testing::dir("not-a-pipeline");
		let error = save_vpl(&dir.join("berlin.mbtiles"), "from_debug format=png").unwrap_err();

		let message = format!("{error:#}");
		assert!(message.contains("saved as .vpl"), "{message}");
		assert!(!dir.join("berlin.mbtiles").exists(), "nothing should have been written");
	}

	/// What is written has to be what opens again — including the comments and layout that make a
	/// hand-written pipeline worth keeping.
	#[test]
	fn a_saved_pipeline_reopens_unchanged() -> Result<()> {
		let dir = crate::testing::dir("roundtrip");
		let path = dir.join("pipeline.vpl");
		let source = "# Berlin\nfrom_container filename='berlin.mbtiles' # the input\n  | vector_repair\n";

		let document = Document::parse(source).unwrap();
		save_vpl(&path, document.text())?;

		let read_back = std::fs::read_to_string(&path)?;
		assert_eq!(read_back, source, "the file is the document, byte for byte");
		assert_eq!(Document::parse(read_back).unwrap().comments().len(), 2);
		Ok(())
	}

	#[test]
	fn an_interrupted_write_leaves_no_temporary_file() -> Result<()> {
		let dir = crate::testing::dir("atomic");
		let path = dir.join("pipeline.vpl");
		save_vpl(&path, "from_debug format=png")?;
		assert!(path.exists());
		assert!(
			!dir.join("pipeline.vpl.tmp").exists(),
			"the temp file should have been renamed away"
		);
		Ok(())
	}

	#[test]
	fn overwriting_replaces_rather_than_appends() -> Result<()> {
		let dir = crate::testing::dir("overwrite");
		let path = dir.join("pipeline.vpl");
		save_vpl(&path, "from_debug format=png | raster_overview level=2")?;
		save_vpl(&path, "from_debug format=webp")?;
		assert_eq!(std::fs::read_to_string(&path)?, "from_debug format=webp");
		Ok(())
	}
}

// ---------------------------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------------------------

/// One graph, as the manifest names it.
///
/// `Default` only so that `#[serde(default)]` can fill in a field an older manifest predates — the
/// crop being the first of those.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct GraphRef {
	/// The graph's name — its server mount, its source name in the style, and its filename ([Q32]).
	pub name: String,
	/// Where its VPL lives, relative to the manifest.
	pub file: String,
	/// What an export of it is narrowed to (F2, S5.2).
	///
	/// **In the manifest and not in the `.vpl`**, because it is not part of the pipeline: the `.vpl`
	/// has to stay the thing `versatiles convert` runs, and a crop written into it would narrow
	/// every use of the graph rather than the one export it belongs to. Omitted when it narrows
	/// nothing, so a project that never used one has a manifest that never mentions it.
	#[serde(skip_serializing_if = "is_unset")]
	pub crop: crate::export::Bounds,
}

/// Whether these bounds narrow nothing — the manifest omits them when so.
fn is_unset(bounds: &crate::export::Bounds) -> bool {
	*bounds == crate::export::Bounds::default()
}

/// A graph as a project holds it: what it is called, its pipeline, and what an export narrows to.
///
/// A tuple would do for two of these and stopped doing when the crop arrived — three positional
/// strings-and-a-struct at four call sites is where a name starts earning its keep.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SavedGraph {
	pub name: String,
	pub vpl: String,
	pub crop: crate::export::Bounds,
}

/// What `project.yaml` holds.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct Manifest {
	/// Bumped when a later Studio cannot read an earlier file. One today.
	pub version: u32,
	pub graphs: Vec<GraphRef>,
	/// What the style is made from, not the style ([Q36]).
	pub style: crate::style::Recipe,
}

/// The manifest's filename. Fixed, because a directory is a project by containing one.
pub const MANIFEST_FILE: &str = "project.yaml";

/// The style Studio writes beside it — an output, never read back.
pub const STYLE_FILE: &str = "style.json";

/// A project read from disk: the manifest, and each graph.
#[derive(Debug, Clone, PartialEq)]
pub struct Loaded {
	pub manifest: Manifest,
	/// In manifest order.
	pub graphs: Vec<SavedGraph>,
}

/// Whether a directory holds a project.
#[must_use]
pub fn is_project(dir: &Path) -> bool {
	dir.join(MANIFEST_FILE).is_file()
}

/// Writes a project: the manifest, one `.vpl` per graph, and the rendered style.
///
/// **Every file is written before any is renamed into place.** A save interrupted halfway would
/// otherwise leave a manifest naming a `.vpl` that is not there yet — and the manifest is what makes
/// the directory a project, so a torn one is worse than no save at all.
///
/// `style` is the rendered MapLibre style, or `None` when there is nothing to draw yet. It is
/// written for other tools to read; reopening the project renders it again from the recipe.
pub fn save(dir: &Path, graphs: &[SavedGraph], recipe: &crate::style::Recipe, style: Option<&str>) -> Result<()> {
	let yaml = manifest_text(graphs, recipe)?;

	std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
	for graph in graphs {
		check_name(&graph.name)?;
		write_atomically(&dir.join(format!("{}.vpl", graph.name)), &graph.vpl)?;
	}
	if let Some(style) = style {
		write_atomically(&dir.join(STYLE_FILE), style)?;
	}
	write_atomically(&dir.join(MANIFEST_FILE), &yaml)
}

/// `project.yaml`'s contents for these graphs, header and all.
///
/// Separate from writing it because a bundle ([`crate::bundle`]) puts the same bytes in a zip entry
/// rather than in a file, and the two manifests have to be the same manifest.
pub fn manifest_text(graphs: &[SavedGraph], recipe: &crate::style::Recipe) -> Result<String> {
	let manifest = Manifest {
		version: 1,
		graphs: graphs
			.iter()
			.map(|graph| GraphRef {
				name: graph.name.clone(),
				file: format!("{}.vpl", graph.name),
				crop: graph.crop,
			})
			.collect(),
		style: recipe.clone(),
	};

	let yaml = serde_yaml_ng::to_string(&manifest).context("writing the project manifest")?;
	let header = "# VersaTiles Studio project. The .vpl files beside this one are real pipelines\n\
	              # and style.json is a real MapLibre style — both usable without Studio (Q6).\n";
	Ok(format!("{header}{yaml}"))
}

/// Refuses a graph name that would be a path rather than a filename.
///
/// A name reaches this from a rename box, and it becomes a filename in a directory the user chose;
/// `../../.bashrc` is a name someone can type.
pub fn check_name(name: &str) -> Result<()> {
	crate::paths::segment(name).with_context(|| format!("{name:?} cannot be a graph name"))
}

/// Reads a project back.
///
/// A graph whose file is missing is an error rather than a project with a hole in it: the manifest
/// is the list of what this project *is*, and quietly opening three of four graphs would lose work
/// without saying so.
pub fn load(dir: &Path) -> Result<Loaded> {
	let path = dir.join(MANIFEST_FILE);
	let text = std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
	let manifest: Manifest = serde_yaml_ng::from_str(&text).with_context(|| format!("reading {}", path.display()))?;

	anyhow::ensure!(
		manifest.version <= 1,
		"{} was written by a later version of Studio (manifest version {})",
		path.display(),
		manifest.version
	);

	let mut graphs = Vec::with_capacity(manifest.graphs.len());
	for graph in &manifest.graphs {
		// Relative to the manifest, the way `versatiles serve --config` resolves its own paths — and
		// joined rather than concatenated, so a name is a name and not a way out of the directory.
		let file = dir.join(&graph.file);
		anyhow::ensure!(
			file.parent() == Some(dir),
			"{} names {:?}, which is outside the project",
			path.display(),
			graph.file
		);
		let vpl = std::fs::read_to_string(&file).with_context(|| format!("reading {}", file.display()))?;
		graphs.push(SavedGraph {
			name: graph.name.clone(),
			vpl,
			crop: graph.crop,
		});
	}

	Ok(Loaded { manifest, graphs })
}

#[cfg(test)]
mod project_tests {
	use super::*;
	use crate::style::{Preset, Recipe, Recolor};

	fn recipe() -> Recipe {
		Recipe {
			preset: Preset::Graybeard,
			recolor: Recolor {
				invert_brightness: Some(true),
				..Recolor::default()
			},
			..Recipe::default()
		}
	}

	fn graphs() -> Vec<SavedGraph> {
		vec![
			SavedGraph {
				name: "basemap".to_string(),
				vpl: "from_debug format=png".to_string(),
				crop: crate::export::Bounds::default(),
			},
			SavedGraph {
				name: "hillshade".to_string(),
				vpl: "from_debug format=png | raster_overview level=2".to_string(),
				crop: crate::export::Bounds {
					bbox: Some([13.0, 52.3, 13.8, 52.7]),
					min_zoom: Some(4),
					max_zoom: Some(12),
				},
			},
		]
	}

	#[test]
	fn a_project_round_trips_through_its_own_directory() {
		let dir = crate::testing::dir("project-roundtrip");
		save(&dir, &graphs(), &recipe(), Some("{\"version\":8}")).unwrap();

		let loaded = load(&dir).unwrap();
		assert_eq!(loaded.graphs, graphs());
		assert_eq!(
			loaded.manifest.style,
			recipe(),
			"the recipe is what comes back, not the style"
		);
		assert_eq!(loaded.manifest.version, 1);
	}

	/// A crop is set by looking at the map, and it should still be there tomorrow (F2, S5.2).
	#[test]
	fn a_crop_survives_the_manifest() {
		let dir = crate::testing::dir("project-crop");
		save(&dir, &graphs(), &recipe(), None).unwrap();

		let loaded = load(&dir).unwrap();
		assert_eq!(loaded.graphs[1].crop.bbox, Some([13.0, 52.3, 13.8, 52.7]));
		assert_eq!(loaded.graphs[1].crop.max_zoom, Some(12));

		// A graph that never had one says nothing about it, rather than writing four nulls.
		let text = std::fs::read_to_string(dir.join(MANIFEST_FILE)).unwrap();
		let basemap = text.split("- name: hillshade").next().unwrap();
		assert!(!basemap.contains("crop"), "{basemap}");
	}

	/// The field is new; every project saved before it exists without one.
	#[test]
	fn a_manifest_written_before_crops_still_opens() {
		let dir = crate::testing::dir("project-no-crop");
		std::fs::create_dir_all(&dir).unwrap();
		std::fs::write(dir.join("basemap.vpl"), "from_debug format=png").unwrap();
		std::fs::write(
			dir.join(MANIFEST_FILE),
			"version: 1\ngraphs:\n  - name: basemap\n    file: basemap.vpl\nstyle:\n  preset: colorful\n",
		)
		.unwrap();

		let loaded = load(&dir).unwrap();
		assert_eq!(loaded.graphs[0].crop, crate::export::Bounds::default());
	}

	/// [Q6]'s whole point: the files beside the manifest are usable without Studio.
	#[test]
	fn the_files_beside_it_are_real_files() {
		let dir = crate::testing::dir("project-real-files");
		save(&dir, &graphs(), &recipe(), Some("{\"version\":8}")).unwrap();

		assert_eq!(
			std::fs::read_to_string(dir.join("basemap.vpl")).unwrap(),
			"from_debug format=png",
			"a .vpl is the pipeline, not an escaped copy of it"
		);
		assert!(
			std::fs::read_to_string(dir.join(STYLE_FILE))
				.unwrap()
				.contains("\"version\":8")
		);
		assert!(is_project(&dir));
	}

	/// The manifest permits comments, which is half of why it is YAML rather than JSON.
	#[test]
	fn the_manifest_says_what_it_is() {
		let dir = crate::testing::dir("project-header");
		save(&dir, &graphs(), &recipe(), None).unwrap();

		let text = std::fs::read_to_string(dir.join(MANIFEST_FILE)).unwrap();
		assert!(text.starts_with('#'), "{text}");
		assert!(text.contains("basemap.vpl"), "{text}");
		// Written only when there is something to draw; a project saved before then has no style.
		assert!(!dir.join(STYLE_FILE).exists());
	}

	/// The manifest is data, and data that names files decides what gets read.
	#[test]
	fn a_manifest_cannot_name_a_file_outside_the_project() {
		let dir = crate::testing::dir("project-escape");
		save(&dir, &graphs(), &recipe(), None).unwrap();
		std::fs::write(
			dir.join(MANIFEST_FILE),
			"version: 1\ngraphs:\n  - name: evil\n    file: ../../../etc/passwd\nstyle:\n  preset: colorful\n",
		)
		.unwrap();

		let error = load(&dir).unwrap_err();
		assert!(format!("{error:#}").contains("outside the project"), "{error:#}");
	}

	/// A missing file is not a project with a hole in it — the manifest is the list of what this
	/// project is, and opening three of four graphs would lose work silently.
	#[test]
	fn a_graph_the_manifest_names_and_the_directory_lacks_is_an_error() {
		let dir = crate::testing::dir("project-missing");
		save(&dir, &graphs(), &recipe(), None).unwrap();
		std::fs::remove_file(dir.join("hillshade.vpl")).unwrap();

		let error = load(&dir).unwrap_err();
		assert!(format!("{error:#}").contains("hillshade.vpl"), "{error:#}");
	}

	/// A file from a later Studio is refused rather than half-read.
	#[test]
	fn a_manifest_from_the_future_says_so() {
		let dir = crate::testing::dir("project-future");
		std::fs::create_dir_all(&dir).unwrap();
		std::fs::write(dir.join(MANIFEST_FILE), "version: 99\ngraphs: []\n").unwrap();

		let error = load(&dir).unwrap_err();
		assert!(format!("{error:#}").contains("later version"), "{error:#}");
	}

	#[test]
	fn a_graph_name_that_is_a_path_is_refused() {
		let dir = crate::testing::dir("project-name");
		let sneaky = vec![SavedGraph {
			name: "../escape".to_string(),
			vpl: "from_debug".to_string(),
			..SavedGraph::default()
		}];
		let error = save(&dir, &sneaky, &recipe(), None).unwrap_err();
		assert!(format!("{error:#}").contains("cannot be a filename"), "{error:#}");
	}
}
