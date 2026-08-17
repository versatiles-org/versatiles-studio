//! Checking a parsed pipeline against the operations that actually exist (S2.4, C4).
//!
//! Parsing says the text is well-formed VPL. It says nothing about whether `from_containr` is an
//! operation, whether `filename` is one of its parameters, or whether `format=notaformat` names a
//! real format. Those are the mistakes people actually make, and without this they surface as a
//! failure at run time, far from the character that caused them.
//!
//! **Every rule here was verified against upstream before being written.** Each of the eight cases
//! below was fed to `PipelineFactory::operation_from_vpl`, and every one is rejected — so these are
//! errors rather than advice, and Studio is not inventing a stricter language than the CLI runs.
//! `metadata_matches_upstream` in the tests keeps that true.

use super::{Document, Node, Pipeline, Span, Value};
use std::collections::HashMap;
use std::sync::OnceLock;
use versatiles_pipeline::{OperationMeta, all_operation_metadata};

/// A problem with a position, ready for the editor to underline.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
	pub message: String,
	pub span: Span,
}

/// Operations by name, built once. `all_operation_metadata()` walks every factory on each call.
fn operations() -> &'static HashMap<String, OperationMeta> {
	static OPERATIONS: OnceLock<HashMap<String, OperationMeta>> = OnceLock::new();
	OPERATIONS.get_or_init(|| {
		all_operation_metadata()
			.into_iter()
			.map(|meta| (meta.tag_name.clone(), meta))
			.collect()
	})
}

/// Everything wrong with the document, in source order.
///
/// Returns all of them rather than stopping at the first: a pipeline with three typos should show
/// three underlines, not one at a time.
#[must_use]
pub fn validate(document: &Document) -> Vec<Diagnostic> {
	let mut out = Vec::new();
	check_pipeline(document.pipeline(), &mut out);
	out.sort_by_key(|d| d.span.start);
	out
}

fn check_pipeline(pipeline: &Pipeline, out: &mut Vec<Diagnostic>) {
	for (index, node) in pipeline.nodes.iter().enumerate() {
		check_node(node, index == 0, out);
		for source in &node.sources {
			check_pipeline(source, out);
		}
	}
}

fn check_node(node: &Node, is_head: bool, out: &mut Vec<Diagnostic>) {
	let Some(meta) = operations().get(&node.name) else {
		let names: Vec<&str> = operations().keys().map(String::as_str).collect();
		out.push(Diagnostic {
			message: match nearest(&node.name, &names) {
				Some(guess) => format!("unknown operation '{}' — did you mean '{guess}'?", node.name),
				None => format!("unknown operation '{}'", node.name),
			},
			span: node.name_span,
		});
		return;
	};

	// A pipeline reads, then transforms. `from_debug | from_debug` and a bare `raster_overview` are
	// both rejected upstream, so the position of an operation is as checkable as its name.
	let expected = if is_head { "read" } else { "transform" };
	if meta.kind != expected {
		out.push(Diagnostic {
			message: if is_head {
				format!("'{}' transforms tiles, so it cannot start a pipeline", node.name)
			} else {
				format!("'{}' reads tiles, so it can only be first", node.name)
			},
			span: node.name_span,
		});
	}

	for property in &node.properties {
		let Some(field) = meta.fields.iter().find(|f| f.name == property.key) else {
			let names: Vec<&str> = meta.fields.iter().map(|f| f.name.as_str()).collect();
			out.push(Diagnostic {
				message: match nearest(&property.key, &names) {
					Some(guess) => format!(
						"'{}' has no parameter '{}' — did you mean '{guess}'?",
						node.name, property.key
					),
					None => format!("'{}' has no parameter '{}'", node.name, property.key),
				},
				span: property.key_span,
			});
			continue;
		};

		if field.enum_variants.is_empty() {
			continue;
		}
		let items: Vec<(&str, Span)> = match &property.value {
			Value::Single(s) => vec![(s.value.as_str(), s.span)],
			Value::Array { items, .. } => items.iter().map(|i| (i.value.as_str(), i.span)).collect(),
		};
		for (value, span) in items {
			if !field.enum_variants.contains(&value) {
				out.push(Diagnostic {
					message: format!(
						"'{value}' is not a valid {}: expected one of {}",
						field.name,
						field.enum_variants.join(", ")
					),
					span,
				});
			}
		}
	}

	for field in meta.fields.iter().filter(|f| f.is_required) {
		// A `sources` field is satisfied by the `[…]` block, not by a `key=value` pair.
		let satisfied = if field.is_sources {
			!node.sources.is_empty()
		} else {
			node.properties.iter().any(|p| p.key == field.name)
		};
		if !satisfied {
			out.push(Diagnostic {
				message: if field.is_sources {
					format!("'{}' needs input sources, as '{} [ … ]'", node.name, node.name)
				} else {
					format!("'{}' needs a '{}' parameter", node.name, field.name)
				},
				span: node.name_span,
			});
		}
	}
}

