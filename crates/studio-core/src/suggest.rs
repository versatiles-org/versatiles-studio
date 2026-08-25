//! Values a node's fields could take, worked out from what the node points at (S3.4, E2).
//!
//! The generated form ([C2](../../docs/features.md)) knows a field's *type* - this is where it
//! learns the field's *domain*. `from_csv`'s `lon_column` is a `String` as far as `field_meta` is
//! concerned, and one of a specific handful of strings as far as the file is concerned; only the
//! second is useful to fill in.
//!
//! **Separate from [`analysis::probe_layers`](crate::analysis::probe_layers)**, which answers the
//! same question for vector data by looking at what the pipeline produces ([Q29]). That cannot work
//! for a CSV: the pipeline will not build until `lon_column` and `lat_column` are set, so the file
//! has to be read directly. The two meet in the form, which does not care which end an answer came
//! from.
//!
//! Suggestions, never constraints. A file too large to have been read, a column that only appears
//! further down, a name Studio has no opinion about - all of those leave the field exactly as
//! usable as it was.
//!
//! [Q29]: ../../docs/decisions.md

use crate::vpl::{Node, Pipeline};
use serde::Serialize;
use std::path::Path;

/// What one field could be set to.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct FieldSuggestion {
	pub field: String,
	pub values: Vec<String>,
}

/// Fields of `from_csv` that name a column of the file.
///
/// Listed rather than inferred because nothing in `field_meta` marks a `String` as "a column name";
/// adding that upstream is the better fix, and is worth an issue once there is a second operation
/// that wants it.
const CSV_COLUMN_FIELDS: [&str; 5] = [
	"lon_column",
	"lat_column",
	"id_column",
	"properties_include",
	"properties_exclude",
];

/// Suggestions for a node's fields. Empty when there is nothing to say, which is most nodes.
///
/// `dir` is what a relative `filename` resolves against - the same directory the pipeline itself
/// resolves against, so a node that runs and a node that suggests are looking at the same file.
#[must_use]
pub fn for_node(node: &Node, dir: &Path) -> Vec<FieldSuggestion> {
	if node.name != "from_csv" {
		return Vec::new();
	}
	let Some(filename) = node.property("filename").first().cloned() else {
		return Vec::new();
	};

	let path = Path::new(&filename);
	let resolved = if path.is_absolute() {
		path.to_path_buf()
	} else {
		dir.join(path)
	};
	let Ok(columns) = crate::tabular::columns(&resolved) else {
		return Vec::new();
	};

	CSV_COLUMN_FIELDS
		.iter()
		.map(|field| FieldSuggestion {
			field: (*field).to_string(),
			values: columns.names.clone(),
		})
		.collect()
}

/// Suggestions for every node in a pipeline, by the path that names it.
///
/// **One answer for the whole graph, rather than one per selection.** Every node in the chain shows
/// its own form, so every node needs its own suggestions - and a `filename` on one node has nothing
/// to say about the field of another. Asking per node would be a round trip each; asking once is
/// cheap because [`for_node`] refuses everything that is not a `from_csv` before it touches a disk,
/// so a chain costs one header read per CSV node and a string comparison for the rest.
///
/// The path is the one [`Pipeline::at_path`](crate::vpl::Pipeline::at_path) follows, rendered as
/// `0.1.2` so it can key a map on either side of the boundary.
#[must_use]
pub fn for_pipeline(pipeline: &Pipeline, dir: &Path) -> Vec<NodeSuggestions> {
	let mut out = Vec::new();
	collect(pipeline, dir, &mut Vec::new(), &mut out);
	out
}

/// What one node's fields could take.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct NodeSuggestions {
	/// The node's path, as `0.1.2`.
	pub path: String,
	pub fields: Vec<FieldSuggestion>,
}

