//! Values a node's fields could take, worked out from what the node points at (S3.4, E2).
//!
//! The generated form ([C2](../../docs/features.md)) knows a field's *type* — this is where it
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
//! further down, a name Studio has no opinion about — all of those leave the field exactly as
//! usable as it was.
//!
//! [Q29]: ../../docs/decisions.md

use crate::vpl::Node;
use serde::Serialize;
use std::path::Path;

/// What one field could be set to.
#[derive(Debug, Clone, Serialize)]
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
/// `dir` is what a relative `filename` resolves against — the same directory the pipeline itself
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

	/// A relative filename means *beside the pipeline*, the same as it does when the node runs —
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