/// The closest candidate within a small edit distance, for "did you mean".
///
/// The threshold scales with length so that short names do not match everything: a typo is usually
/// one or two characters, and suggesting `from_csv` for `from_geo` would be worse than silence.
fn nearest<'a>(word: &str, candidates: &[&'a str]) -> Option<&'a str> {
	let limit = match word.len() {
		0..=4 => 1,
		5..=8 => 2,
		_ => 3,
	};
	candidates
		.iter()
		.map(|candidate| (distance(word, candidate), *candidate))
		.filter(|(d, _)| *d <= limit)
		.min_by_key(|(d, candidate)| (*d, candidate.len()))
		.map(|(_, candidate)| candidate)
}

/// Levenshtein distance, two rows at a time.
fn distance(a: &str, b: &str) -> usize {
	let b: Vec<char> = b.chars().collect();
	let mut previous: Vec<usize> = (0..=b.len()).collect();
	let mut current = vec![0; b.len() + 1];
	for (i, ca) in a.chars().enumerate() {
		current[0] = i + 1;
		for (j, cb) in b.iter().enumerate() {
			current[j + 1] = (previous[j] + usize::from(ca != *cb))
				.min(previous[j + 1] + 1)
				.min(current[j] + 1);
		}
		std::mem::swap(&mut previous, &mut current);
	}
	previous[b.len()]
}

#[cfg(test)]
mod tests {
	use super::*;
	use versatiles_pipeline::PipelineFactory;

	fn diagnose(vpl: &str) -> Vec<String> {
		validate(&Document::parse(vpl).unwrap())
			.into_iter()
			.map(|d| d.message)
			.collect()
	}

	#[test]
	fn a_correct_pipeline_has_nothing_to_say() {
		for vpl in [
			"from_debug format=png",
			"from_container filename=berlin.versatiles",
			"from_container filename=a | raster_overview level=2",
			"from_stacked [ from_debug format=png, from_debug format=png ]",
			"from_csv filename=a.csv lon_column=lon lat_column=lat | vector_repair",
		] {
			assert_eq!(diagnose(vpl), Vec::<String>::new(), "{vpl} should be clean");
		}
	}

	#[test]
	fn an_unknown_operation_is_named_and_a_near_miss_suggested() {
		let messages = diagnose("from_containr filename=a");
		assert_eq!(messages.len(), 1);
		assert!(
			messages[0].contains("unknown operation 'from_containr'"),
			"{messages:?}"
		);
		assert!(messages[0].contains("did you mean 'from_container'"), "{messages:?}");
	}

	/// `vector_filter` is the name used throughout Studio's own early notes, and it does not exist —
	/// the real operations are `vector_filter_features`, `_layers` and `_properties`.
	#[test]
	fn a_plausible_but_absent_operation_is_caught() {
		let messages = diagnose("from_container filename=a | vector_filter layer=roads");
		assert!(
			messages.iter().any(|m| m.contains("unknown operation 'vector_filter'")),
			"{messages:?}"
		);
	}

	#[test]
	fn an_unknown_parameter_is_reported_where_it_is_written() {
		let vpl = "from_debug format=png nonsense=1";
		let document = Document::parse(vpl).unwrap();
		let found = validate(&document);
		assert_eq!(found.len(), 1, "{found:?}");
		assert!(found[0].message.contains("has no parameter 'nonsense'"), "{found:?}");
		assert_eq!(
			document.slice(found[0].span),
			Some("nonsense"),
			"underline the key itself"
		);
	}

	#[test]
	fn a_missing_required_parameter_points_at_the_operation() {
		let document = Document::parse("from_container").unwrap();
		let found = validate(&document);
		assert_eq!(found.len(), 1, "{found:?}");
		assert!(found[0].message.contains("needs a 'filename' parameter"), "{found:?}");
		assert_eq!(document.slice(found[0].span), Some("from_container"));
	}

