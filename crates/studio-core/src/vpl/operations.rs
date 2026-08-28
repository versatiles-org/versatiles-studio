//! What the operations are, in a shape a form can be built from (S2.6, C2).
//!
//! Upstream describes each parameter with a `rust_type` string - `Option<u8>`, `Option<[f64;4]>`,
//! `Vec<String>` - which is exactly right for a code generator and no use to a webview. Reading it
//! is a mapping decision, so it happens once here rather than in TypeScript: the browser receives a
//! control to render and never sees a Rust type.
//!
//! Everything else comes straight from the metadata, including each field's documentation, so a new
//! operation upstream appears in Studio's forms with no work here at all - which is the point of
//! generating them ([architecture](../../../docs/architecture.md)).

use super::semantics::{Role, role_of};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::OnceLock;
use versatiles_pipeline::{OperationMeta, all_operation_metadata};

/// Operations by name, built once. `all_operation_metadata()` walks every factory on each call.
pub fn registry() -> &'static HashMap<String, OperationMeta> {
	static OPERATIONS: OnceLock<HashMap<String, OperationMeta>> = OnceLock::new();
	OPERATIONS.get_or_init(|| {
		all_operation_metadata()
			.into_iter()
			.map(|meta| (meta.tag_name.clone(), meta))
			.collect()
	})
}

/// The control a parameter should be edited with.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub enum Control {
	Text,
	/// Exactly one character.
	///
	/// `SeparatorChar` and `CsvDelimiter` refuse a second one where the value is decoded rather than
	/// when the file is read ([vt#257]), so a box that takes a word offers something the operation
	/// will reject. Studio has called these fields `Char` in [`semantics`] since before upstream had
	/// a type for them; 4.11 is where the type caught up and the control became worth drawing.
	///
	/// [vt#257]: https://github.com/versatiles-org/versatiles-rs/issues/257
	Char,
	/// A file this machine has: edited as text, and with a file picker beside it.
	///
	/// **Not a `rust_type`.** Upstream spells every one of these `String` or `Option<String>`,
	/// because VPL stores a path as text and so does everything downstream of it. What makes a
	/// path a path is what the operation *does* with it, which only the parameter's name says -
	/// so this is the one control decided by name rather than by type. See [`is_path`].
	Path,
	/// `min`/`max` come from the integer width, so a zoom level cannot be set to 300.
	Number {
		integer: bool,
		#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
		min: Option<f64>,
		#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
		max: Option<f64>,
	},
	Boolean,
	/// An enum, with every accepted spelling.
	Choice {
		options: Vec<String>,
	},
	/// `Vec<String>` - a list of values, written as a VPL array.
	List,
	/// A fixed-size numeric array: a bbox is four, a colour or a centre three.
	Numbers {
		#[cfg_attr(feature = "bindings", specta(type = u32))]
		count: usize,
	},
	/// A colour, in whichever way the operation spells one.
	///
	/// **Two spellings, one control.** `from_color` takes `RRGGBB` or `RRGGBBAA` as a string, with no
	/// leading `#`; `raster_flatten` takes `[r, g, b]`. Both are a colour to the person picking one,
	/// and a swatch is the only control that says so - a hex field is a thing to get wrong, and three
	/// numbers do not look like a colour at all.
	Color {
		/// Written as hex digits rather than as three numbers. Alpha survives a pick either way: a
		/// native colour input has none, so an `AA` already there is kept.
		hex: bool,
	},
	/// `[west, south, east, north]` in WGS84 degrees - a rectangle the map can draw and a drag can
	/// fill in.
	///
	/// Four numbers by shape, like a colour is three, and a form that only knew the shape offered
	/// the same bare row of numbers for both. The map already draws rectangles - it is how a crop is
	/// set - so the one field where that machinery is the obvious answer had no way to reach it.
	Bbox,
}

/// Whether a parameter names a file on this machine.
///
/// **By name, because nothing else says so.** Every one of these is a `String` upstream, and their
/// documentation says it in prose or not at all - `filter`'s `filename` and `from_container`'s
/// `ssh_identity` never use the word. So the names are listed, and `path_fields_are_all_named`
/// holds the list against the whole registry rather than trusting it.
///
/// The suffixes are the general rule and the four names are what upstream calls the rest: a
/// `cutline` is a GeoJSON file GDAL clips against (`cutline_path` by the time it reaches GDAL), an
/// `ssh_identity` is a private key file, and `raster_mask`'s `geojson` is the polygon to mask with.
///
/// A URL is not one of these: `from_tilejson`'s `url` is somewhere else entirely, and a picker
/// offering the local disk for it would be answering the wrong question.
fn is_path(name: &str) -> bool {
	matches!(name, "filename" | "geojson" | "cutline" | "ssh_identity")
		|| name.ends_with("_file")
		|| name.ends_with("_path")
}

