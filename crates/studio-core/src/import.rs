//! What Studio can bring in, and what each of those becomes (S3.2, E1–E3).
//!
//! Every way into the application — the landing screen, "+ Add source", the file dialog, a dropped
//! file — asks this module rather than carrying its own list. The lists had already started to
//! disagree: the dialog offered four extensions, the drop handler filtered by the same four written
//! out again, and neither knew about `from_geo`, which the binary has had all along.
//!
//! **The catalogue answers to the binary, not to a plan.** A kind whose read operation is not in
//! this build is dropped from the list, so an import card can never offer something that would fail
//! on the first click. That matters for [E3](../../../docs/features.md): the GDAL raster path is a
//! build-time decision ([Q19](../../../docs/decisions.md)), and its card should appear when GDAL is
//! linked and not before — without a second flag somewhere in the webview to keep in step.
//!
//! **Picking a file is not always the whole import.** `from_csv` cannot know which column holds the
//! longitude, and no amount of looking at the filename will tell it. Those parameters are listed in
//! [`ImportKind::needs`], so a caller can say what is still missing; filling them in properly is the
//! wizard at S3.4.

use crate::vpl::operations;
use serde::Serialize;

/// One way of bringing data in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct ImportKind {
	/// Stable identifier, used by the caller to say which card was chosen.
	pub id: String,
	/// What the card says.
	pub label: String,
	/// The one-line explanation under it.
	pub detail: String,
	/// Extensions for the file dialog and the drop filter, without the dot, lowercase.
	pub extensions: Vec<String>,
	/// The read operation a chosen file becomes.
	///
	/// `None` for a `.vpl`, which is not a node — it is a whole document, and opening one replaces
	/// the pipeline rather than adding to it (C9).
	pub operation: Option<String>,
	/// Required parameters a filename cannot supply, in the order the operation declares them.
	///
	/// Empty means picking a file completes the import. Anything here has to come from somewhere
	/// else: the file's own header, or the person.
	pub needs: Vec<String>,
}

/// A catalogue entry before the registry has been consulted.
struct Candidate {
	id: &'static str,
	label: &'static str,
	detail: &'static str,
	extensions: &'static [&'static str],
	operation: Option<&'static str>,
}

/// The catalogue, in the order it is offered.
///
/// Containers first because that is the common case, then the two vector paths, then the pipeline
/// file — which is last because it is a way of *reopening* work rather than of bringing data in.
///
/// The extensions are written here rather than parsed out of the operation's documentation, and a
/// test checks each one against that documentation. Parsing prose to build a file dialog would be
/// clever and would break the first time somebody rewrote a sentence.
const CANDIDATES: &[Candidate] = &[
	Candidate {
		id: "container",
		label: "Tile container",
		detail: "Tiles that have already been built",
		extensions: &["versatiles", "mbtiles", "pmtiles", "tar"],
		operation: Some("from_container"),
	},
	Candidate {
		id: "vector",
		label: "Vector data",
		detail: "GeoJSON, line-delimited GeoJSON, or a shapefile",
		// `.json` because `from_geo` reads a bare GeoJSON `FeatureCollection` under that name. It
		// will collide with `style.json` at S4, and this list is where that gets resolved — by
		// looking inside the file, which is the only thing that can actually tell them apart.
		extensions: &[
			"geojson",
			"json",
			"ndjson",
			"geojsonl",
			"ndgeojson",
			"geojsonseq",
			"shp",
		],
		operation: Some("from_geo"),
	},
	Candidate {
		id: "table",
		label: "Table of points",
		detail: "A CSV with longitude and latitude columns",
		// Not `.tsv`: `from_csv` splits on `,` unless told otherwise, so offering one would produce
		// a single column with tabs in it. It belongs to the wizard that can set `delimiter` (S3.4).
		extensions: &["csv"],
		operation: Some("from_csv"),
	},
	Candidate {
		id: "pipeline",
		label: "Pipeline file",
		detail: "A .vpl written here or by the CLI",
		extensions: &["vpl"],
		operation: None,
	},
];

/// Every kind this build can actually import.
#[must_use]
pub fn kinds() -> Vec<ImportKind> {
	let available = operations();
	CANDIDATES
		.iter()
		.filter_map(|candidate| {
			let needs = match candidate.operation {
				None => Vec::new(),
				Some(name) => {
					// Absent from the registry means absent from the binary, and a card for it would
					// be an offer this build cannot keep.
					let operation = available.iter().find(|op| op.name == name)?;
					operation
						.fields
						.iter()
						.filter(|field| field.required && field.name != "filename")
						.map(|field| field.name.clone())
						.collect()
				}
			};
			Some(ImportKind {
				id: candidate.id.to_string(),
				label: candidate.label.to_string(),
				detail: candidate.detail.to_string(),
				extensions: candidate.extensions.iter().map(|&e| e.to_string()).collect(),
				operation: candidate.operation.map(str::to_string),
				needs,
			})
		})
		.collect()
}

