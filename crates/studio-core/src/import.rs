//! What Studio can bring in, and what each of those becomes (S3.2, E1-E3).
//!
//! Every way into the application - the landing screen, "+ Add source", the file dialog, a dropped
//! file - asks this module rather than carrying its own list. The lists had already started to
//! disagree: the dialog offered four extensions, the drop handler filtered by the same four written
//! out again, and neither knew about `from_geo`, which the binary has had all along.
//!
//! **The catalogue answers to the binary, not to a plan.** A kind whose read operation is not in
//! this build is dropped from the list, so an import card can never offer something that would fail
//! on the first click. That matters for [E3](../../../docs/features.md): the GDAL raster path is a
//! build-time decision ([Q19](../../../docs/decisions.md)), and its card should appear when GDAL is
//! linked and not before - without a second flag somewhere in the webview to keep in step.
//!
//! **Picking a file is not always the whole import.** `from_csv` cannot know which column holds the
//! longitude, and no amount of looking at the filename will tell it. Those parameters are listed in
//! [`ImportKind::needs`], so a caller can say what is still missing; filling them in properly is the
//! wizard at S3.4.

use crate::vpl::operations;
use anyhow::{Context, Result};
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
	/// `None` for a `.vpl`, which is not a node - it is a whole document, and opening one replaces
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
/// file - which is last because it is a way of *reopening* work rather than of bringing data in.
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
		// will collide with `style.json` at S4, and this list is where that gets resolved - by
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
		// **Never reached by extension**, and deliberately after `vector`: `kind_for` is first match
		// wins, so a `.json` still resolves to `from_geo` on its name alone. This entry is what
		// `opening_for` looks up once it has read the file and knows better.
		id: "tilejson",
		label: "Tile server",
		detail: "A TileJSON endpoint describing where tiles are served",
		// **No extensions, deliberately.** A `.json` is a GeoJSON as far as its name goes, and one
		// extension belongs to one kind - `no_extension_belongs_to_two_kinds` holds that, and it is
		// what makes `kind_for`'s first-match rule unambiguous. This entry is reached only by
		// `opening_for`, which has read the document and knows what the name could not say.
		extensions: &[],
		operation: Some("from_tilejson"),
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
		// checks kinds this build has - and this build does not have GDAL (S3.5 is blocked, see
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
						.filter(|field| field.required && field.name != source_parameter(name))
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

/// The parameter a chosen source fills in.
///
/// **`filename` for everything that reads a file, `url` for the one that fetches.** `from_tilejson`
/// takes a URL and nothing else - it does an HTTP GET for the document and re-reads it every time
/// the pipeline is built - so a card that wrote `filename=` for it would produce a node that cannot
/// parse, and `needs` would list `url` as something still to be asked for when the source *is* the
/// url.
///
/// Both spellings are checked against the registry rather than assumed, so an operation that has
/// neither falls back to its first required field instead of silently writing a parameter it has
/// never heard of.
#[must_use]
pub fn source_parameter(operation: &str) -> String {
	let all = operations();
	let Some(found) = all.iter().find(|op| op.name == operation) else {
		return "filename".to_string();
	};
	let required = |name: &str| found.fields.iter().any(|field| field.required && field.name == name);
	if required("filename") {
		return "filename".to_string();
	}
	if required("url") {
		return "url".to_string();
	}
	found
		.fields
		.iter()
		.find(|field| field.required)
		.map_or_else(|| "filename".to_string(), |field| field.name.clone())
}

/// The kind an extension belongs to, or `None` for a file Studio has no way in for.
///
/// First match wins, which is why `json` sits under `vector` - `from_geo` is what reads it, and no
/// other kind claims it.
#[must_use]
pub fn kind_for(path: &str) -> Option<ImportKind> {
	let lower = path.to_lowercase();
	kinds()
		.into_iter()
		.find(|kind| kind.extensions.iter().any(|ext| lower.ends_with(&format!(".{ext}"))))
}

/// What a document under a `.json` turned out to hold.
///
/// **Three formats share the extension**, and the catalogue said so from the day `.json` was added
/// to the vector card: *"it will collide with `style.json`, and this list is where that gets
/// resolved - by looking inside the file, which is the only thing that can actually tell them
/// apart."* This is that.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JsonShape {
	/// A TileJSON: tiles someone else is serving.
	TileJson,
	/// GeoJSON, which is what `.json` resolves to on its name alone.
	GeoJson,
	/// A MapLibre style. Not data at all - it describes how to draw somebody else's.
	Style,
	/// None of the three, or not JSON, or more of it than is worth reading.
	Unknown,
}