/// Reads a `rust_type` into the control that fits it.
///
/// Unknown types fall back to text rather than failing. A parameter upstream adds in a shape we do
/// not recognise should still be editable - as the string it is written as, which is what VPL
/// stores anyway.
fn control_for(operation: &str, name: &str, rust_type: &str, enum_variants: &[&'static str]) -> Control {
	if !enum_variants.is_empty() {
		return Control::Choice {
			options: enum_variants.iter().map(|v| (*v).to_string()).collect(),
		};
	}

	let inner = rust_type
		.strip_prefix("Option<")
		.and_then(|rest| rest.strip_suffix('>'))
		.unwrap_or(rust_type);

	if inner == "bool" {
		return Control::Boolean;
	}
	if inner == "Vec<String>" {
		return Control::List;
	}

	// **What upstream says outright, before what Studio guesses.** 4.11 gave several fields a type of
	// their own - a `GeoBBox` rather than `[f64;4]`, a `HexColor` rather than a `String` ([vt#257]) -
	// and a named type is stronger evidence than anything below can reconstruct. Read ahead of
	// `role_of` for exactly that reason: the table is a guess about upstream maintained here, and
	// these are upstream saying it.
	//
	// [vt#257]: https://github.com/versatiles-org/versatiles-rs/issues/257
	match inner {
		"GeoBBox" => return Control::Bbox,
		"HexColor" => return Control::Color { hex: true },
		"SeparatorChar" | "CsvDelimiter" => return Control::Char,
		_ => {}
	}

	let role = role_of(operation, name);

	if let Some(count) = fixed_array_len(inner) {
		// Three numbers are a colour when the table says so, and a colour is not three numbers to
		// anyone choosing one.
		if count == 3 && role == Some(Role::Color) {
			return Control::Color { hex: false };
		}
		// No rectangle rule here any more. Every bbox was `[f64;4]` and had to be told apart from any
		// other four numbers by the curated table; 4.11 made them all `GeoBBox`, which the match above
		// reads. A four-array reaching this point is now genuinely four numbers.
		return Control::Numbers { count };
	}

	// **A set, not a range.** `tile_size` is a `u32` by type and "`256` or `512`" by meaning, so the
	// type alone offers a box that accepts 400 and an operation that then refuses it. The set is in
	// `semantics.rs` and, like the rectangles, nothing had ever read it - the two spellings of "this
	// field has a short list of answers" were a Rust enum, which arrives in `enum_variants` above,
	// and a documented list on a plain number, which arrived nowhere.
	if role == Some(Role::Color) && inner == "String" {
		return Control::Color { hex: true };
	}

	if let Some(Role::Choice(options)) = role {
		return Control::Choice {
			options: options.iter().map(|option| (*option).to_string()).collect(),
		};
	}
	// Checked after the shapes above rather than first: a name is the weakest evidence here, and a
	// parameter that upstream types as a number or an enum is that whatever it is called.
	if is_path(name) {
		return Control::Path;
	}

	match inner {
		"u8" => number(true, 0.0, f64::from(u8::MAX)),
		"u16" => number(true, 0.0, f64::from(u16::MAX)),
		"u32" => number(true, 0.0, f64::from(u32::MAX)),
		"u64" | "usize" => Control::Number {
			integer: true,
			min: Some(0.0),
			max: None,
		},
		"i8" | "i16" | "i32" | "i64" | "isize" => Control::Number {
			integer: true,
			min: None,
			max: None,
		},
		"f32" | "f64" => Control::Number {
			integer: false,
			min: None,
			max: None,
		},
		_ => Control::Text,
	}
}

fn number(integer: bool, min: f64, max: f64) -> Control {
	Control::Number {
		integer,
		min: Some(min),
		max: Some(max),
	}
}

/// `[f64;4]` → 4. Only numeric element types count; anything else is left as text.
fn fixed_array_len(inner: &str) -> Option<usize> {
	let body = inner.strip_prefix('[')?.strip_suffix(']')?;
	let (element, count) = body.split_once(';')?;
	matches!(element.trim(), "f32" | "f64" | "u8" | "u16" | "u32" | "i32").then_some(())?;
	count.trim().parse().ok()
}

/// One parameter of an operation, ready to render.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct FieldInfo {
	pub name: String,
	/// Upstream's own documentation for the parameter.
	pub doc: String,
	pub required: bool,
	/// Fed by a `[ … ]` block rather than by a `key=value` pair, so it has no control.
	pub sources: bool,
	pub control: Control,
	/// What the operation does when this parameter is absent, spelled as VPL would write it
	/// ([vt#253]). `None` when there is no literal to show.
	///
	/// **Shown, never filled in.** An empty box for `from_color`'s `color` and an empty box for
	/// `from_csv`'s `lon_column` used to look identical, and one of them means `000000` while the
	/// other means the pipeline will not build. Writing the default into the document instead would
	/// turn every form into a wall of restated defaults and freeze today's value into a file that
	/// should follow whatever the operation does next.
	///
	/// `None` is not "required": an optional parameter with no default is one whose absence *does*
	/// something - `filter`'s `bbox` clips nothing at all when unset - and a form has nothing to
	/// say about those.
	///
	/// [vt#253]: https://github.com/versatiles-org/versatiles-rs/issues/253
	pub default: Option<String>,
}