/// The kind an extension belongs to, or `None` for a file Studio has no way in for.
///
/// First match wins, which is why `json` sits under `vector` — `from_geo` is what reads it, and no
/// other kind claims it.
#[must_use]
pub fn kind_for(path: &str) -> Option<ImportKind> {
	let lower = path.to_lowercase();
	kinds()
		.into_iter()
		.find(|kind| kind.extensions.iter().any(|ext| lower.ends_with(&format!(".{ext}"))))
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The point of the module: what is offered is what the binary can do.
	#[test]
	fn every_offered_kind_has_its_operation() {
		let available = operations();
		for kind in kinds() {
			let Some(name) = &kind.operation else { continue };
			assert!(
				available.iter().any(|op| &op.name == name),
				"{} offers {name}, which this build does not have",
				kind.id
			);
		}
	}

	/// The extensions are hand-written, so each is checked against the operation's own
	/// documentation. This is what catches a format being added or dropped upstream while a card
	/// still claims it — and it caught `.tsv`, which nothing upstream ever promised.
	///
	/// Matched as a **word** rather than as `.ext`, because the operations do not describe
	/// themselves consistently: `from_geo` lists `.geojson` / `.ndjson` / `.shp` literally, while
	/// `from_csv` says "Reads a CSV file". A word match still fails for anything the operation has
	/// no idea about, which is the drift worth catching.
	#[test]
	fn every_extension_is_named_in_the_operations_documentation() {
		let available = operations();
		for kind in kinds() {
			let Some(name) = &kind.operation else { continue };
			let operation = available.iter().find(|op| &op.name == name).unwrap();
			// The container reader names its formats in the summary; the others list them under
			// `filename`. Searching both covers either style without depending on which.
			let text = format!(
				"{}{}",
				operation.doc,
				operation.fields.iter().map(|f| f.doc.clone()).collect::<String>()
			);
			let words: Vec<String> = text
				.to_lowercase()
				.split(|c: char| !c.is_ascii_alphanumeric())
				.map(str::to_string)
				.collect();
			for extension in &kind.extensions {
				assert!(
					words.iter().any(|word| word == extension),
					"{name} is offered for .{extension}, which its documentation does not mention"
				);
			}
		}
	}

	/// A card that says "pick a file" when the operation needs two more answers would be lying, so
	/// what is still missing comes from the registry rather than from a hand-kept note.
	#[test]
	fn what_a_filename_cannot_supply_is_listed() {
		let by_id = |id: &str| kinds().into_iter().find(|k| k.id == id).unwrap();
		assert!(
			by_id("container").needs.is_empty(),
			"a container is complete once it is chosen"
		);
		assert!(by_id("vector").needs.is_empty());
		assert_eq!(
			by_id("table").needs,
			["lon_column", "lat_column"],
			"a CSV cannot say which columns hold the coordinates"
		);
	}

	/// A `.vpl` is a document, not a node — opening one replaces the pipeline (C9).
	#[test]
	fn a_pipeline_file_is_not_a_read_operation() {
		let pipeline = kinds().into_iter().find(|k| k.id == "pipeline").unwrap();
		assert_eq!(pipeline.operation, None);
		assert!(pipeline.needs.is_empty());
	}

	#[test]
	fn a_path_is_matched_to_its_kind_whatever_its_case() {
		assert_eq!(kind_for("/tmp/Berlin.MBTiles").unwrap().id, "container");
		assert_eq!(kind_for("cities.geojson").unwrap().id, "vector");
		assert_eq!(kind_for("cities.csv").unwrap().id, "table");
		assert_eq!(kind_for("berlin.vpl").unwrap().id, "pipeline");
		assert!(kind_for("notes.txt").is_none());
		// Not merely "contains" — a file *named* like an extension is not that extension.
		assert!(kind_for("geojson").is_none());
	}

	/// The catalogue's actual promise: a file offered by a card can be opened, and produces tiles.
	///
	/// Every step the application takes is taken here — match the path to a kind, build the read
	/// node, parse it, validate it, run it — because each of those is somewhere the chain could be
	/// right in isolation and wrong together. A card claiming `.shp` while `from_geo` cannot open
	/// one would pass every other test in this file.
	#[tokio::test]
	async fn a_file_of_each_offered_kind_builds_into_tiles() -> anyhow::Result<()> {
		let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../versatiles-rs/testdata");
		if !dir.exists() {
			eprintln!("skipping: set STUDIO_TESTDATA to a directory of sample containers");
			return Ok(());
		}
		let runtime = versatiles::runtime::create_runtime();

		// One file per offered kind, and for `from_geo` one of each format it detects — the
		// extension list is the claim, so a sample of it is what is checked.
		for (file, extra) in [
			("berlin.versatiles", ""),
			("berlin.mbtiles", ""),
			("berlin.pmtiles", ""),
			("borders.geojson", ""),
			("places.geojsonl", ""),
			("admin.shp", ""),
			// What `needs` names, supplied — which is exactly what the card says will be asked for.
			("quakes.csv", " lon_column=longitude lat_column=latitude"),
		] {
			let path = dir.join(file);
			assert!(path.exists(), "{file} is missing from the test data");
			let kind = kind_for(file).unwrap_or_else(|| panic!("no card offers {file}"));
			let operation = kind.operation.as_ref().unwrap();

			let vpl = format!("{}{extra}", crate::vpl::read_node(operation, &path.to_string_lossy()));
			let document = crate::vpl::Document::parse(&vpl)?;
			assert!(
				crate::vpl::validate(&document).is_empty(),
				"{vpl} did not validate: {:?}",
				crate::vpl::validate(&document)
			);

			let source = crate::preview::build(&runtime, document.to_pipeline(), &dir).await?;
			let info = crate::analysis::describe(&source, "preview").await?;
			assert!(
				info.max_zoom >= info.min_zoom,
				"{file} produced no zoom range: {info:?}"
			);
		}
		Ok(())
	}

	/// No two kinds may claim the same extension, or which card a dropped file belongs to would
	/// depend on the order of this list.
	#[test]
	fn no_extension_belongs_to_two_kinds() {
		let mut seen: Vec<(String, String)> = Vec::new();
		for kind in kinds() {
			for extension in kind.extensions {
				if let Some((other, _)) = seen.iter().find(|(_, ext)| ext == &extension) {
					panic!("both {other} and {} claim .{extension}", kind.id);
				}
				seen.push((kind.id.clone(), extension));
			}
		}
	}
}
