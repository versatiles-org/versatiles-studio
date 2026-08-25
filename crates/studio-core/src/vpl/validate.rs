//! Placing upstream's verdict on a pipeline in the text that produced it (S2.4, C4).
//!
//! Parsing says the text is well-formed VPL. It says nothing about whether `from_containr` is an
//! operation, whether `filename` is one of its parameters, or whether `format=notaformat` names a
//! real format. Those are the mistakes people actually make, and without this they surface as a
//! failure at run time, far from the character that caused them.
//!
//! **The rules are upstream's** ([vt#224]). Studio used to carry its own copy of them, verified
//! against `PipelineFactory::operation_from_vpl` case by case and kept honest by a test - which
//! worked, and was a second implementation of somebody else's language. `check_pipeline` needs no
//! runtime and does no I/O, so it can run on every keystroke.
//!
//! **What stays here is the part upstream cannot do**: turning a problem's node path and parameter
//! name back into a span the editor can underline, and offering "did you mean" for a name that is
//! nearly right. Upstream reports the fault; only Studio knows where in the text it is.
//!
//! [vt#224]: https://github.com/versatiles-org/versatiles-rs/issues/224

use super::operations::registry as operations;
use super::{Document, Pipeline, Span};

/// A problem with a position, ready for the editor to underline.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Diagnostic {
	pub message: String,
	pub span: Span,
}

/// Everything wrong with the document, in source order.
///
/// Returns all of them rather than stopping at the first: a pipeline with three typos should show
/// three underlines, not one at a time.
#[must_use]
pub fn validate(document: &Document) -> Vec<Diagnostic> {
	let mut out: Vec<Diagnostic> = versatiles_pipeline::check_pipeline(&document.to_pipeline())
		.into_iter()
		.map(|problem| Diagnostic {
			span: locate(document.pipeline(), &problem.path, problem.property.as_deref()),
			message: suggest(&problem.message),
		})
		.collect();
	out.sort_by_key(|d| d.span.start);
	out
}

/// The narrowest span a problem is about.
///
/// The parameter's key when the problem names one, the operation's name otherwise - and the whole
/// document when the path names nothing, which happens for "pipeline is empty" and for a path this
/// build cannot follow. An underline in the wrong place would be worse than one around everything.
fn locate(pipeline: &Pipeline, path: &[usize], property: Option<&str>) -> Span {
	let Some(node) = pipeline.at_path(path) else {
		return Span { start: 0, end: 0 };
	};
	let Some(key) = property else {
		return node.name_span;
	};
	node
		.properties
		.iter()
		.find(|p| p.key == key)
		.map_or(node.name_span, |p| p.key_span)
}

/// Adds "did you mean `x`?" when a name is nearly one that exists.
///
/// Upstream reports the fault and stops there, correctly - it has no reason to guess at intent. An
/// editor does: a typo is the common case, and the operation list is short enough that the nearest
/// name is usually the one meant.
fn suggest(message: &str) -> String {
	let Some(name) = between(message, "unknown operation \'", "\'") else {
		return message.to_string();
	};
	let names: Vec<&str> = operations().keys().map(String::as_str).collect();
	match nearest(&name, &names) {
		Some(near) => format!("{message} - did you mean `{near}`?"),
		None => message.to_string(),
	}
}