/// One operation, ready to render.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct OperationInfo {
	pub name: String,
	/// `read` or `transform` - which end of a pipeline it belongs at.
	pub kind: String,
	/// What it does, in a sentence.
	pub summary: String,
	/// Everything else upstream has to say, minus the parameter list - that is `fields`, and
	/// sending it twice is what [vt#229] was about. Empty when the summary is the whole of it.
	///
	/// [vt#229]: https://github.com/versatiles-org/versatiles-rs/issues/229
	pub details: String,
	pub fields: Vec<FieldInfo>,
}

/// Every operation, sorted by name.
#[must_use]
pub fn operations() -> Vec<OperationInfo> {
	let mut all: Vec<OperationInfo> = registry()
		.values()
		.map(|meta| OperationInfo {
			name: meta.tag_name.clone(),
			kind: meta.kind.to_string(),
			summary: meta.summary.clone(),
			details: meta.details.clone(),
			fields: meta
				.fields
				.iter()
				.map(|field| FieldInfo {
					name: field.name.clone(),
					doc: field.doc.clone(),
					required: field.is_required,
					sources: field.is_sources,
					control: control_for(&meta.tag_name, &field.name, &field.rust_type, &field.enum_variants),
					default: field.default.clone(),
				})
				.collect(),
		})
		.collect();
	all.sort_by(|a, b| a.name.cmp(&b.name));
	all
}

#[cfg(test)]
mod tests {
	use super::*;

	fn field(operation: &str, name: &str) -> FieldInfo {
		operations()
			.into_iter()
			.find(|op| op.name == operation)
			.unwrap_or_else(|| panic!("no operation {operation}"))
			.fields
			.into_iter()
			.find(|f| f.name == name)
			.unwrap_or_else(|| panic!("{operation} has no field {name}"))
	}

	#[test]
	fn an_enum_becomes_a_choice_of_its_own_variants() {
		let Control::Choice { options } = field("from_debug", "format").control else {
			panic!("format should be a choice");
		};
		assert!(options.contains(&"png".to_string()), "{options:?}");
		assert!(options.contains(&"mvt".to_string()), "{options:?}");
	}

	/// Every path in the registry, as `operation.field`.
	fn paths() -> Vec<String> {
		operations()
			.into_iter()
			.flat_map(|op| {
				op.fields
					.into_iter()
					.filter(|f| f.control == Control::Path)
					.map(move |f| format!("{}.{}", op.name, f.name))
			})
			.collect()
	}

	/// **The list, held against the registry.** `is_path` decides by name, which is a guess that
	/// goes stale the moment upstream adds a parameter - and the failure is silent: a field that
	/// names a file, with no picker beside it, looks exactly like one that does not.
	///
	/// So the whole set is written out. An operation added upstream fails this and someone decides
	/// which it is, which is the only moment anyone can.
	#[test]
	fn path_fields_are_all_named() {
		let mut found = paths();
		found.sort();
		assert_eq!(
			found,
			[
				"filter.filename",
				"from_container.filename",
				"from_container.ssh_identity",
				"from_csv.filename",
				"from_gdal_dem.cutline",
				"from_gdal_dem.filename",
				"from_gdal_raster.cutline",
				"from_gdal_raster.filename",
				"from_geo.filename",
				"from_tile.filename",
				"meta_update.tilejson_file",
				"meta_update.tilejson_update_file",
				"meta_update.vector_layers_file",
				"raster_mask.geojson",
				"vector_update_properties.data_source_path",
			]
		);
	}