fn collect(pipeline: &Pipeline, dir: &Path, path: &mut Vec<usize>, out: &mut Vec<NodeSuggestions>) {
	for (index, node) in pipeline.nodes.iter().enumerate() {
		path.push(index);

		let fields = for_node(node, dir);
		if !fields.is_empty() {
			out.push(NodeSuggestions {
				path: path.iter().map(usize::to_string).collect::<Vec<_>>().join("."),
				fields,
			});
		}

		for (source, nested) in node.sources.iter().enumerate() {
			path.push(source);
			collect(nested, dir, path, out);
			path.pop();
		}

		path.pop();
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::vpl::Document;

	fn node_of(vpl: &str) -> Node {
		Document::parse(vpl).unwrap().pipeline().nodes[0].clone()
	}

	fn testdata() -> Option<std::path::PathBuf> {
		let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../versatiles-rs/testdata");
		if !dir.exists() {
			eprintln!("skipping: set STUDIO_TESTDATA to a directory of sample containers");
		}
		dir.exists().then_some(dir)
	}

	/// The case the guess cannot cover: a table whose coordinate columns are not obviously named.
	/// The form still gets the real names to offer, which is the difference between choosing and
	/// remembering.
	#[test]
	fn a_csv_offers_its_own_columns_for_the_fields_that_name_one() {
		let Some(dir) = testdata() else { return };
		let node = node_of("from_csv filename=cities.csv");

		let suggestions = for_node(&node, &dir);
		let lon = suggestions.iter().find(|s| s.field == "lon_column").unwrap();
		assert_eq!(lon.values, ["city_id", "city_name", "city_population"]);
		// The same names serve the property filters, which are also column names.
		assert!(suggestions.iter().any(|s| s.field == "properties_include"));
	}

	/// A relative filename means *beside the pipeline*, the same as it does when the node runs -
	/// so a suggestion and a build are never looking at two different files.
	#[test]
	fn a_relative_filename_resolves_the_way_the_pipeline_resolves_it() {
		let Some(dir) = testdata() else { return };
		let node = node_of("from_csv filename=quakes.csv");

		assert!(!for_node(&node, &dir).is_empty(), "resolved against the directory");
		assert!(
			for_node(&node, std::path::Path::new("/nowhere")).is_empty(),
			"and not against anywhere else"
		);
	}

	#[test]
	fn an_absolute_filename_ignores_the_directory() {
		let Some(dir) = testdata() else { return };
		let vpl = format!("from_csv filename='{}'", dir.join("quakes.csv").display());
		let node = node_of(&vpl);

		let suggestions = for_node(&node, std::path::Path::new("/nowhere"));
		assert!(suggestions[0].values.contains(&"magnitude".to_string()));
	}

	/// Nothing to say is the common answer, and it is not an error.
	#[test]
	fn a_node_with_no_file_behind_it_suggests_nothing() {
		assert!(for_node(&node_of("from_debug format=png"), Path::new(".")).is_empty());
		assert!(for_node(&node_of("from_csv"), Path::new(".")).is_empty());
		assert!(
			for_node(&node_of("from_csv filename=absent.csv"), Path::new("/nowhere")).is_empty(),
			"an unreadable file costs suggestions, not the form"
		);
	}
}

#[cfg(test)]
mod pipeline_tests {
	use super::*;
	use crate::vpl::Document;

	fn csv(dir: &Path, name: &str) -> String {
		std::fs::write(dir.join(name), "lon,lat,name\n1,2,here\n").expect("writing a test csv");
		name.to_string()
	}

	/// **The reason this exists.** Every node shows its own form, so two `from_csv` nodes reading
	/// different files must offer different columns - which is exactly what asking once per
	/// selection could not do.
	#[test]
	fn each_node_gets_its_own_file_s_columns() {
		let dir = crate::testing::dir("suggest-pipeline");
		std::fs::write(dir.join("a.csv"), "lon,lat,alpha\n1,2,3\n").unwrap();
		std::fs::write(dir.join("b.csv"), "x,y,beta\n1,2,3\n").unwrap();

		let document = Document::parse("from_stacked [ from_csv filename='a.csv', from_csv filename='b.csv' ]").unwrap();
		let found = for_pipeline(document.pipeline(), &dir);

		assert_eq!(found.len(), 2, "both CSV nodes should be described: {found:?}");
		let columns = |path: &str| {
			found
				.iter()
				.find(|entry| entry.path == path)
				.map(|entry| entry.fields[0].values.clone())
				.unwrap_or_default()
		};
		assert!(columns("0.0.0").contains(&"alpha".to_string()), "{found:?}");
		assert!(columns("0.1.0").contains(&"beta".to_string()), "{found:?}");
	}

	/// A path here has to be the path `at_path` follows, or the webview keys its map on one thing
	/// and looks it up with another.
	#[test]
	fn the_path_is_the_one_that_finds_the_node() {
		let dir = crate::testing::dir("suggest-paths");
		let name = csv(&dir, "points.csv");
		let document = Document::parse(format!("from_csv filename='{name}' | filter level_max=3")).unwrap();

		let found = for_pipeline(document.pipeline(), &dir);
		assert_eq!(found.len(), 1);
		let path: Vec<usize> = found[0].path.split('.').map(|p| p.parse().unwrap()).collect();
		assert_eq!(document.pipeline().at_path(&path).unwrap().name, "from_csv");
	}

	/// Most nodes have nothing to suggest, and saying so with an empty entry per node would make
	/// the answer mostly padding.
	#[test]
	fn nodes_with_nothing_to_say_are_left_out() {
		let dir = crate::testing::dir("suggest-quiet");
		let document = Document::parse("from_debug format=png | filter level_max=3").unwrap();
		assert!(for_pipeline(document.pipeline(), &dir).is_empty());
	}
}
