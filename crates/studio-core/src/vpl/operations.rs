//! What the operations are, in a shape a form can be built from (S2.6, C2).
//!
//! Upstream describes each parameter with a `rust_type` string — `Option<u8>`, `Option<[f64;4]>`,
//! `Vec<String>` — which is exactly right for a code generator and no use to a webview. Reading it
//! is a mapping decision, so it happens once here rather than in TypeScript: the browser receives a
//! control to render and never sees a Rust type.
//!
//! Everything else comes straight from the metadata, including each field's documentation, so a new
//! operation upstream appears in Studio's forms with no work here at all — which is the point of
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
	/// `Vec<String>` — a list of values, written as a VPL array.
	List,
	/// A fixed-size numeric array: a bbox is four, a colour or a centre three.
	Numbers {
		#[cfg_attr(feature = "bindings", specta(type = u32))]
		count: usize,
	},
}

/// Reads a `rust_type` into the control that fits it.
///
/// Unknown types fall back to text rather than failing. A parameter upstream adds in a shape we do
/// not recognise should still be editable — as the string it is written as, which is what VPL
/// stores anyway.
fn control_for(rust_type: &str, enum_variants: &[&'static str]) -> Control {
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
}

/// One operation, ready to render.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct OperationInfo {
	pub name: String,
	/// `read` or `transform` — which end of a pipeline it belongs at.
	pub kind: String,
	/// What it does, in a sentence — see [`summary`] for why this is separate from `doc`.
	pub summary: String,
	/// The whole rustdoc, of which four fifths restates `fields` in prose.
	pub doc: String,
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
			summary: summary(&meta.doc).to_string(),
			doc: meta.doc.clone(),
			fields: meta
				.fields
				.iter()
				.map(|field| FieldInfo {
					name: field.name.clone(),
					doc: field.doc.clone(),
					required: field.is_required,
					sources: field.is_sources,
					control: control_for(&field.rust_type, &field.enum_variants),
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
		assert_eq!(field("from_container", "filename").control, Control::Text);
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
		assert_eq!(control_for("Option<SomethingNew>", &[]), Control::Text);
		assert_eq!(control_for("[String;2]", &[]), Control::Text);
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

/// The first paragraph of an operation's documentation — what it does, in a sentence.
///
/// **A workaround, and marked as one.** `all_operation_metadata()` returns the whole rustdoc in one
/// string: a summary paragraph followed by a generated `### Parameters` section. Measured across the
/// 30 operations, that section is 81% of the text, and all 127 field docs appear verbatim inside it —
/// the same data this call already returns, structured, in `fields`. So this takes the tenth that is
/// not a duplicate.
///
/// Asked for upstream as [versatiles-rs#229](https://github.com/versatiles-org/versatiles-rs/issues/229);
/// when `doc` carries a summary of its own this becomes a field access. Until then the split is
/// conservative: a blank line or the `###` heading, whichever comes first, and the whole string when
/// neither appears.
///
/// `the_workaround_is_still_needed` below fails the day that lands, so nobody has to remember.
#[must_use]
pub fn summary(doc: &str) -> &str {
	let end = doc
		.find("\n\n")
		.into_iter()
		.chain(doc.find("\n#"))
		.min()
		.unwrap_or(doc.len());
	doc[..end].trim()
}

#[cfg(test)]
mod summary_tests {
	use super::*;

	#[test]
	fn the_summary_is_the_first_paragraph() {
		assert_eq!(
			summary("Does a thing.\n\n### Parameters\n\n- **a**: …"),
			"Does a thing."
		);
		assert_eq!(
			summary("Two\nlines of summary.\n\n### Parameters"),
			"Two\nlines of summary."
		);
		// A heading with no blank line before it still ends the summary.
		assert_eq!(summary("Does a thing.\n### Parameters"), "Does a thing.");
		// Nothing to split on: the whole string is the summary.
		assert_eq!(summary("Just one line."), "Just one line.");
		assert_eq!(summary(""), "");
	}

	/// **Deliberately fails when upstream fixes this.**
	///
	/// [versatiles-rs#229](https://github.com/versatiles-org/versatiles-rs/issues/229) asks for the
	/// generated `### Parameters` section to be split out of `doc`, or dropped — everything in it is
	/// already in `fields`. The day that ships, this test goes red and says what to delete, which is
	/// a more reliable form of remembering than a note somebody has to re-read.
	#[test]
	fn the_workaround_is_still_needed() {
		let bloated = operations()
			.iter()
			.filter(|operation| operation.doc.contains("### Parameters"))
			.count();
		assert!(
			bloated > 0,
			"no operation doc carries a `### Parameters` section any more — upstream #229 has \
			 landed. Delete `summary()` and its tests, read the summary from the metadata instead, \
			 and drop the note in docs/ecosystem.md."
		);
	}

	/// The claim the workaround rests on: every operation in this build has a usable first
	/// paragraph, and it is a small fraction of the whole.
	#[test]
	fn every_operation_has_a_short_usable_summary() {
		for operation in operations() {
			let summary = summary(&operation.doc);
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
}