/// The text between two markers, if both are there.
fn between(haystack: &str, open: &str, close: &str) -> Option<String> {
	let rest = haystack.split_once(open)?.1;
	Some(rest.split_once(close)?.0.to_string())
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
		assert!(messages[0].contains("did you mean `from_container`"), "{messages:?}");
	}

	/// `vector_filter` is the name used throughout Studio's own early notes, and it does not exist -
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
		assert!(
			found[0].message.contains("requires the parameter 'filename'"),
			"{found:?}"
		);
		assert_eq!(document.slice(found[0].span), Some("from_container"));
	}

	/// **An alias builds, so it must not be underlined.** `enum_variants` lists canonical names only,
	/// while the parsers take aliases besides - so `format=pbf` and `format=jpeg` build and would be
	/// reported as invalid by anything comparing against that list.
	///
	/// Studio did compare against it, and did report them. The cost of a second implementation was
	/// not that it drifted; it was that it was wrong in a way nobody would look for, because a
	/// validator that says "expected one of …" reads as authoritative. Asking `check_pipeline` is
	/// what fixed it, and this is what keeps it fixed.
	#[test]
	fn an_accepted_alias_is_never_reported() {
		for vpl in [
			"from_debug format=pbf",
			"from_debug format=jpeg",
			"from_debug format=mvt",
		] {
			assert!(diagnose(vpl).is_empty(), "{vpl} builds, so it must not be flagged");
		}
	}

	/// The other half, which only became true in 4.9.1.
	///
	/// Before [vt#252], upstream checked an enum value against the variant list too, and its answer
	/// for an unknown value was the same as its answer for an alias: accept it, and fail when the
	/// operation was built. Now the type's own parser decides, so a value that is neither a variant
	/// nor an alias is refused - and because Studio asks `check_pipeline` rather than deciding for
	/// itself, it is underlined while it is being typed rather than failing on the first tile.
	///
	/// [vt#252]: https://github.com/versatiles-org/versatiles-rs/issues/252
	#[test]
	fn a_value_that_is_neither_a_variant_nor_an_alias_is_reported() {
		assert!(
			!diagnose("from_debug format=notaformat").is_empty(),
			"upstream refuses this, so the editor should say so"
		);
	}

	/// A pipeline reads and then transforms; both halves of that rule are checked.
	#[test]
	fn operations_are_checked_for_position() {
		assert!(
			diagnose("from_debug format=png | from_debug format=png")[0].contains("can only be the first node"),
			"a read in transform position"
		);
		assert!(
			diagnose("raster_overview level=2")[0].contains("has to start with a read operation"),
			"a transform at the head"
		);
	}

	#[test]
	fn a_composite_without_sources_says_what_is_missing() {
		let messages = diagnose("from_stacked");
		assert_eq!(messages.len(), 1, "{messages:?}");
		assert!(messages[0].contains("needs at least one source"), "{messages:?}");
	}

	#[test]
	fn nested_pipelines_are_checked_too() {
		let messages = diagnose("from_stacked [ from_containr filename=a ]");
		assert!(messages.iter().any(|m| m.contains("from_containr")), "{messages:?}");
	}

	#[test]
	fn every_problem_is_reported_not_just_the_first() {
		let messages = diagnose("from_debug nonsense=1 | raster_overview rubbish=2");
		assert_eq!(messages.len(), 2, "both should be reported: {messages:?}");
	}

	/// The known gap, written down rather than left to be discovered.
	///
	/// `VPLFieldMeta` describes a field's name, whether it is required, and its enum variants. It
	/// does not describe the *format* of a free-form value, so `color=red` - which upstream rejects
	/// for not being hex - passes here. Catching those would mean either parsing every `rust_type`
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
			"but upstream can, and does - if this ever passes, the gap has closed"
		);
	}

	/// The rule that keeps this honest: Studio must reject exactly what the CLI rejects, no more.
	///
	/// Accepting something upstream refuses sends a user to a run-time failure; refusing something
	/// upstream accepts makes Studio a stricter language than the tool it drives.
	///
	/// This is the last place that drift can happen. The *grammar* can no longer disagree - Studio
	/// parses with upstream's `CstFile` since 4.8.0, and the differential test that used to guard two
	/// parsers went with the second one ([Q23](../../../docs/decisions.md)). What is still Studio's
	/// own, and so still worth pinning, is which pipelines it calls valid.
	#[tokio::test]
	async fn what_studio_rejects_upstream_rejects_too() {
		let factory = PipelineFactory::new_dummy();
		// Only cases the metadata can actually decide. `operation_from_vpl` does not stop at the
		// grammar - it constructs the operation, so it also fails on things no metadata describes:
		// `from_container filename=a` fails on the missing file, and `from_color color=red` on `red`
		// not being hex. Those are the boundary this validator sits on, and
		// `value_formats_are_not_checked` records it.
		let cases = [
			"from_debug format=png",
			"from_color",
			"from_stacked [ from_debug format=png, from_debug format=png ]",
			// Aliases. These build, and a validator comparing against `enum_variants` reports them -
			// which is the bug this test now exists to catch.
			"from_debug format=pbf",
			"from_debug format=jpeg",
			"from_debug format=png nonsense=1",
			// Neither a variant nor an alias. Caught since 4.9.1 (vt#252); it used to be the one
			// entry in `missed` below.
			"from_debug format=notaformat",
			"from_container",
			"not_an_operation",
			"from_debug format=png | from_debug format=png",
			"raster_overview level=2",
			"from_stacked",
		];

		// **One direction, not both.** Everything Studio underlines must genuinely fail, or the
		// editor tells someone their working pipeline is broken. The reverse is allowed: upstream
		// decides some things only by building, and staying quiet about those is the honest answer.
		let mut wrong = Vec::new();
		let mut missed = Vec::new();
		for vpl in cases {
			let studio_ok = diagnose(vpl).is_empty();
			// `from_container filename=a` opens no file here - the dummy factory builds the operation
			// without reading, which is exactly the layer being checked.
			let upstream_ok = factory.operation_from_vpl(vpl).await.is_ok();
			if !studio_ok && upstream_ok {
				wrong.push(vpl);
			}
			if studio_ok && !upstream_ok {
				missed.push(vpl);
			}
		}

		assert!(wrong.is_empty(), "these build, and Studio underlines them: {wrong:?}");
		// **Empty since 4.9.1.** Every case here that upstream refuses, Studio now underlines. The
		// remaining gap is a value's *format*, which is decided by building rather than by checking
		// (see `value_formats_are_not_checked`) and so has no case in this list. An entry appearing
		// means something stopped being checked.
		assert_eq!(missed, Vec::<&str>::new(), "the set of things not caught changed");
	}
}