/// How much of a document is read to find out.
///
/// A TileJSON is a few kilobytes and a style is tens; a GeoJSON is routinely gigabytes, and reading
/// one to classify it would be the most expensive way to learn what its extension already said.
/// Past this the head does not parse - it is a truncated document - and `Unknown` sends the caller
/// back to the answer the name gave, which is the behaviour that was there before.
///
/// **32 kB because that is one request.** `DataReaderHttp` splits a larger range into 32 kB chunks,
/// and for a 14 kB document the second chunk starts past the end - which the server answers `416`,
/// correctly, costing 220 ms to learn nothing. A single chunk starting at 0 is satisfiable whatever
/// the length: the server clamps and returns what exists, in one round trip. Sniffing this document
/// went from 479 ms to about 90 ms by asking for less.
const SNIFF_BYTES: u64 = 32 * 1024;

/// Reads the shape out of a JSON document.
///
/// Parsed rather than scanned for a substring: a GeoJSON feature is free to carry a property called
/// `tilejson`, and a report of what a file *is* should not be decided by what it happens to contain.
#[must_use]
pub fn json_shape(text: &str) -> JsonShape {
	let Ok(serde_json::Value::Object(object)) = serde_json::from_str::<serde_json::Value>(text) else {
		return JsonShape::Unknown;
	};

	// `tilejson` is required by the spec, and `tiles` is what the operation actually needs - a
	// document with templates and no version is still a tile server, and they are out there.
	if object.contains_key("tilejson") || has_tile_templates(&object) {
		return JsonShape::TileJson;
	}

	if let Some(kind) = object.get("type").and_then(serde_json::Value::as_str)
		&& matches!(
			kind,
			"FeatureCollection"
				| "Feature"
				| "GeometryCollection"
				| "Point"
				| "MultiPoint"
				| "LineString"
				| "MultiLineString"
				| "Polygon"
				| "MultiPolygon"
		) {
		return JsonShape::GeoJson;
	}

	// A style is version 8 with layers. Checked after TileJSON because a style's `sources` may hold
	// TileJSON-shaped objects, and the outer document is what is being named here.
	if object.get("version").and_then(serde_json::Value::as_u64) == Some(8) && object.contains_key("layers") {
		return JsonShape::Style;
	}

	JsonShape::Unknown
}

/// Whether `tiles` holds URL templates, which is the one thing every TileJSON has.
fn has_tile_templates(object: &serde_json::Map<String, serde_json::Value>) -> bool {
	object
		.get("tiles")
		.and_then(serde_json::Value::as_array)
		.and_then(|tiles| tiles.first())
		.and_then(serde_json::Value::as_str)
		.is_some_and(|template| template.contains("{z}") && template.contains("{x}") && template.contains("{y}"))
}

/// Whether a source is somewhere on the network rather than on this machine.
#[must_use]
pub fn is_remote(source: &str) -> bool {
	let lower = source.to_lowercase();
	lower.starts_with("http://") || lower.starts_with("https://")
}