	#[test]
	fn a_value_outside_an_enum_lists_what_is_allowed() {
		let document = Document::parse("from_debug format=notaformat").unwrap();
		let found = validate(&document);
		assert_eq!(found.len(), 1, "{found:?}");
		assert!(found[0].message.contains("not a valid format"), "{found:?}");
		assert!(
			found[0].message.contains("png"),
			"the allowed values should be listed: {found:?}"
		);
		assert_eq!(document.slice(found[0].span), Some("notaformat"), "underline the value");
	}

	/// A pipeline reads and then transforms; both halves of that rule are checked.
	#[test]
	fn operations_are_checked_for_position() {
		assert!(
			diagnose("from_debug format=png | from_debug format=png")[0].contains("can only be first"),
			"a read in transform position"
		);
		assert!(
			diagnose("raster_overview level=2")[0].contains("cannot start a pipeline"),
			"a transform at the head"
		);
	}

	#[test]
	fn a_composite_without_sources_says_what_is_missing() {
		let messages = diagnose("from_stacked");
		assert_eq!(messages.len(), 1, "{messages:?}");
		assert!(messages[0].contains("needs input sources"), "{messages:?}");
	}

	#[test]
	fn nested_pipelines_are_checked_too() {
		let messages = diagnose("from_stacked [ from_containr filename=a ]");
		assert!(messages.iter().any(|m| m.contains("from_containr")), "{messages:?}");
	}

	#[test]
	fn every_problem_is_reported_not_just_the_first() {
		let messages = diagnose("from_debug format=nope nonsense=1");
		assert_eq!(messages.len(), 2, "both should be reported: {messages:?}");
	}

	/// The known gap, written down rather than left to be discovered.
	///
	/// `VPLFieldMeta` describes a field's name, whether it is required, and its enum variants. It
	/// does not describe the *format* of a free-form value, so `color=red` — which upstream rejects
	/// for not being hex — passes here. Catching those would mean either parsing every `rust_type`
	/// Studio knows about, or building the operation for real, which is far too expensive to do on
	/// a keystroke. They surface when the pipeline runs.
	#[tokio::test]
	async fn value_formats_are_not_checked() {
		assert_eq!(
			diagnose("from_color color=red"),
			Vec::<String>::new(),
			"metadata cannot see this"
		);
		assert!(
			PipelineFactory::new_dummy()
				.operation_from_vpl("from_color color=red")
				.await
				.is_err(),
			"but upstream can, and does — if this ever passes, the gap has closed"
		);
	}

	/// The rule that keeps this honest: Studio must reject exactly what the CLI rejects, no more.
	///
	/// Accepting something upstream refuses sends a user to a run-time failure; refusing something
	/// upstream accepts makes Studio a stricter language than the tool it drives. Both are the drift
	/// [Q23](../../../docs/decisions.md)'s differential test exists to prevent, one level up.
	#[tokio::test]
	async fn what_studio_rejects_upstream_rejects_too() {
		let factory = PipelineFactory::new_dummy();
		// Only cases the metadata can actually decide. `operation_from_vpl` does not stop at the
		// grammar — it constructs the operation, so it also fails on things no metadata describes:
		// `from_container filename=a` fails on the missing file, and `from_color color=red` on `red`
		// not being hex. Those are the boundary this validator sits on, and
		// `value_formats_are_not_checked` records it.
		let cases = [
			("from_debug format=png", true),
			("from_color", true),
			("from_stacked [ from_debug format=png, from_debug format=png ]", true),
			("from_debug format=png nonsense=1", false),
			("from_debug format=notaformat", false),
			("from_container", false),
			("not_an_operation", false),
			("from_debug format=png | from_debug format=png", false),
			("raster_overview level=2", false),
			("from_stacked", false),
		];

		let mut disagreements = Vec::new();
		for (vpl, should_be_valid) in cases {
			let studio_ok = diagnose(vpl).is_empty();
			// `from_container filename=a` opens no file here — the dummy factory builds the operation
			// without reading, which is exactly the layer being checked.
			let upstream_ok = factory.operation_from_vpl(vpl).await.is_ok();
			if studio_ok != upstream_ok || upstream_ok != should_be_valid {
				disagreements.push(format!(
					"{vpl:?}: studio {}, upstream {}, expected {}",
					if studio_ok { "accepts" } else { "rejects" },
					if upstream_ok { "accepts" } else { "rejects" },
					if should_be_valid { "accept" } else { "reject" }
				));
			}
		}
		assert!(
			disagreements.is_empty(),
			"validation disagrees with the pipeline factory:\n  {}",
			disagreements.join("\n  ")
		);
	}
}
