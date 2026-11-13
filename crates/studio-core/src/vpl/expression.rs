//! A feature expression, as the expression helper asks about it: `vector_branch`'s and
//! `vector_filter_features`'s `expr`.
//!
//! **Upstream's answer, re-addressed.** `check_expression` ([vt#327]) says what is wrong and where,
//! what to colour, and what a compiling expression reads, using the compiler building uses. Studio
//! changes two things on the way to the webview: positions are counted in UTF-16 units, which is
//! what a JavaScript string is indexed by, where upstream counts characters; and the kinds and the
//! scope are words, so the webview needs no copy of upstream's enums.
//!
//! [vt#327]: https://github.com/versatiles-org/versatiles-rs/issues/327

use serde::Serialize;
use versatiles_pipeline::{ExpressionScope as UpstreamScope, check_expression as upstream_check};

/// What a check of an expression found.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct ExpressionCheck {
	/// What is wrong, each with where. Empty when the expression compiles.
	pub problems: Vec<ExpressionProblem>,
	/// Its tokens, for highlighting. There even when it does not compile.
	pub tokens: Vec<ExpressionToken>,
	/// What it reads, when it compiles.
	pub reads: Option<ExpressionReads>,
}

/// Something wrong with an expression, and the text it covers.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct ExpressionProblem {
	/// What is wrong, without the expression or the position.
	pub message: String,
	/// UTF-16 offsets into the text, `end` exclusive. Equal where something is missing, such as the
	/// value after a trailing `==`.
	#[cfg_attr(feature = "bindings", specta(type = u32))]
	pub start: usize,
	#[cfg_attr(feature = "bindings", specta(type = u32))]
	pub end: usize,
}

/// One token: what it is, for colouring it, and where.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct ExpressionToken {
	/// Upstream's word for it: `special` for a `$` name, `property`, `function`, `operator`,
	/// `string`, `number`, `bool`, `null`, `bracket`, `punctuation`, `comment` or `unknown`.
	pub kind: String,
	/// UTF-16 offsets into the text, `end` exclusive.
	#[cfg_attr(feature = "bindings", specta(type = u32))]
	pub start: usize,
	#[cfg_attr(feature = "bindings", specta(type = u32))]
	pub end: usize,
}

/// What a compiling expression reads, and so how much of a tile its answer depends on.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct ExpressionReads {
	/// The `$` names it reads, `$` included, in upstream's order.
	pub names: Vec<String>,
	/// The properties it reads by their own names, sorted. One read through `$props` is not listed.
	pub properties: Vec<String>,
	pub scope: ExpressionScope,
}

/// How much of a tile an expression's answer depends on. Below `feature`, the answer is reached
/// without decoding the tile's features.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub enum ExpressionScope {
	/// One answer for the whole tile.
	Tile,
	/// One answer per layer.
	Layer,
	/// An answer per feature.
	Feature,
}

/// Checks `text` as a feature expression, without building anything.
///
/// Compiling a malformed expression can still print a panic to the terminal for a shape upstream
/// has not caught yet; the answer is the same either way.
#[must_use]
pub fn check_expression(text: &str) -> ExpressionCheck {
	let check = upstream_check(text);
	let at = Utf16::of(text);
	ExpressionCheck {
		problems: check
			.problems
			.into_iter()
			.map(|problem| ExpressionProblem {
				message: problem.message,
				start: at.offset(problem.start),
				end: at.offset(problem.end),
			})
			.collect(),
		tokens: check
			.tokens
			.into_iter()
			.map(|token| ExpressionToken {
				kind: token.kind.as_str().to_string(),
				start: at.offset(token.start),
				end: at.offset(token.end),
			})
			.collect(),
		reads: check.reads.map(|reads| ExpressionReads {
			names: reads.names.into_iter().map(String::from).collect(),
			properties: reads.properties,
			scope: match reads.scope {
				UpstreamScope::Tile => ExpressionScope::Tile,
				UpstreamScope::Layer => ExpressionScope::Layer,
				UpstreamScope::Feature => ExpressionScope::Feature,
			},
		}),
	}
}

/// Where each character of a text starts in UTF-16 units, and where the text ends.
struct Utf16(Vec<usize>);

impl Utf16 {
	fn of(text: &str) -> Self {
		let mut starts = Vec::with_capacity(text.len() + 1);
		let mut unit = 0;
		for c in text.chars() {
			starts.push(unit);
			unit += c.len_utf16();
		}
		starts.push(unit);
		Utf16(starts)
	}

	/// The UTF-16 offset of character `index`. Past the end is the end: an offset from upstream is
	/// never trusted to index anything.
	fn offset(&self, index: usize) -> usize {
		self
			.0
			.get(index)
			.copied()
			.unwrap_or_else(|| *self.0.last().unwrap_or(&0))
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_compiling_expression_says_what_it_reads() {
		let check = check_expression("$layer == 'poi' && kind == 'a'");
		assert!(check.problems.is_empty());
		let reads = check.reads.unwrap();
		assert_eq!(reads.names, ["$layer"]);
		assert_eq!(reads.properties, ["kind"]);
		assert_eq!(reads.scope, ExpressionScope::Feature);
		assert_eq!(
			check_expression("$zoom > 3").reads.unwrap().scope,
			ExpressionScope::Tile
		);
	}

	/// A trailing operator is the common case while typing, and it says where the value is missing.
	#[test]
	fn a_broken_expression_says_what_and_where() {
		let check = check_expression("$layer ==");
		assert!(check.reads.is_none());
		let [problem] = check.problems.as_slice() else {
			panic!("one problem: {:?}", check.problems);
		};
		assert!(!problem.message.is_empty());
		assert!(problem.start <= 9 && problem.end <= 9, "{problem:?}");
		assert!(!problem.message.contains("<input>"), "{}", problem.message);
	}

	#[test]
	fn tokens_say_what_to_colour_even_when_it_does_not_compile() {
		let kinds: Vec<_> = check_expression("$zoom >= 'a")
			.tokens
			.into_iter()
			.map(|token| (token.kind, token.start, token.end))
			.collect();
		assert_eq!(
			kinds,
			[
				("special".to_string(), 0, 5),
				("operator".to_string(), 6, 8),
				("string".to_string(), 9, 11)
			]
		);
	}

	/// JavaScript indexes a string in UTF-16 units, so an emoji before a token is two, not one.
	#[test]
	fn positions_count_utf16_units() {
		let check = check_expression("'🙂' == kind");
		let property = check.tokens.iter().find(|token| token.kind == "property").unwrap();
		assert_eq!((property.start, property.end), (8, 12));
		assert_eq!("'🙂' == kind".encode_utf16().count(), 12);
	}
}
