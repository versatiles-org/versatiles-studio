//! Reading a delimited file's header, so its columns can be offered rather than typed (S3.4, E2).
//!
//! [Q29](../../docs/decisions.md) answered the same question for vector data by probing what the
//! pipeline *produces*. That does not work here, and the reason is the whole shape of this module:
//! `from_csv` cannot build at all until it has been told which columns hold the coordinates, so
//! there is no output to look at. A CSV is the one import where the question has to be asked of the
//! input.
//!
//! Which is why guessing matters. The columns are almost always called something obvious, and an
//! import that fills them in and simply works is a different experience from one that opens a form
//! with two required fields and no clue what goes in them.

use anyhow::{Context, Result};
use serde::Serialize;
use std::path::Path;
use versatiles_core::utils::read_csv_header;

/// What a delimited file's first line says about it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Columns {
	/// Header names, in file order.
	pub names: Vec<String>,
	/// The delimiter that produced them, as a one-character string.
	///
	/// Reported so the node can record it: `from_csv` defaults to `,`, and a file that needed
	/// anything else has to say so or it will be read as a single column.
	pub delimiter: String,
	/// The column that looks like a longitude, if one obviously does.
	pub lon: Option<String>,
	pub lat: Option<String>,
}

/// Names that mean longitude, most specific first. Matched case-insensitively and whole.
///
/// **Not `x` and `y`.** They are longitude and latitude often enough to be tempting and something
/// else — projected metres, a grid index, a plain unrelated column — often enough that guessing
/// would sometimes silently produce a map of somewhere that does not exist. A guess here fills in a
/// required field, so a wrong one is worse than none: it turns "Studio is asking me something" into
/// "Studio is wrong and I have to work out why".
const LON_NAMES: [&str; 6] = ["longitude", "lon", "lng", "long", "lon_deg", "x_wgs84"];
const LAT_NAMES: [&str; 5] = ["latitude", "lat", "lat_deg", "y_wgs84", "lattitude"];

/// Reads the header of a delimited file, sniffing the delimiter.
///
/// Only the first record is read, so this costs the same on a 4 GB file as on a small one.
///
/// **The reading and the sniffing are upstream's** ([vt#237], [vt#238]). Studio used to do both,
/// counting separators outside quotes rather than parsing them, because a wrong candidate panicked
/// inside `read_csv_iter` instead of failing. Both are fixed, and `read_csv_header` uses the same
/// parser `from_csv` will — which is the property that matters here, since a column this offers and
/// a column that operation finds have to be the same column. What stays is the part that is Studio's
/// own: guessing which of them hold the coordinates.
///
/// [vt#237]: https://github.com/versatiles-org/versatiles-rs/issues/237
/// [vt#238]: https://github.com/versatiles-org/versatiles-rs/issues/238
pub fn columns(path: &Path) -> Result<Columns> {
	let header = read_csv_header(path, None).with_context(|| format!("reading {}", path.display()))?;
	anyhow::ensure!(!header.columns.is_empty(), "{} has no header row", path.display());

	Ok(Columns {
		lon: guess(&header.columns, &LON_NAMES),
		lat: guess(&header.columns, &LAT_NAMES),
		delimiter: (header.separator as char).to_string(),
		names: header.columns,
	})
}