	/// The half of the list that says so out loud, checked against what upstream wrote rather than
	/// against a name: `raster_mask`'s `geojson` was missed exactly this way, and its documentation
	/// had said "Path to a GeoJSON file" all along.
	#[test]
	fn a_field_documented_as_a_path_is_one() {
		for operation in operations() {
			for field in operation.fields {
				if field.doc.starts_with("Path to") {
					assert_eq!(
						field.control,
						Control::Path,
						"{}.{} says {:?}",
						operation.name,
						field.name,
						field.doc
					);
				}
			}
		}
	}

	/// What a field's type is once `Option<…>` is off it, which is what the rules below read.
	fn inner_type(rust_type: &str) -> &str {
		rust_type
			.strip_prefix("Option<")
			.and_then(|rest| rest.strip_suffix('>'))
			.unwrap_or(rust_type)
	}

	/// **Three bytes are a colour, whatever the field is called.**
	///
	/// `every_colour_in_the_registry_is_a_swatch` holds the table against itself - it checks that each
	/// field `ROLES` *calls* a colour is offered as one, which by construction cannot see a colour the
	/// table has never heard of. The rectangles escaped that by matching the field's **name**; a colour
	/// has no name to match on, because `color`, `background`, `fill` and `tint` are all plausible and
	/// none is canonical.
	///
	/// It has a shape instead. `[u8;3]` is three channels of `0..=255`, and nothing in this registry
	/// spells anything else that way. `[f64;3]` is deliberately not included: `meta_update.center` is
	/// `[lon, lat, zoom]`, three numbers that are emphatically not a colour - which is why this is a
	/// rule about one exact type rather than about "three of something".
	#[test]
	fn three_bytes_are_a_colour_whatever_the_field_is_called() {
		let missed: Vec<String> = registry()
			.values()
			.flat_map(|meta| {
				meta.fields.iter().filter_map(move |field| {
					let is_three_bytes = inner_type(&field.rust_type).replace(' ', "") == "[u8;3]";
					let control = control_for(&meta.tag_name, &field.name, &field.rust_type, &field.enum_variants);
					(is_three_bytes && !matches!(control, Control::Color { .. }))
						.then(|| format!("{}.{}", meta.tag_name, field.name))
				})
			})
			.collect();

		assert!(
			missed.is_empty(),
			"three bytes is a colour and these are offered as bare numbers - add them to `ROLES` in \
			 semantics.rs: {missed:?}"
		);
	}

	/// Whether upstream's own words say the value *is* a colour.
	///
	/// **Anchored at the opening, like `a_field_documented_as_a_path_is_one`, and for the same
	/// reason.** `from_gdal_raster.bands` is documented as "Band indices to read as colour channels",
	/// where the word describes what the indices point at rather than what the value is - so anything
	/// reading the whole sentence calls that field a colour, and a rule that cries wolf on the only
	/// registry it has is worse than no rule. A doc names its own value in its opening words, which is
	/// where `from_color`'s "Hex colour, `RRGGBB` or `RRGGBBAA`" says it; two is enough for the
	/// article or adjective that usually comes first.
	fn doc_opens_on_a_colour(doc: &str) -> bool {
		doc.split_whitespace().take(2).any(|word| {
			let word = word.trim_matches(|c: char| !c.is_alphanumeric()).to_ascii_lowercase();
			word == "colour" || word == "color"
		})
	}

	/// Six or eight hex digits, which is what a colour written as text looks like and, in this
	/// registry, what nothing else does - every other string default is `,` `.` `id` `x` `y` `grid`
	/// or `h3`.
	fn is_hex_colour(value: &str) -> bool {
		let digits = value.trim_start_matches('#');
		matches!(digits.len(), 6 | 8) && digits.chars().all(|c| c.is_ascii_hexdigit())
	}

	/// **A colour spelled as a string, which no shape can see.**
	///
	/// `three_bytes_are_a_colour_whatever_the_field_is_called` reads the type, and that works because
	/// `[u8;3]` means one thing. The other spelling is `String`, which means everything: a name, a
	/// path, a CEL expression and `from_color`'s `RRGGBBAA` are one type upstream. So the type says
	/// nothing, and a colour added that way would render as a plain box with nothing able to notice.
	///
	/// What is left is what upstream wrote. Two signals, either one enough, because they fail in
	/// different directions - a colour with no default still has prose, and prose worded some way
	/// this does not expect still has `000000` - so a new one would have to dodge both to arrive
	/// silently.
	#[test]
	fn a_string_that_says_it_is_a_colour_is_a_swatch() {
		let missed: Vec<String> = registry()
			.values()
			.flat_map(|meta| {
				meta.fields.iter().filter_map(move |field| {
					let says_colour = inner_type(&field.rust_type) == "String"
						&& (doc_opens_on_a_colour(&field.doc) || field.default.as_deref().is_some_and(is_hex_colour));
					let control = control_for(&meta.tag_name, &field.name, &field.rust_type, &field.enum_variants);
					(says_colour && !matches!(control, Control::Color { .. }))
						.then(|| format!("{}.{}", meta.tag_name, field.name))
				})
			})
			.collect();

		assert!(
			missed.is_empty(),
			"upstream documents these as colours and they are offered as text boxes - add them to \
			 `ROLES` in semantics.rs: {missed:?}"
		);
	}

