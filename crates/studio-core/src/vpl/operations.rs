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
fn control_for(name: &str, rust_type: &str, enum_variants: &[&'static str]) -> Control {
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
	if let Some(count) = fixed_array_len(inner) {
		return Control::Numbers { count };
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
					control: control_for(&field.name, &field.rust_type, &field.enum_variants),
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

	#[test]
	fn a_bbox_is_four_numbers_and_a_colour_three() {
		assert_eq!(field("from_csv", "bbox").control, Control::Numbers { count: 4 });
		assert_eq!(field("raster_flatten", "color").control, Control::Numbers { count: 3 });
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
		assert_eq!(control_for("whatever", "Option<SomethingNew>", &[]), Control::Text);
		assert_eq!(control_for("whatever", "[String;2]", &[]), Control::Text);
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