/// The head of a document, local or remote, capped at [`SNIFF_BYTES`].
async fn head_of(source: &str) -> Result<String> {
	let bytes = if is_remote(source) {
		return head_of_url(source).await;
	} else {
		use std::io::Read;
		let file = std::fs::File::open(source).with_context(|| format!("opening {source}"))?;
		let mut head = Vec::new();
		file.take(SNIFF_BYTES).read_to_end(&mut head)?;
		head
	};

	// Lossy: a truncated head can cut a multi-byte character in half, and the parse below is what
	// decides whether the text is usable. Failing here instead would report an encoding problem for
	// a document that is merely bigger than the cap.
	Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// The head of a remote document: one request, and never more than [`SNIFF_BYTES`] of it.
///
/// **A client of our own, and this is the reason.** `DataReaderHttp` is built for reading
/// containers, where a short read means the file is truncated - so it treats one as an error *and
/// retries it with exponential backoff*, a second, then two, then four. Every TileJSON is smaller
/// than any range worth asking for, so that failure was guaranteed: identifying this document took
/// 8.3 seconds against a server having a slow moment, and the whole of it was sleeping between
/// retries of a request that could not have succeeded.
///
/// Read in chunks and stopped rather than `bytes()`, so a gigabyte of GeoJSON behind a URL costs one
/// connection and 32 kB of it. The response is dropped at that point, which closes the connection.
async fn head_of_url(source: &str) -> Result<String> {
	let client = reqwest::Client::builder()
		.user_agent(concat!("versatiles-studio/", env!("CARGO_PKG_VERSION")))
		.build()
		.context("building an HTTP client")?;

	let mut response = client
		.get(source)
		.send()
		.await
		.with_context(|| format!("requesting {source}"))?
		.error_for_status()
		.with_context(|| format!("requesting {source}"))?;

	let mut head = Vec::new();
	while let Some(chunk) = response.chunk().await.with_context(|| format!("reading {source}"))? {
		head.extend_from_slice(&chunk);
		if head.len() as u64 >= SNIFF_BYTES {
			head.truncate(SNIFF_BYTES as usize);
			break;
		}
	}

	Ok(String::from_utf8_lossy(&head).into_owned())
}

/// What Studio will do with a chosen source.
///
/// Two answers rather than one, because "no" and "no, and here is why" are different things to a
/// person who has just picked a file. A refusal names what the document turned out to be; it is not
/// an error, and nothing has gone wrong.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Opening {
	/// How to open it, or `None`.
	pub kind: Option<ImportKind>,
	/// Why not, when Studio knows what the file is and still cannot open it.
	pub refused: Option<String>,
}

impl Opening {
	fn open(kind: Option<ImportKind>) -> Self {
		Self { kind, refused: None }
	}

	fn refuse(reason: impl Into<String>) -> Self {
		Self {
			kind: None,
			refused: Some(reason.into()),
		}
	}
}

/// How to open a source, having looked inside it when its name was not enough.
///
/// **Only `.json` is ambiguous**, so only `.json` is read. Every other extension belongs to exactly
/// one kind - `no_extension_belongs_to_two_kinds` holds that - and opening a file to confirm what
/// its name already settled would be a read per import for no answer.
///
/// A sniff that fails for any reason falls back to the name's answer. Being unable to read the head
/// is not a reason to refuse a file that would have opened before.
pub async fn opening_for(source: &str) -> Opening {
	let by_name = kind_for(source);
	if !source.to_lowercase().ends_with(".json") {
		return Opening::open(by_name);
	}

	let Ok(head) = head_of(source).await else {
		return Opening::open(by_name);
	};

	match json_shape(&head) {
		JsonShape::TileJson if is_remote(source) => Opening::open(kinds().into_iter().find(|kind| kind.id == "tilejson")),
		// **The one Studio knows and cannot open.** `from_tilejson` fetches its document over HTTP -
		// it has no file branch at all - so a TileJSON on disk has no operation behind it. Saying so
		// here beats `from_geo` failing three steps later with a message about features.
		JsonShape::TileJson => Opening::refuse(
			"This is a TileJSON: it describes tiles a server is publishing, rather than holding any. \
			 Studio reads those from the address they are served at, not from a copy on disk.",
		),
		JsonShape::Style => Opening::refuse(
			"This is a MapLibre style, not data. It describes how to draw tiles that are somewhere \
			 else - open those, and load this under the style pane.",
		),
		JsonShape::GeoJson | JsonShape::Unknown => Opening::open(by_name),
	}
}

/// The extensions a pipeline file may have - one place, so a dialog's filter and a command's
/// refusal cannot disagree about what a `.vpl` is.
#[must_use]
pub fn pipeline_extensions() -> &'static [&'static str] {
	CANDIDATES
		.iter()
		.find(|candidate| candidate.id == "pipeline")
		.map_or(&[], |candidate| candidate.extensions)
}

/// Whether `path` names a pipeline file.
///
/// The counterpart to [`export::is_writable`](crate::export::is_writable), and the one place that
/// decides: a dialog's filter, a command's refusal, and the writer's own guard all ask this rather
/// than each spelling out what a `.vpl` is.
#[must_use]
pub fn is_pipeline(path: &std::path::Path) -> bool {
	path
		.extension()
		.and_then(|extension| extension.to_str())
		.is_some_and(|extension| {
			pipeline_extensions()
				.iter()
				.any(|allowed| extension.eq_ignore_ascii_case(allowed))
		})
}