	/// **The anchor above is load-bearing**, so it is held here rather than left as a remark for the
	/// next person to relax. `from_gdal_raster.bands` is a `String` whose documentation contains the
	/// word "colour"; widening the rule to search the whole sentence turns a band list into a swatch,
	/// which is a worse failure than the gap the rule closes.
	#[test]
	fn a_colour_further_into_the_sentence_describes_something_else() {
		let bands = field("from_gdal_raster", "bands");
		assert!(
			bands.doc.to_lowercase().contains("colour"),
			"the case this guards is gone: {:?}",
			bands.doc
		);
		assert!(!doc_opens_on_a_colour(&bands.doc), "{:?}", bands.doc);
		assert_eq!(bands.control, Control::Text);
	}

	/// **The named types 4.11 introduced, read as themselves.**
	///
	/// Each of these used to be inferred: a bbox was four numbers the curated table had to pick out
	/// from any other four, a hex colour was a `String` a doc-phrase rule had to recognise, and a
	/// separator was a `String` that accepted a whole word and failed later. Upstream gave all three a
	/// type ([vt#257]), so `control_for` reads the type and the guesses are gone.
	///
	/// Pinned as a test because "we read the type now" is invisible in the output - every one of these
	/// rendered as *something* before, and a regression would put them back to plausible-looking text
	/// boxes rather than to an error.
	///
	/// [vt#257]: https://github.com/versatiles-org/versatiles-rs/issues/257
	#[test]
	fn the_types_upstream_named_are_read_as_themselves() {
		assert_eq!(field("filter", "bbox").control, Control::Bbox);
		assert_eq!(field("meta_update", "bounds").control, Control::Bbox);
		assert_eq!(field("from_color", "color").control, Control::Color { hex: true });
		assert_eq!(field("from_csv", "delimiter").control, Control::Char);
		assert_eq!(
			field("vector_update_properties", "field_separator").control,
			Control::Char
		);
	}

	/// **A rectangle in some other coordinate system is not one this map can draw.**
	///
	/// `from_gdal_*`'s `bounds` is a `String` and, unlike every `GeoBBox`, is "in the units of `crs`" -
	/// so a dataset in EPSG:25832 has bounds in metres. Offering the map picker would put a WGS84
	/// rectangle into a field that means something else entirely, which is worse than a text box: the
	/// value would look deliberate.
	#[test]
	fn bounds_in_the_datasets_own_units_are_not_drawn_on_the_map() {
		for operation in ["from_gdal_dem", "from_gdal_raster"] {
			let bounds = field(operation, "bounds");
			assert!(bounds.doc.contains("units of `crs`"), "{operation}: {:?}", bounds.doc);
			assert_eq!(bounds.control, Control::Text, "{operation}");
		}
	}

	/// The pair a doc spells as `` `A` or `B` ``, when it spells one.
	fn alternation(doc: &str) -> Option<(&str, &str)> {
		let (before, after) = doc.split_once("` or `")?;
		Some((before.rsplit('`').next()?, after.split('`').next()?))
	}

	/// **Every tile size offers its set, including the two that never say what it is.**
	///
	/// `every_tabulated_set_is_a_selection` holds `ROLES` against itself: it checks that each field the
	/// table *calls* a set is offered as one, and so cannot see a set the table has never heard of.
	/// The obvious repair was to read the prose - `256` or `512` is right there in the documentation -
	/// and it does not work. Of the five tile sizes upstream, `from_gdal_dem` and `from_gdal_raster`
	/// document theirs as "Tile size in pixels. Defaults to `512`." and never name the alternative at
	/// all. A rule reading the set out of the sentence would have missed two of the five fields it
	/// exists for, and passed while doing it.
	///
	/// So it matches the phrase the five share rather than the values only three print. A tile size
	/// added upstream arrives documented like its siblings and fails this until someone tabulates it.
	///
	/// Where a doc *does* spell the set, it is held against the table too, so a `1024` upstream starts
	/// accepting is a failure here rather than a third option the form silently refuses to offer.
	#[test]
	fn every_tile_size_in_the_registry_offers_its_set() {
		let mut seen = 0;
		for operation in operations() {
			for field in operation.fields {
				if !field.doc.to_lowercase().contains("tile size in pixels") {
					continue;
				}
				seen += 1;
				let where_ = format!("{}.{}", operation.name, field.name);
				let Control::Choice { options } = &field.control else {
					panic!("{where_} is documented as a tile size and offers {:?}", field.control);
				};
				if let Some((a, b)) = alternation(&field.doc) {
					assert_eq!(
						options,
						&[a.to_string(), b.to_string()],
						"{where_} says {:?}",
						field.doc
					);
				}
			}
		}
		assert!(seen >= 5, "the tile sizes stopped being documented alike: found {seen}");
	}

