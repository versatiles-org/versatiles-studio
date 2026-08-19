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
use std::io::Cursor;
use std::path::Path;
use versatiles_core::utils::read_csv_iter;

/// Delimiters worth trying, in the order they are preferred on a tie.
///
/// A comma first because that is what the format is named after and what `from_csv` assumes;
/// semicolon next because it is what a spreadsheet exports in locales where the comma is the
/// decimal separator, which is the case that otherwise yields one enormous column.
const DELIMITERS: [char; 4] = [',', ';', '\t', '|'];

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
pub fn columns(path: &Path) -> Result<Columns> {
	// Read once, then answer both questions from the same bytes. Opening the file a second time to
	// parse what was just measured would let the two disagree if it changed in between, and there is
	// nothing in the second read that the first did not already have.
	let record = first_record(path)?;
	let delimiter = sniff(&record);
	let names = header(&record, delimiter)?;
	anyhow::ensure!(!names.is_empty(), "{} has no header row", path.display());

	Ok(Columns {
		lon: guess(&names, &LON_NAMES),
		lat: guess(&names, &LAT_NAMES),
		delimiter: delimiter.to_string(),
		names,
	})
}

/// The delimiter that splits the header into the most fields.
///
/// A file's real delimiter always yields more columns than a character that does not appear in it,
/// which yields exactly one. Ties go to the earlier entry in [`DELIMITERS`], so a file with no
/// delimiter at all is reported as a one-column CSV rather than as a pipe-separated anything.
///
/// **Counted rather than parsed.** Asking the parser to read the header once per candidate is the
/// obvious way and cannot be done: a quoted field followed by anything but the candidate separator
/// panics inside `read_csv_iter` rather than failing
/// ([vt#238](https://github.com/versatiles-org/versatiles-rs/issues/238)) — and trying separators a
/// file does not use is precisely what sniffing is. Counting is also the cheaper answer, since the
/// file is read once instead of once per candidate.
fn sniff(record: &str) -> char {
	let mut best = (DELIMITERS[0], 0);
	for delimiter in DELIMITERS {
		let count = separators(record, delimiter);
		if count > best.1 {
			best = (delimiter, count);
		}
	}
	best.0
}

/// How often `delimiter` separates fields — occurrences inside a quoted field do not count.
///
/// `""` inside a quoted field is an escaped quote, and toggling twice leaves the state it found,
/// so it needs no case of its own.
fn separators(record: &str, delimiter: char) -> usize {
	let mut quoted = false;
	record
		.chars()
		.filter(|&c| {
			if c == '"' {
				quoted = !quoted;
			}
			c == delimiter && !quoted
		})
		.count()
}

/// The first record's raw text: up to the first newline that is not inside a quoted field.
///
/// Bounded, because this only ever needs a header: a file whose first record does not arrive in
/// 64 KiB is not one whose columns anybody is about to pick from a list.
fn first_record(path: &Path) -> Result<String> {
	use std::io::Read;

	let mut head = vec![0; 64 * 1024];
	let mut file = std::fs::File::open(path).with_context(|| format!("opening {}", path.display()))?;
	let read = file
		.read(&mut head)
		.with_context(|| format!("reading {}", path.display()))?;
	head.truncate(read);

	let text = String::from_utf8_lossy(&head);
	let mut quoted = false;
	let end = text
		.char_indices()
		.find(|&(_, c)| {
			if c == '"' {
				quoted = !quoted;
			}
			c == '\n' && !quoted
		})
		.map_or(text.len(), |(index, _)| index);

	Ok(text[..end].trim_end_matches('\r').to_string())
}

/// Reads the first row, with **the same reader the pipeline will use**.
///
/// `from_csv` reads the file through `versatiles_core`'s CSV utilities, so anything else parsing it
/// here would be a second reading of one file: a form could offer a column the pipeline then cannot
/// find, over nothing worse than a disagreement about quoting. Asked upstream as
/// [vt#237](https://github.com/versatiles-org/versatiles-rs/issues/237) to expose the header
/// question itself, which is the half that is still ours.
///
/// A ragged file is still worth a header. `read_csv_iter` refuses a row whose field count differs
/// from the first — but that is a row this never asks for, because it stops after one.
fn header(record: &str, delimiter: char) -> Result<Vec<String>> {
	let mut rows = read_csv_iter(Cursor::new(record.as_bytes()), delimiter as u8).context("parsing the header row")?;

	let Some(first) = rows.next() else {
		return Ok(Vec::new());
	};
	let (names, _, _) = first.context("parsing the header row")?;

	Ok(names.into_iter().map(|name| name.trim().to_string()).collect())
}

