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

use serde::Serialize;
use std::collections::HashMap;
use std::sync::OnceLock;
use versatiles_pipeline::vpl::VPLFieldMeta;
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
	/// Bounds come from the type where it has them, and from the integer width otherwise.
	///
	/// **Exclusive ends are real, not a rounding of inclusive ones.** `raster_levels.contrast` and
	/// `gamma` are "above `0`" - zero itself is refused - and until [vt#260] nothing could say so:
	/// Studio's table dropped them rather than approximate, and upstream had no way to state them.
	/// `Bounds` carries the flags now, so a form can too.
	///
	/// [vt#260]: https://github.com/versatiles-org/versatiles-rs/issues/260
	#[serde(rename_all = "camelCase")]
	Number {
		integer: bool,
		#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
		min: Option<f64>,
		#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
		max: Option<f64>,
		/// `min` is the first value *not* accepted.
		min_exclusive: bool,
		/// `max` is the first value *not* accepted.
		max_exclusive: bool,
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

/// What a field's type is once `Option<…>` is off it, which is what every rule below reads.
fn inner_type(rust_type: &str) -> &str {
	rust_type
		.strip_prefix("Option<")
		.and_then(|rest| rest.strip_suffix('>'))
		.unwrap_or(rust_type)
}

/// Reads a field's metadata into the control that fits it.
///
/// **Almost entirely upstream's answer now.** Every rule here reads something `VPLFieldMeta` states -
/// the type, the variants, the bounds - rather than a table of Studio's own. That table used to hold
/// 67 entries recovering meaning the metadata could not carry; [vt#260] moved the lot upstream, and
/// this is what is left of reading it.
///
/// Unknown types still fall back to text rather than failing. A parameter upstream adds in a shape we
/// do not recognise should still be editable, as the string VPL stores anyway -
/// `only_a_string_falls_back_to_text` is what stops that fallback going quiet.
///
/// [vt#260]: https://github.com/versatiles-org/versatiles-rs/issues/260
fn control_for(field: &VPLFieldMeta) -> Control {
	if !field.enum_variants.is_empty() {
		return Control::Choice {
			options: field.enum_variants.iter().map(|v| (*v).to_string()).collect(),
		};
	}

	let inner = inner_type(&field.rust_type);

	if inner == "bool" {
		return Control::Boolean;
	}
	if inner == "Vec<String>" {
		return Control::List;
	}

	// **The types upstream named.** Each of these was once inferred here from a shape, a field name or
	// a doc phrase; every one of those guesses is now a type that says it outright ([vt#257], #260).
	match inner {
		"GeoBBox" => return Control::Bbox,
		"HexColor" => return Control::Color { hex: true },
		"SeparatorChar" | "CsvDelimiter" => return Control::Char,
		// `GeoDataPath` and `TileFilePath` are paths that refuse the wrong extension rather than
		// merely suggesting one - which is `accepts` saying `Only` rather than `Suggested`, not a
		// different control.
		"FilePath" | "SourceLocation" | "GeoDataPath" | "TileFilePath" => return Control::Path,
		// `[lon, lat, zoom]`, which was `[f64;3]` until #260 named it. Three numbers is what it was
		// offered as then and what it is offered as now; a point picked off the map would be better,
		// and is a feature rather than a way of reading metadata.
		"GeoCenter" => return Control::Numbers { count: 3 },
		_ => {}
	}

	// **A range the type carries, in preference to the range the type merely permits.** A `ZoomLevel`
	// is `0..=30` and a `u8` is `0..=255`; before #260 only the second was knowable here, which is how
	// an EPSG code came to be offered as a box accepting four billion values. `bounds` is upstream
	// stating the real one, so it is read before the integer-width fallback below.
	if let Some(bounds) = &field.bounds {
		return Control::Number {
			integer: bounds.integer,
			min: bounds.min,
			max: bounds.max,
			min_exclusive: bounds.min.is_some() && !bounds.min_inclusive,
			max_exclusive: bounds.max.is_some() && !bounds.max_inclusive,
		};
	}

	if let Some(count) = fixed_array_len(inner) {
		return Control::Numbers { count };
	}

	match inner {
		"u8" => number(true, Some(0.0), Some(f64::from(u8::MAX))),
		"u16" => number(true, Some(0.0), Some(f64::from(u16::MAX))),
		"u32" => number(true, Some(0.0), Some(f64::from(u32::MAX))),
		"u64" | "usize" => number(true, Some(0.0), None),
		"i8" | "i16" | "i32" | "i64" | "isize" => number(true, None, None),
		"f32" | "f64" => number(false, None, None),
		_ => Control::Text,
	}
}

fn number(integer: bool, min: Option<f64>, max: Option<f64>) -> Control {
	Control::Number {
		integer,
		min,
		max,
		min_exclusive: false,
		max_exclusive: false,
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
	/// Extensions to filter a file dialog by, or empty to offer everything.
	///
	/// **Upstream's answer, per field.** Studio used to pick the filter from the *node* - the import
	/// catalogue entry whose read operation matched - so every path row on a card got the same one.
	/// That was right for a node's own input and wrong beside it: `from_gdal_raster`'s `cutline` is a
	/// GeoJSON clip polygon and was offered raster extensions, `ssh_identity` is a private key and was
	/// offered container extensions, and the eight fields on operations with no catalogue entry got no
	/// filter at all. [vt#260] put it on the field, where the operation that reads the file states it.
	///
	/// **`Suggested` and `Only` arrive here as one list**, deliberately. The distinction is whether a
	/// value that is not in it still builds, and a dialog cannot express that: there is no "all files"
	/// entry to escape through (see `askForPath`), so both are a filter and the refusal belongs to
	/// `check`, which already reports a wrong extension where the type demands one.
	///
	/// [vt#260]: https://github.com/versatiles-org/versatiles-rs/issues/260
	pub accepts: Vec<String>,
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
					control: control_for(field),
					accepts: field
						.accepts
						.map(|accepts| accepts.extensions().iter().map(|&e| e.to_string()).collect())
						.unwrap_or_default(),
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
		const KNOWN_TEXT_TYPES: &[&str] = &[
			"String",
			// A byte count *or* the word `none`, so a number control could not express half of it.
			"MaxTileBytes",
			// A whole per-zoom curve in one string - `0-10:80,11-14:90` - which is a small language.
			"QualityByZoom",
			// Source text in a language of its own. An editor with highlighting would be better than a
			// line, and is a feature; text is the honest control until there is one.
			"CelExpression",
			"RegexPattern",
			"TileJSON",
			"VectorLayers",
			// A URL. Text is right - the picker beside a `FilePath` would be answering the wrong
			// question, which is why `from_tilejson.url` has always been kept away from one.
			"HttpUrl",
			// Numbers, but in the dataset's own CRS rather than in degrees: `bounds` is `west,south,
			// east,north` in the units of `crs`, and `geo_transform` is GDAL's six coefficients. The
			// map cannot draw either, and a fixed row of number boxes would imply it could.
			"CrsExtent",
			"RasterTransform",
			// Lists of numbers of no fixed length - which bands to read, what counts as nodata.
			"BandIndices",
			"NodataValues",
		];

		let unrecognised: Vec<String> = registry()
			.values()
			.flat_map(|meta| {
				meta.fields.iter().filter_map(move |field| {
					let inner = inner_type(&field.rust_type);
					let text = control_for(field) == Control::Text;
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

	/// **The filter belongs to the field, not to the node it sits on.**
	///
	/// Each of these was wrong when the dialog took its filter from the node's read operation, and
	/// each is wrong in a different way: a clip polygon offered raster extensions, a private key
	/// offered container extensions, and a file on a transform offered nothing because a transform has
	/// no catalogue entry to match. Spelled out so that a regression names which one it broke.
	#[test]
	fn a_file_field_is_filtered_by_what_it_reads() {
		assert_eq!(field("from_gdal_raster", "cutline").accepts, ["geojson", "json"]);
		assert_eq!(field("raster_mask", "geojson").accepts, ["geojson", "json"]);
		assert_eq!(
			field("vector_update_properties", "data_source_path").accepts,
			["csv", "tsv"]
		);
		assert_eq!(field("meta_update", "tilejson_file").accepts, ["json"]);
		assert_eq!(
			field("from_container", "filename").accepts,
			["versatiles", "mbtiles", "pmtiles", "tar"]
		);

		// A key file has no conventional extension, and GDAL decides its own set - so both say so by
		// offering everything rather than by guessing a list.
		assert!(field("from_container", "ssh_identity").accepts.is_empty());
		assert!(field("from_gdal_raster", "filename").accepts.is_empty());
	}

	/// Every path offers a filter or deliberately offers none, and nothing else carries one.
	#[test]
	fn only_a_path_says_what_it_accepts() {
		for operation in operations() {
			for field in operation.fields {
				if field.control != Control::Path {
					assert!(
						field.accepts.is_empty(),
						"{}.{} is not a path and accepts {:?}",
						operation.name,
						field.name,
						field.accepts
					);
				}
			}
		}
	}

	/// A URL is somewhere else, and a picker offering the local disk for it answers the wrong
	/// question.
	#[test]
	fn a_url_is_not_a_path() {
		assert_eq!(field("from_tilejson", "url").control, Control::Text);
	}

	/// **The bound the type states, not the one its width permits.**
	///
	/// `min_zoom` was a `u8` and got `0..=255` here - a control that offered 300 zoom levels because
	/// nothing could say otherwise. [vt#260] gave it a `ZoomLevel` carrying `0..=30`, and `crs` an
	/// `EpsgCode` carrying `1024..=32766` where it used to offer four billion values.
	///
	/// [vt#260]: https://github.com/versatiles-org/versatiles-rs/issues/260
	#[test]
	fn a_bounded_type_carries_its_own_range() {
		assert_eq!(
			field("from_csv", "min_zoom").control,
			Control::Number {
				integer: true,
				min: Some(0.0),
				max: Some(30.0),
				min_exclusive: false,
				max_exclusive: false
			}
		);
		assert_eq!(
			field("from_gdal_raster", "crs").control,
			Control::Number {
				integer: true,
				min: Some(1024.0),
				max: Some(32766.0),
				min_exclusive: false,
				max_exclusive: false
			}
		);
	}

	/// **An exclusive end is carried, not rounded to an inclusive one.**
	///
	/// `gamma` is "above `0`" - zero is refused, and so is every value below it, but there is no
	/// smallest accepted float to put in `min`. Studio's old table dropped these two rather than
	/// approximate them; upstream had no way to state them at all until [vt#260].
	///
	/// [vt#260]: https://github.com/versatiles-org/versatiles-rs/issues/260
	#[test]
	fn a_bound_that_excludes_its_own_end_says_so() {
		assert_eq!(
			field("raster_levels", "gamma").control,
			Control::Number {
				integer: false,
				min: Some(0.0),
				max: None,
				min_exclusive: true,
				max_exclusive: false
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
				max: None,
				min_exclusive: false,
				max_exclusive: false
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
					.filter(|field| {
						matches!(field.name.as_str(), "bbox" | "bounds")
							&& field.control != Control::Bbox
							// Not every rectangle is one this map can draw: `from_gdal_*`'s `bounds` is in
							// the units of its own `crs`, so a dataset in metres has bounds in metres.
							// Excluded by what upstream wrote, not by name, so a third one arriving without
							// that sentence is still caught here.
							&& !field.doc.contains("units of `crs`")
					})
					.map(|field| format!("{}.{}", operation.name, field.name))
			})
			.collect();
		assert!(
			missed.is_empty(),
			"named like a rectangle and not offered as one - upstream types these `GeoBBox`, so a \
			 field that is not one either changed shape or is measured in something else: {missed:?}"
		);
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
			field("from_color", "tile_size").control,
			Control::Choice {
				options: vec!["256".to_string(), "512".to_string()]
			}
		);
	}

	/// **Every colour the table names is offered as one**, whichever way the operation spells it. The
	/// tripwire is the same as the paths' and the rectangles': held against the registry, so an
	/// operation arriving with a colour nobody tabulated is caught rather than shown as a hex field or
	/// as three bare numbers.
	/// The two spellings, spelled out - so a change to either is a change to this line. One is a type
	/// upstream and one is an entry here, which is the whole of what [vt#260] asks to even out.
	///
	/// [vt#260]: https://github.com/versatiles-org/versatiles-rs/issues/260
	#[test]
	fn both_colours_are_the_same_control_now() {
		// `raster_flatten` was `[u8;3]` and needed an entry in a table here to be recognised at all
		// ([vt#260]). Both are `HexColor`, so both are the same swatch, and nothing here has to know.
		//
		// [vt#260]: https://github.com/versatiles-org/versatiles-rs/issues/260
		assert_eq!(field("from_color", "color").control, Control::Color { hex: true });
		assert_eq!(field("raster_flatten", "color").control, Control::Color { hex: true });
	}

	/// A swatch is offered only where upstream typed a colour. A field merely *named* `color` gets
	/// nothing, and neither does one that is three bytes: [vt#260] made both spellings `HexColor`, so
	/// there is one source for this now rather than a type and a table.
	///
	/// [vt#260]: https://github.com/versatiles-org/versatiles-rs/issues/260
	#[test]
	fn only_a_typed_colour_is_a_swatch() {
		let wrong: Vec<String> = registry()
			.values()
			.flat_map(|meta| {
				meta
					.fields
					.iter()
					.filter(|field| {
						matches!(control_for(field), Control::Color { .. }) && inner_type(&field.rust_type) != "HexColor"
					})
					.map(move |field| format!("{}.{} :: {}", meta.tag_name, field.name, field.rust_type))
			})
			.collect();
		assert!(wrong.is_empty(), "not colours: {wrong:?}");
	}

	/// And the other way: the map's rectangle is offered only where upstream typed one.
	///
	/// Held against the `rust_type` rather than against `ROLES`, which is where this guard used to
	/// look. 4.11 made the rectangles `GeoBBox`, so the table no longer names them and the type is
	/// the whole invariant - a field getting a map picker without being a `GeoBBox` is the bug.
	#[test]
	fn only_a_rectangle_is_drawn_on_the_map() {
		let wrong: Vec<String> = registry()
			.values()
			.flat_map(|meta| {
				meta
					.fields
					.iter()
					.filter(|field| control_for(field) == Control::Bbox && inner_type(&field.rust_type) != "GeoBBox")
					.map(move |field| format!("{}.{} :: {}", meta.tag_name, field.name, field.rust_type))
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

	/// A field with nothing but a type name, for asking `control_for` about a shape the registry does
	/// not currently contain.
	fn synthetic(rust_type: &str) -> VPLFieldMeta {
		VPLFieldMeta {
			name: "whatever".to_string(),
			rust_type: rust_type.to_string(),
			is_required: false,
			is_sources: false,
			doc: String::new(),
			enum_variants: Vec::new(),
			bounds: None,
			refers_to: None,
			accepts: None,
			validate: None,
			default: None,
		}
	}

	/// An unrecognised type is still editable, as the string VPL stores anyway.
	#[test]
	fn an_unknown_type_falls_back_to_text() {
		assert_eq!(control_for(&synthetic("Option<SomethingNew>")), Control::Text);
		assert_eq!(control_for(&synthetic("[String;2]")), Control::Text);
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