	/// **The phrase is doing work a name could not**, so the case that proves it is held here.
	/// `from_grid.size` is an edge length in the CRS's own units - metres, or degrees - and any
	/// number is a legitimate answer. It is one of two fields upstream calls `size`; the other is
	/// `from_color`'s, which is a tile size and takes two values. Matching the name offers this one a
	/// choice of `256` or `512`, which is not a narrower version of the truth but a different field.
	#[test]
	fn a_cell_size_is_not_a_tile_size() {
		let cell = field("from_grid", "size");
		assert!(
			matches!(field("from_color", "size").control, Control::Choice { .. }),
			"the name collision this guards is gone"
		);
		assert!(
			!cell.doc.to_lowercase().contains("tile size in pixels"),
			"{:?}",
			cell.doc
		);
		assert!(matches!(cell.control, Control::Number { .. }), "{:?}", cell.control);
	}

	/// **Only a string may fall back to plain text**, because reaching the fallback means the type was
	/// not recognised.
	///
	/// `control_for` ends in `_ => Control::Text`, which is right for a name, a delimiter, a regex or
	/// a CEL expression - and is what a field of any *other* type gets when upstream introduces one
	/// this does not know. That is a byte count or a bounded number rendered as a free-text box, with
	/// nothing failing and nothing said: the same silent shape the rectangles, the colours and the
	/// documented sets each have a tripwire for, and the one they left uncovered.
	///
	/// Written without a list of the fields that *are* text - there are thirty-odd and they change
	/// with every upstream release - so what this holds is the rule rather than a copy of the answer.
	///
	/// Two types are exempt, and both are decisions rather than oversights. `MaxTileBytes` takes a
	/// byte count *or* the word `none`, so a number control could not express half of what it accepts.
	/// `QualityByZoom` is a whole per-zoom curve written as one string - `0-10:80,11-14:90` - which is
	/// a small language, not a value. Neither has an honest control today, and a text box that says so
	/// beats a number box that quietly refuses half the input. A per-zoom quality editor is a real
	/// feature; when it exists, `QualityByZoom` comes off this list.
	#[test]
	fn only_a_string_falls_back_to_text() {
		const KNOWN_TEXT_TYPES: &[&str] = &["String", "MaxTileBytes", "QualityByZoom"];

		let unrecognised: Vec<String> = registry()
			.values()
			.flat_map(|meta| {
				meta.fields.iter().filter_map(move |field| {
					let inner = inner_type(&field.rust_type);
					let text =
						control_for(&meta.tag_name, &field.name, &field.rust_type, &field.enum_variants) == Control::Text;
					(text && !field.is_sources && !KNOWN_TEXT_TYPES.contains(&inner))
						.then(|| format!("{}.{} :: {}", meta.tag_name, field.name, field.rust_type))
				})
			})
			.collect();

		assert!(
			unrecognised.is_empty(),
			"these reached the text fallback because `control_for` does not know their type - give \
			 them a control, or add the type to KNOWN_TEXT_TYPES with the reason text is right: \
			 {unrecognised:?}"
		);
	}

	/// A URL is somewhere else, and a picker offering the local disk for it answers the wrong
	/// question.
	#[test]
	fn a_url_is_not_a_path() {
		assert_eq!(field("from_tilejson", "url").control, Control::Text);
	}

	/// The bound is the point: a zoom level is a `u8`, so the control cannot offer 300.
	#[test]
	fn an_integer_carries_the_range_of_its_type() {
		assert_eq!(
			field("from_csv", "min_zoom").control,
			Control::Number {
				integer: true,
				min: Some(0.0),
				max: Some(255.0)
			}
		);
	}

	#[test]
	fn a_float_is_a_number_without_bounds() {
		assert_eq!(
			field("dem_quantize", "elevation_error").control,
			Control::Number {
				integer: false,
				min: None,
				max: None
			}
		);
	}

