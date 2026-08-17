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
		id: "raster",
		label: "Raster image",
		detail: "GeoTIFF or COG, a VRT mosaic, a scanned PNG or JPEG",
		// Unverified against `from_gdal_raster`'s documentation, because the extension test only
		// checks kinds this build has — and this build does not have GDAL (S3.5 is blocked, see
		// [Q19](../../../docs/decisions.md)). It will be checked the moment the operation appears,
		// which is the point of writing the card now: linking GDAL is then a build change and not
		// also a UI change.
		extensions: &["tif", "tiff", "vrt", "png", "jpg", "jpeg"],
		operation: Some("from_gdal_raster"),
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

/// The VPL a chosen file becomes, with whatever the file itself can answer already filled in.
///
/// For most kinds this is [`vpl::read_node`](crate::vpl::read_node) and nothing more. For a CSV it
/// is the difference between an import that works and a form with two required fields and no clue
/// what goes in them: `lon_column` and `lat_column` are read from the header when the names are
/// unambiguous, and the delimiter is recorded when it is not the default (S3.4, E2).
///
/// **Never fails.** A header that cannot be read — a missing file, a binary one — leaves a node
/// with the parameters unset, which is exactly the state the import card said to expect. The
/// failure is worth reporting when the pipeline runs, not instead of building it.
#[must_use]
pub fn read_node(kind: &ImportKind, path: &str) -> String {
	let Some(operation) = &kind.operation else {
		return String::new();
	};
	if operation != "from_csv" {
		return crate::vpl::read_node(operation, path);
	}

	let Ok(columns) = crate::tabular::columns(std::path::Path::new(path)) else {
		return crate::vpl::read_node(operation, path);
	};

	let mut extra: Vec<(&str, &str)> = Vec::new();
	if let (Some(lon), Some(lat)) = (&columns.lon, &columns.lat) {
		extra.push(("lon_column", lon));
		extra.push(("lat_column", lat));
	}
	// Written only when it is not what `from_csv` already assumes: VPL should say what is unusual
	// about a file, not restate the default on every one.
	if columns.delimiter != "," {
		extra.push(("delimiter", &columns.delimiter));
	}
	crate::vpl::read_node_with(operation, path, &extra)
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

	/// E2's whole point: choosing a CSV whose columns are obviously named produces a pipeline that
	/// runs, with nothing left to fill in.
	#[tokio::test]
	async fn a_csv_with_obvious_columns_imports_ready_to_run() -> anyhow::Result<()> {
		let Some(dir) = testdata() else { return Ok(()) };
		let kind = kinds().into_iter().find(|k| k.id == "table").unwrap();
		let path = dir.join("quakes.csv");

		let vpl = read_node(&kind, &path.to_string_lossy());
		assert!(vpl.contains("lon_column=longitude"), "got {vpl}");
		assert!(vpl.contains("lat_column=latitude"), "got {vpl}");
		assert!(
			!vpl.contains("delimiter"),
			"a comma is the default and needs no saying: {vpl}"
		);

		// Nothing required is missing, so this validates — which is what the import card's warning
		// was there to prepare for and no longer has to.
		let document = crate::vpl::Document::parse(&vpl)?;
		assert!(
			crate::vpl::validate(&document).is_empty(),
			"{:?}",
			crate::vpl::validate(&document)
		);

		let runtime = versatiles::runtime::create_runtime();
		let source = crate::preview::build(&runtime, document.to_pipeline(), &dir).await?;
		let info = crate::analysis::describe(&source, "preview").await?;
		assert_eq!(info.tile_format, "mvt");
		assert!(info.max_zoom >= info.min_zoom);
		Ok(())
	}

	/// And the other half: a table with no coordinates leaves the required fields unset rather
	/// than guessing, so the form shows them waiting and the diagnostic says why.
	#[test]
	fn a_csv_without_obvious_columns_leaves_them_unset() {
		let Some(dir) = testdata() else { return };
		let kind = kinds().into_iter().find(|k| k.id == "table").unwrap();

		let vpl = read_node(&kind, &dir.join("cities.csv").to_string_lossy());
		assert!(!vpl.contains("lon_column"), "got {vpl}");

		let document = crate::vpl::Document::parse(&vpl).unwrap();
		let problems = crate::vpl::validate(&document);
		assert!(
			!problems.is_empty(),
			"a node missing a required parameter should be flagged (C4)"
		);
	}

	/// A delimiter the format does not assume has to be written down, or the file reads as one
	/// column — and it has to survive the quoting, which for a tab is not obvious.
	#[test]
	fn an_unusual_delimiter_is_recorded_and_survives_the_round_trip() {
		let path = std::env::temp_dir().join("versatiles-studio-import-semi.csv");
		std::fs::write(&path, "id;lon;lat\n1;13.4;52.5\n").unwrap();

		let kind = kinds().into_iter().find(|k| k.id == "table").unwrap();
		let vpl = read_node(&kind, &path.to_string_lossy());

		let document = crate::vpl::Document::parse(&vpl).unwrap();
		assert_eq!(document.pipeline().nodes[0].property("delimiter"), [";".to_string()]);
		assert_eq!(document.pipeline().nodes[0].property("lon_column"), ["lon".to_string()]);
	}

	fn testdata() -> Option<std::path::PathBuf> {
		let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../versatiles-rs/testdata");
		if !dir.exists() {
			eprintln!("skipping: set STUDIO_TESTDATA to a directory of sample containers");
		}
		dir.exists().then_some(dir)
	}

	/// No two kinds may claim the same extension, or which card a dropped file belongs to would
	/// depend on the order of this list.
	///
	/// Checked over [`CANDIDATES`] rather than over [`kinds`]: a kind whose operation this build
	/// lacks is filtered out of the latter, so a collision introduced alongside it would stay
	/// invisible until the day that operation arrived — which is the worst moment to find out.
	#[test]
	fn no_extension_belongs_to_two_kinds() {
		let mut seen: Vec<(&str, &str)> = Vec::new();
		for candidate in CANDIDATES {
			for extension in candidate.extensions {
				if let Some((other, _)) = seen.iter().find(|(_, ext)| ext == extension) {
					panic!("both {other} and {} claim .{extension}", candidate.id);
				}
				seen.push((candidate.id, extension));
			}
		}
	}
}