/// The VPL a chosen file becomes, with whatever the file itself can answer already filled in.
///
/// For most kinds this is [`vpl::read_node`](crate::vpl::read_node) and nothing more. For a CSV it
/// is the difference between an import that works and a form with two required fields and no clue
/// what goes in them: `lon_column` and `lat_column` are read from the header when the names are
/// unambiguous, and the delimiter is recorded when it is not the default (S3.4, E2).
///
/// **Never fails.** A header that cannot be read - a missing file, a binary one - leaves a node
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

	/// The command that saves a `.vpl` refuses a destination this does not name, so an empty list
	/// would refuse *every* save - fail-closed, but silently, and only for whoever renamed the id.
	#[test]
	fn a_pipeline_still_knows_what_it_is_called() {
		let extensions = pipeline_extensions();
		assert!(!extensions.is_empty(), "the pipeline kind lost its extensions");
		assert!(extensions.contains(&"vpl"), "{extensions:?}");
	}

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
	/// still claims it - and it caught `.tsv`, which nothing upstream ever promised.
	///
	/// Matched as a **word** rather than as `.ext`, because the operations do not describe
	/// themselves consistently: `from_geo` lists `.geojson` / `.ndjson` / `.shp` literally, while
	/// `from_csv` says "Reads a CSV file". A word match still fails for anything the operation has
	/// no idea about, which is the drift worth catching.
	#[test]
	fn every_extension_is_named_in_the_operations_documentation() {
		let available = operations();
		for kind in kinds() {
			// `from_gdal_raster` documents itself as reading "a GDAL raster dataset" and gives one
			// example filename; what it can actually open is decided by the drivers this build
			// linked, not by its prose. Checked against those instead - see
			// `gdal_reads_every_extension_the_raster_card_claims`.
			if kind.id == "raster" {
				continue;
			}
			let Some(name) = &kind.operation else { continue };
			let operation = available.iter().find(|op| &op.name == name).unwrap();
			// The container reader names its formats in the summary; the others list them under
			// `filename`. Searching both covers either style without depending on which.
			let text = format!(
				"{}{}{}",
				operation.summary,
				operation.details,
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

	/// **The collision the catalogue predicted.** Three formats wear `.json`, and the name settles
	/// none of them - so what a document *is* has to come from inside it.
	mod what_a_json_turns_out_to_be {
		use super::*;

		#[test]
		fn a_tilejson_is_one_by_its_version() {
			let text = r#"{"tilejson":"3.0.0","tiles":["https://x/{z}/{x}/{y}.pbf"]}"#;
			assert_eq!(json_shape(text), JsonShape::TileJson);
		}

		/// Plenty of them in the wild omit the version and are still tile servers, and `tiles` is
		/// what the operation actually needs.
		#[test]
		fn a_tilejson_is_one_by_its_templates_alone() {
			let text = r#"{"name":"osm","tiles":["https://x/{z}/{x}/{y}.pbf"],"maxzoom":14}"#;
			assert_eq!(json_shape(text), JsonShape::TileJson);
		}

		#[test]
		fn a_geojson_is_one_whichever_shape_it_holds() {
			for kind in ["FeatureCollection", "Feature", "Point", "Polygon", "GeometryCollection"] {
				let text = format!(r#"{{"type":"{kind}","features":[]}}"#);
				assert_eq!(json_shape(&text), JsonShape::GeoJson, "{kind}");
			}
		}

		#[test]
		fn a_style_is_neither() {
			let text = r#"{"version":8,"sources":{},"layers":[]}"#;
			assert_eq!(json_shape(text), JsonShape::Style);
		}

		/// **Parsed, not scanned.** A feature is free to carry a property called `tilejson`, and what
		/// a file *is* must not be decided by what it happens to contain.
		#[test]
		fn a_geojson_carrying_the_word_is_still_a_geojson() {
			let text = r#"{"type":"FeatureCollection","features":[
				{"type":"Feature","properties":{"tilejson":"3.0.0","tiles":["{z}/{x}/{y}"]},"geometry":null}]}"#;
			assert_eq!(json_shape(text), JsonShape::GeoJson);
		}

		/// A head cut at [`SNIFF_BYTES`] does not parse, which is the answer: nothing that big is a
		/// TileJSON, and the caller falls back to what the name said.
		#[test]
		fn a_document_too_big_to_read_is_unknown() {
			assert_eq!(
				json_shape(r#"{"type":"FeatureCollection","features":[{"type":"Fea"#),
				JsonShape::Unknown
			);
			assert_eq!(json_shape(""), JsonShape::Unknown);
			assert_eq!(json_shape("[1,2,3]"), JsonShape::Unknown);
			assert_eq!(json_shape("not json at all"), JsonShape::Unknown);
		}

		#[tokio::test]
		async fn a_local_tilejson_is_refused_with_a_reason() {
			let dir = crate::testing::dir("tilejson-local");
			let path = dir.join("tiles.json");
			std::fs::write(&path, r#"{"tilejson":"3.0.0","tiles":["https://x/{z}/{x}/{y}.pbf"]}"#).unwrap();

			let opening = opening_for(&path.to_string_lossy()).await;
			assert!(opening.kind.is_none());
			assert!(
				opening.refused.as_deref().unwrap_or_default().contains("TileJSON"),
				"{:?}",
				opening.refused
			);
		}

		/// The case that has an operation behind it. `from_tilejson` fetches, so the source has to be
		/// somewhere it can fetch from.
		#[test]
		fn the_tilejson_card_reads_a_url_rather_than_a_file() {
			let card = kinds().into_iter().find(|kind| kind.id == "tilejson").unwrap();
			assert_eq!(card.operation.as_deref(), Some("from_tilejson"));
			assert_eq!(source_parameter("from_tilejson"), "url");
			// And nothing is left to ask for: the source answers the operation's only requirement.
			assert!(card.needs.is_empty(), "{:?}", card.needs);
		}

		#[test]
		fn everything_else_still_reads_a_filename() {
			for operation in ["from_container", "from_geo", "from_csv"] {
				assert_eq!(source_parameter(operation), "filename", "{operation}");
			}
		}

		#[tokio::test]
		async fn a_geojson_opens_as_it_always_did() {
			let dir = crate::testing::dir("geojson-local");
			let path = dir.join("places.json");
			std::fs::write(&path, r#"{"type":"FeatureCollection","features":[]}"#).unwrap();

			let opening = opening_for(&path.to_string_lossy()).await;
			assert_eq!(opening.kind.map(|kind| kind.id), Some("vector".to_string()));
			assert!(opening.refused.is_none());
		}

		/// A file that cannot be read at all is not a reason to refuse an import that would have
		/// worked before: the name's answer stands.
		#[tokio::test]
		async fn an_unreadable_json_falls_back_to_its_name() {
			let opening = opening_for("/nowhere/at/all/places.json").await;
			assert_eq!(opening.kind.map(|kind| kind.id), Some("vector".to_string()));
			assert!(opening.refused.is_none());
		}

		/// A loopback file server, answering ranges the way RFC 7233 says to.
		///
		/// Small enough to read, and the one rule that matters is the one a convenient fake would
		/// have left out: a range starting past the end is *unsatisfiable*, not empty.
		async fn serve(body: &'static str) -> String {
			serve_counting(body, std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0))).await
		}

		/// The same server, with a tally of the requests it answered.
		async fn serve_counting(body: &'static str, requests: std::sync::Arc<std::sync::atomic::AtomicUsize>) -> String {
			use tokio::io::{AsyncReadExt, AsyncWriteExt};

			let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
			let port = listener.local_addr().unwrap().port();
			tokio::spawn(async move {
				while let Ok((mut socket, _)) = listener.accept().await {
					let mut buffer = [0_u8; 2048];
					let read = socket.read(&mut buffer).await.unwrap_or(0);
					let request = String::from_utf8_lossy(&buffer[..read]).into_owned();
					requests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
					let _ = socket.write_all(answer(&request, body).as_bytes()).await;
					let _ = socket.shutdown().await;
				}
			});
			format!("http://127.0.0.1:{port}")
		}

		fn answer(request: &str, body: &str) -> String {
			let len = body.len();
			let Some(range) = request
				.lines()
				.find_map(|line| line.trim().strip_prefix("Range: bytes="))
			else {
				return format!("HTTP/1.1 200 OK\r\nContent-Length: {len}\r\nAccept-Ranges: bytes\r\n\r\n{body}");
			};

			let (from, to) = range.trim().split_once('-').unwrap_or((range.trim(), ""));
			let start: usize = from.parse().unwrap_or(0);
			if start >= len {
				return format!(
					"HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{len}\r\nContent-Length: 0\r\n\r\n"
				);
			}
			let end = to.parse::<usize>().unwrap_or(len - 1).min(len - 1);
			let slice = &body[start..=end];
			format!(
				"HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {start}-{end}/{len}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\n\r\n{slice}",
				slice.len()
			)
		}

		/// **The bug that made this useless in the field**, and the reason it was invisible: asking
		/// for 64 kB of a 14 kB document is a range past the end, the server answers `416 Range Not
		/// Satisfiable`, and a failed sniff falls back to the name - so every remote TileJSON opened
		/// as GeoJSON and said nothing about why. No fixed cap avoids it; a smaller document refuses
		/// whatever the cap is.
		///
		/// Served over the loopback rather than mocked, because what has to be exercised is a real
		/// server refusing a real range - which is precisely what a fake would have been written not
		/// to do.
		#[tokio::test]
		async fn a_remote_tilejson_smaller_than_the_cap_is_still_read() {
			let body = r#"{"tilejson":"3.0.0","tiles":["https://x/{z}/{x}/{y}.pbf"],"maxzoom":14}"#;

			let served = serve(body).await;
			let opening = opening_for(&format!("{served}/bm.json")).await;

			assert_eq!(
				opening.kind.as_ref().map(|kind| kind.id.as_str()),
				Some("tilejson"),
				"refused: {:?}",
				opening.refused
			);
			assert!(opening.refused.is_none());
		}

		/// **A sniff is one request**, and the reason it is worth pinning.
		///
		/// It used to be three, two of which could never have succeeded: a ranged read for more bytes
		/// than a small document has is an error to `DataReaderHttp`, which then *retries it with
		/// exponential backoff* - a second, then two, then four. Identifying a 14 kB TileJSON took
		/// **8.3 seconds** against a server having a slow moment, essentially all of it spent asleep
		/// between retries. It is 0.16 s now.
		#[tokio::test]
		async fn identifying_a_document_costs_one_request() {
			use std::sync::atomic::{AtomicUsize, Ordering};

			let body = r#"{"tilejson":"3.0.0","tiles":["https://x/{z}/{x}/{y}.pbf"],"maxzoom":14}"#;
			let requests = std::sync::Arc::new(AtomicUsize::new(0));
			let served = serve_counting(body, requests.clone()).await;

			let opening = opening_for(&format!("{served}/bm.json")).await;
			assert_eq!(opening.kind.as_ref().map(|kind| kind.id.as_str()), Some("tilejson"));
			assert_eq!(
				requests.load(Ordering::Relaxed),
				1,
				"identifying a document is one GET - never a range that has to fail first"
			);
		}

		/// Only `.json` is ambiguous, so only `.json` costs a read.
		#[tokio::test]
		async fn an_unambiguous_extension_is_not_opened_to_be_sure() {
			let opening = opening_for("/nowhere/berlin.mbtiles").await;
			assert_eq!(opening.kind.map(|kind| kind.id), Some("container".to_string()));
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

	/// A `.vpl` is a document, not a node - opening one replaces the pipeline (C9).
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
		// Not merely "contains" - a file *named* like an extension is not that extension.
		assert!(kind_for("geojson").is_none());
	}

	/// The catalogue's actual promise: a file offered by a card can be opened, and produces tiles.
	///
	/// Every step the application takes is taken here - match the path to a kind, build the read
	/// node, parse it, validate it, run it - because each of those is somewhere the chain could be
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

		// One file per offered kind, and for `from_geo` one of each format it detects - the
		// extension list is the claim, so a sample of it is what is checked.
		for (file, extra) in [
			("berlin.versatiles", ""),
			("berlin.mbtiles", ""),
			("berlin.pmtiles", ""),
			("borders.geojson", ""),
			("places.geojsonl", ""),
			("admin.shp", ""),
			// What `needs` names, supplied - which is exactly what the card says will be asked for.
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

		// Nothing required is missing, so this validates - which is what the import card's warning
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
	/// column - and it has to survive the quoting, which for a tab is not obvious.
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

	/// E3 end to end: a GeoTIFF chosen from the raster card becomes tiles.
	///
	/// The bbox matters as much as the tiles do - it is Web Mercator, which means a coordinate
	/// transform ran, which means PROJ found its `proj.db`. That database is *embedded in libproj*
	/// rather than on disk ([Q19](../../../docs/decisions.md)), and a self-contained binary is the
	/// whole reason GDAL is statically bundled, so this is the assertion that premise rests on.
	#[tokio::test]
	async fn a_geotiff_imports_into_tiles() -> anyhow::Result<()> {
		let Some(dir) = testdata() else { return Ok(()) };
		let Some(kind) = kinds().into_iter().find(|kind| kind.id == "raster") else {
			eprintln!("skipping: this build has no GDAL");
			return Ok(());
		};

		let path = dir.join("gradient.tif");
		let vpl = read_node(&kind, &path.to_string_lossy());
		let document = crate::vpl::Document::parse(&vpl)?;
		assert!(
			crate::vpl::validate(&document).is_empty(),
			"{vpl} did not validate: {:?}",
			crate::vpl::validate(&document)
		);

		let runtime = versatiles::runtime::create_runtime();
		let source = crate::preview::build(&runtime, document.to_pipeline(), &dir).await?;
		let info = crate::analysis::describe(&source, "preview").await?;

		assert_eq!(info.tile_format, "png", "a raster import produces raster tiles");
		assert!(info.max_zoom >= info.min_zoom);
		let bbox = info.bbox.expect("a raster import should know where it is");
		assert!(
			(-180.0..=180.0).contains(&bbox[0]) && (-90.0..=90.0).contains(&bbox[1]),
			"the extent is not in degrees, so PROJ did not transform it: {bbox:?}"
		);
		Ok(())
	}

	/// No two kinds may claim the same extension, or which card a dropped file belongs to would
	/// depend on the order of this list.
	///
	/// Checked over [`CANDIDATES`] rather than over [`kinds`]: a kind whose operation this build
	/// lacks is filtered out of the latter, so a collision introduced alongside it would stay
	/// invisible until the day that operation arrived - which is the worst moment to find out.
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

/// The raster card's claim, checked against the only thing that can settle it.
///
/// `from_gdal_raster` reads whatever GDAL's registered drivers read, and which drivers those are is
/// a decision *this repository* makes in `Cargo.toml` ([Q19](../../../docs/decisions.md), Q20) -
/// six `gdal-src` features, deliberately narrow. So the card and the driver list are two statements
/// of the same choice, made in two files, and this is what keeps them one choice.
///
/// It bites in both directions: dropping `driver_jpeg` to save binary size while the card still
/// offers `.jpg` fails here, and so does adding an extension nothing reads.
#[cfg(test)]
mod gdal_drivers {
	use super::*;
	use gdal::Metadata;

	/// Every extension GDAL says it can open, lowercase.
	///
	/// **No `register_all()`.** `count()` and `get_driver()` register through the crate's own
	/// `Once`; calling `register_all()` alongside them is a *second*, unguarded `GDALAllRegister`,
	/// and GDAL aborts the process when a driver name is registered twice from two objects -
	/// `CPLAssert(false)` in `gdaldrivermanager.cpp`. Two tests doing it concurrently is enough.
	fn readable() -> Vec<String> {
		(0..gdal::DriverManager::count())
			.filter_map(|index| gdal::DriverManager::get_driver(index).ok())
			.filter_map(|driver| driver.metadata_item("DMD_EXTENSIONS", ""))
			.flat_map(|list| list.split_whitespace().map(str::to_lowercase).collect::<Vec<_>>())
			.collect()
	}

	#[test]
	fn gdal_reads_every_extension_the_raster_card_claims() {
		let Some(kind) = kinds().into_iter().find(|kind| kind.id == "raster") else {
			// No GDAL in this build, so no card - which is [Q28]'s promise, tested elsewhere.
			return;
		};
		let readable = readable();
		for extension in &kind.extensions {
			assert!(
				readable.contains(extension),
				"the raster card offers .{extension}, which no linked driver reads: {readable:?}"
			);
		}
	}

	/// The drivers [Q19](../../../docs/decisions.md) settled on, and no others - a driver arriving
	/// by accident is binary size nobody asked for.
	#[test]
	fn the_driver_set_is_the_one_that_was_chosen() {
		let mut names: Vec<String> = (0..gdal::DriverManager::count())
			.filter_map(|index| gdal::DriverManager::get_driver(index).ok())
			.map(|driver| driver.short_name())
			.collect();
		names.sort();
		assert_eq!(
			names,
			[
				"COG",
				"GNMDatabase",
				"GNMFile",
				"GTiff",
				"JPEG",
				"MEM",
				"OGR_VRT",
				"PNG",
				"VRT"
			],
			"the linked driver set changed"
		);
	}
}