	/// **The tripwire for the table.** `role_of` is a curated list and the registry is not - a new
	/// operation arrives carrying a rectangle, nobody adds it, and the form quietly offers four bare
	/// numbers where every other rectangle offers the map. Held the same way
	/// `path_fields_are_all_named` holds the path list: against the whole registry rather than
	/// against a memory of it.
	///
	/// By name here, because a name is the only evidence available *before* somebody writes the
	/// table entry - which is the case being guarded against. `bounds` as well as `bbox`:
	/// `meta_update` spells it the other way, which this test is how we found out.
	#[test]
	fn every_rectangle_in_the_registry_can_be_drawn() {
		let missed: Vec<String> = operations()
			.iter()
			.flat_map(|operation| {
				operation
					.fields
					.iter()
					.filter(|field| matches!(field.name.as_str(), "bbox" | "bounds") && field.control != Control::Bbox)
					.map(|field| format!("{}.{}", operation.name, field.name))
			})
			.collect();
		assert!(missed.is_empty(), "add these to `ROLES` in semantics.rs: {missed:?}");
	}

	/// **Every documented set is offered as one.** `semantics.rs` is a curated table and the registry
	/// is not: an operation arrives with a field that takes two values out of a hundred, nobody adds
	/// it, and the form offers a number box that accepts all hundred. Held against the registry
	/// rather than against a memory of it, the same way the paths and the rectangles are.
	#[test]
	fn every_tabulated_set_is_a_selection() {
		let missed: Vec<String> = operations()
			.iter()
			.flat_map(|operation| {
				operation
					.fields
					.iter()
					.filter(|field| {
						matches!(role_of(&operation.name, &field.name), Some(Role::Choice(_)))
							&& !matches!(field.control, Control::Choice { .. })
					})
					.map(|field| format!("{}.{}", operation.name, field.name))
			})
			.collect();
		assert!(missed.is_empty(), "these should offer their set: {missed:?}");
	}

	/// The one that exists today, spelled out - so a change to the set is a change to this line.
	#[test]
	fn a_tile_size_is_offered_as_two_sizes_rather_than_a_number() {
		for operation in ["raster_tile_resize", "dem_tile_resize"] {
			let control = field(operation, "tile_size").control;
			assert_eq!(
				control,
				Control::Choice {
					options: vec!["256".to_string(), "512".to_string()]
				},
				"{operation}"
			);
		}
		assert_eq!(
			field("from_color", "size").control,
			Control::Choice {
				options: vec!["256".to_string(), "512".to_string()]
			}
		);
	}

	/// **Every colour the table names is offered as one**, whichever way the operation spells it. The
	/// tripwire is the same as the paths' and the rectangles': held against the registry, so an
	/// operation arriving with a colour nobody tabulated is caught rather than shown as a hex field or
	/// as three bare numbers.
	#[test]
	fn every_colour_in_the_registry_is_a_swatch() {
		let missed: Vec<String> = operations()
			.iter()
			.flat_map(|operation| {
				operation
					.fields
					.iter()
					.filter(|field| {
						role_of(&operation.name, &field.name) == Some(Role::Color)
							&& !matches!(field.control, Control::Color { .. })
					})
					.map(|field| format!("{}.{}", operation.name, field.name))
			})
			.collect();
		assert!(missed.is_empty(), "these should offer a swatch: {missed:?}");
	}

	/// The two spellings, spelled out - so a change to either is a change to this line.
	#[test]
	fn a_colour_is_hex_or_three_numbers_depending_on_the_operation() {
		assert_eq!(field("from_color", "color").control, Control::Color { hex: true });
		assert_eq!(field("raster_flatten", "color").control, Control::Color { hex: false });
	}

	/// And a field named `color` that the table has never heard of is not assumed to be one.
	#[test]
	fn only_a_tabulated_colour_is_a_swatch() {
		let wrong: Vec<String> = operations()
			.iter()
			.flat_map(|operation| {
				operation
					.fields
					.iter()
					.filter(|field| {
						matches!(field.control, Control::Color { .. })
							&& role_of(&operation.name, &field.name) != Some(Role::Color)
					})
					.map(|field| format!("{}.{}", operation.name, field.name))
			})
			.collect();
		assert!(wrong.is_empty(), "not colours: {wrong:?}");
	}

	/// And the other way: the map's rectangle is offered only where the table says there is one.
	#[test]
	fn only_a_rectangle_is_drawn_on_the_map() {
		let wrong: Vec<String> = operations()
			.iter()
			.flat_map(|operation| {
				operation
					.fields
					.iter()
					.filter(|field| {
						field.control == Control::Bbox && role_of(&operation.name, &field.name) != Some(Role::GeoBBox)
					})
					.map(|field| format!("{}.{}", operation.name, field.name))
			})
			.collect();
		assert!(wrong.is_empty(), "not rectangles: {wrong:?}");
	}