/// The first column whose name is one of `candidates`, preferring earlier candidates.
///
/// Candidate order wins over column order: a file with both `long` and `longitude` means the second
/// one, whichever comes first in the file.
fn guess(names: &[String], candidates: &[&str]) -> Option<String> {
	candidates.iter().find_map(|candidate| {
		names
			.iter()
			.find(|name| name.to_lowercase() == *candidate)
			.map(ToString::to_string)
	})
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::io::Write;

	fn write(name: &str, content: &str) -> std::path::PathBuf {
		let path = std::env::temp_dir().join(format!("versatiles-studio-{name}"));
		let mut file = std::fs::File::create(&path).unwrap();
		file.write_all(content.as_bytes()).unwrap();
		path
	}

	#[test]
	fn a_comma_separated_header_becomes_its_columns() {
		let path = write("plain.csv", "id,longitude,latitude,name\n1,13.4,52.5,Berlin\n");
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
		let path = write("euro.csv", "id;lon;lat\n1;13,4;52,5\n");
		let columns = columns(&path).unwrap();
		assert_eq!(columns.names, ["id", "lon", "lat"]);
		assert_eq!(columns.delimiter, ";");
	}

	#[test]
	fn a_tab_separated_file_is_recognised() {
		let path = write("tabs.csv", "id\tlon\tlat\n1\t13.4\t52.5\n");
		assert_eq!(columns(&path).unwrap().delimiter, "\t");
	}

	/// The case that made counting necessary: with `;` as a candidate, a quoted field followed by a
	/// comma used to reach `read_csv_iter`, which panics rather than failing on it (vt#238).
	#[test]
	fn a_delimiter_inside_quotes_does_not_count_as_one() {
		assert_eq!(separators("\"name, formal\",lon,lat", ','), 2);
		assert_eq!(separators("\"name, formal\",lon,lat", ';'), 0);
		// `""` is an escaped quote: toggling twice leaves the state it found.
		assert_eq!(separators("\"a\"\"b,c\",d", ','), 1);
	}

	/// A quoted field may hold a newline, so the first *line* is not always the first record.
	#[test]
	fn a_newline_inside_quotes_does_not_end_the_record() {
		let path = write("multiline.csv", "\"name\nformal\",lon,lat\nBerlin,13.4,52.5\n");
		let columns = columns(&path).unwrap();
		assert_eq!(columns.names, ["name\nformal", "lon", "lat"]);
	}

	/// Why a real CSV reader rather than `split(',')`: the first address column with a comma in it.
	#[test]
	fn a_quoted_header_field_stays_one_column() {
		let path = write("quoted.csv", "\"name, formal\",lon,lat\nBerlin,13.4,52.5\n");
		let columns = columns(&path).unwrap();
		assert_eq!(columns.names, ["name, formal", "lon", "lat"]);
	}

	#[test]
	fn candidate_order_beats_column_order() {
		let path = write("both.csv", "long,longitude,lat\n1,2,3\n");
		assert_eq!(columns(&path).unwrap().lon.as_deref(), Some("longitude"));
	}

	#[test]
	fn matching_ignores_case_and_surrounding_space() {
		let path = write("shouty.csv", "ID, LON , LAT \n1,13.4,52.5\n");
		let columns = columns(&path).unwrap();
		assert_eq!(columns.names, ["ID", "LON", "LAT"]);
		assert_eq!(columns.lon.as_deref(), Some("LON"));
		assert_eq!(columns.lat.as_deref(), Some("LAT"));
	}

	/// A guess fills in a required field, so a wrong one is worse than none. `x`/`y` are exactly
	/// the case where being wrong is plausible and invisible.
	#[test]
	fn nothing_is_guessed_from_ambiguous_names() {
		let path = write("xy.csv", "id,x,y\n1,392000,5820000\n");
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