/// The first column whose name is one of `candidates`, preferring earlier candidates.
///
/// Candidate order wins over column order: a file with both `long` and `longitude` means the second
/// one, whichever comes first in the file.
fn guess(names: &[String], candidates: &[&str]) -> Option<String> {
	candidates.iter().find_map(|candidate| {
		names
			.iter()
			// Trimmed for the comparison and **not** for the answer. `a, lon` has a column called
			// ` lon`, and that is the name `from_csv` will look up — offering `lon` instead would
			// name a column the operation cannot find. Matching has to be forgiving about the space
			// so the guess still works; reporting must not be.
			.find(|name| name.trim().to_lowercase() == *candidate)
			.map(ToString::to_string)
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_comma_separated_header_becomes_its_columns() {
		let path = crate::testing::file("plain.csv", "id,longitude,latitude,name\n1,13.4,52.5,Berlin\n");
		let columns = columns(&path).unwrap();
		assert_eq!(columns.names, ["id", "longitude", "latitude", "name"]);
		assert_eq!(columns.delimiter, ",");
		assert_eq!(columns.lon.as_deref(), Some("longitude"));
		assert_eq!(columns.lat.as_deref(), Some("latitude"));
	}

	/// The case the sniffing exists for: a spreadsheet exported where the comma is the decimal
	/// separator. Split on `,` this is one column, and `from_csv` would read it as such.
	#[test]
	fn a_semicolon_file_is_not_read_as_one_column() {
		let path = crate::testing::file("euro.csv", "id;lon;lat\n1;13,4;52,5\n");
		let columns = columns(&path).unwrap();
		assert_eq!(columns.names, ["id", "lon", "lat"]);
		assert_eq!(columns.delimiter, ";");
	}

	#[test]
	fn a_tab_separated_file_is_recognised() {
		let path = crate::testing::file("tabs.csv", "id\tlon\tlat\n1\t13.4\t52.5\n");
		assert_eq!(columns(&path).unwrap().delimiter, "\t");
	}

	/// The case that used to need a hand-written sniffer: a comma inside a quoted field is not a
	/// separator, and reaching `read_csv_iter` with the wrong candidate panicked rather than failing
	/// (vt#238). Asserted through `columns` rather than through an internal, because it is now
	/// upstream's answer and this is the contract Studio depends on.
	#[test]
	fn a_delimiter_inside_quotes_does_not_count_as_one() {
		let path = crate::testing::file("quoted.csv", "\"name, formal\",lon,lat\nBerlin,13.4,52.5\n");
		let found = columns(&path).unwrap();
		assert_eq!(found.delimiter, ",");
		assert_eq!(found.names, ["name, formal", "lon", "lat"]);
	}

	/// `""` inside a quoted field is an escaped quote, not the end of it.
	#[test]
	fn an_escaped_quote_does_not_end_the_field() {
		let path = crate::testing::file("escaped.csv", "\"a\"\"b,c\",lon,lat\n1,2,3\n");
		assert_eq!(columns(&path).unwrap().names, ["a\"b,c", "lon", "lat"]);
	}

	/// A quoted field may hold a newline, so the first *line* is not always the first record.
	#[test]
	fn a_newline_inside_quotes_does_not_end_the_record() {
		let path = crate::testing::file("multiline.csv", "\"name\nformal\",lon,lat\nBerlin,13.4,52.5\n");
		let columns = columns(&path).unwrap();
		assert_eq!(columns.names, ["name\nformal", "lon", "lat"]);
	}

	/// Why a real CSV reader rather than `split(',')`: the first address column with a comma in it.
	#[test]
	fn a_quoted_header_field_stays_one_column() {
		let path = crate::testing::file("quoted.csv", "\"name, formal\",lon,lat\nBerlin,13.4,52.5\n");
		let columns = columns(&path).unwrap();
		assert_eq!(columns.names, ["name, formal", "lon", "lat"]);
	}

	#[test]
	fn candidate_order_beats_column_order() {
		let path = crate::testing::file("both.csv", "long,longitude,lat\n1,2,3\n");
		assert_eq!(columns(&path).unwrap().lon.as_deref(), Some("longitude"));
	}

	/// **Matching is forgiving about space; reporting is not.** `a, lon` has a column called ` lon`,
	/// and that is the name `from_csv` will look it up by — so the guess has to find it through the
	/// space while still answering with the name the operation needs. Studio's own reader used to
	/// trim, which offered a name that would not have been found.
	#[test]
	fn matching_ignores_case_and_surrounding_space() {
		let path = crate::testing::file("shouty.csv", "ID, LON , LAT \n1,13.4,52.5\n");
		let columns = columns(&path).unwrap();
		assert_eq!(columns.names, ["ID", " LON ", " LAT "]);
		assert_eq!(columns.lon.as_deref(), Some(" LON "));
		assert_eq!(columns.lat.as_deref(), Some(" LAT "));
	}

	/// A guess fills in a required field, so a wrong one is worse than none. `x`/`y` are exactly
	/// the case where being wrong is plausible and invisible.
	#[test]
	fn nothing_is_guessed_from_ambiguous_names() {
		let path = crate::testing::file("xy.csv", "id,x,y\n1,392000,5820000\n");
		let columns = columns(&path).unwrap();
		assert_eq!(columns.names, ["id", "x", "y"]);
		assert_eq!(columns.lon, None, "x is as often projected metres as a longitude");
		assert_eq!(columns.lat, None);
	}

	/// The real file the S3.2 card warns about, and the one E2 exists for.
	#[test]
	fn the_sample_data_is_read_the_way_the_card_promises() {
		let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../versatiles-rs/testdata");
		if !dir.exists() {
			eprintln!("skipping: set STUDIO_TESTDATA to a directory of sample containers");
			return;
		}

		let quakes = columns(&dir.join("quakes.csv")).unwrap();
		assert_eq!(quakes.lon.as_deref(), Some("longitude"));
		assert_eq!(quakes.lat.as_deref(), Some("latitude"));
		assert!(quakes.names.contains(&"magnitude".to_string()));

		// A table with no coordinates at all: the columns are still offered, and nothing is
		// guessed, which is what leaves the two required fields visibly waiting.
		let cities = columns(&dir.join("cities.csv")).unwrap();
		assert_eq!(cities.names, ["city_id", "city_name", "city_population"]);
		assert_eq!(cities.lon, None);
	}

	#[test]
	fn a_missing_file_is_an_error_naming_it() {
		let error = columns(Path::new("/nowhere/absent.csv")).unwrap_err();
		assert!(format!("{error:#}").contains("absent.csv"), "got {error:#}");
	}
}