	#[test]
	fn a_fixed_array_the_table_says_nothing_about_is_bare_numbers() {
		assert_eq!(field("from_csv", "bbox").control, Control::Bbox);
		// A three-array that is not a colour stays three numbers: a centre is `[lon, lat, zoom]`.
		assert_eq!(field("meta_update", "center").control, Control::Numbers { count: 3 });
	}

	#[test]
	fn a_string_list_is_a_list_and_a_plain_string_is_text() {
		assert_eq!(field("from_csv", "properties_include").control, Control::List);
		assert_eq!(field("from_csv", "layer_name").control, Control::Text);
	}

	/// The same Rust type as `layer_name` above, and a different control - which is the whole of
	/// why `is_path` reads the name.
	#[test]
	fn a_string_naming_a_file_is_a_path() {
		assert_eq!(field("from_container", "filename").control, Control::Path);
		assert_eq!(field("raster_mask", "geojson").control, Control::Path);
	}

	#[test]
	fn a_boolean_is_a_checkbox() {
		assert_eq!(field("from_csv", "has_header").control, Control::Boolean);
	}

	/// `sources` is fed by the `[ … ]` block, so it must not appear as a text field.
	#[test]
	fn a_sources_field_is_marked_rather_than_given_a_control() {
		let sources = field("from_stacked", "sources");
		assert!(sources.sources);
		assert!(sources.required);
	}

	#[test]
	fn required_and_documentation_come_through() {
		let filename = field("from_container", "filename");
		assert!(filename.required);
		assert!(
			!filename.doc.is_empty(),
			"upstream documents its parameters; pass it on"
		);
	}

	/// An unrecognised type is still editable, as the string VPL stores anyway.
	#[test]
	fn an_unknown_type_falls_back_to_text() {
		assert_eq!(
			control_for("from_csv", "whatever", "Option<SomethingNew>", &[]),
			Control::Text
		);
		assert_eq!(control_for("from_csv", "whatever", "[String;2]", &[]), Control::Text);
	}

	#[test]
	fn every_operation_reports_a_side_and_at_least_one_way_in() {
		for operation in operations() {
			assert!(
				operation.kind == "read" || operation.kind == "transform",
				"{} has kind {:?}",
				operation.name,
				operation.kind
			);
		}
	}
}

/// The first paragraph of an operation's documentation - what it does, in a sentence.
///
#[cfg(test)]
mod summary_tests {
	use super::*;

	/// What the picker rests on: every operation in this build has a summary short enough to sit
	/// in a list, and it is not the whole document.
	///
	/// Studio used to split this out of `doc` itself, because upstream only offered the full
	/// rustdoc. [vt#229](https://github.com/versatiles-org/versatiles-rs/issues/229) added
	/// `summary` and `details`, so the splitter is gone - but the claim it rested on is still a
	/// claim, and upstream's field can regress as easily as ours could.
	#[test]
	fn every_operation_has_a_short_usable_summary() {
		for operation in operations() {
			let summary = &operation.summary;
			assert!(!summary.is_empty(), "{} has no summary", operation.name);
			assert!(
				!summary.contains("###"),
				"{}'s summary swallowed a heading: {summary}",
				operation.name
			);
			assert!(
				summary.chars().count() <= 300,
				"{}'s summary is {} chars, which is not a sentence",
				operation.name,
				summary.chars().count()
			);
		}
	}

	/// The other half of vt#229: `details` must not carry the parameter list back in, or the
	/// duplication the issue removed returns by a different name.
	#[test]
	fn details_leave_the_parameter_list_to_fields() {
		for operation in operations() {
			assert!(
				!operation.details.contains("### Parameters"),
				"{}'s details still carry the generated parameter list",
				operation.name
			);
		}
	}
}

#[cfg(test)]
mod default_tests {
	use super::*;

	fn field(operation: &str, name: &str) -> FieldInfo {
		operations()
			.into_iter()
			.find(|op| op.name == operation)
			.unwrap_or_else(|| panic!("no operation {operation}"))
			.fields
			.into_iter()
			.find(|f| f.name == name)
			.unwrap_or_else(|| panic!("no field {operation}.{name}"))
	}

	/// The distinction the form rests on: an optional parameter with a literal default has something
	/// to show, and a required one has nothing - the two used to look identical (vt#253).
	#[test]
	fn a_default_is_carried_when_there_is_one() {
		let colour = field("from_color", "color");
		assert!(!colour.required);
		assert!(colour.default.is_some(), "from_color uses 000000 when color is absent");

		let column = field("from_csv", "lon_column");
		assert!(column.default.is_none(), "there is no value this could fall back to");
	}
}
