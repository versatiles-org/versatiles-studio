//! VPL document model — a lossless syntax tree keeping spans, comments and parameter order (Q11).
//!
//! **The text is the document.** The tree holds byte spans into it rather than replacing it, so a
//! parsed document printed back out is the same bytes, and a structured edit is a splice at a span
//! — which means everything the edit did not touch, comments and layout included, survives by
//! construction rather than by a formatter's good behaviour. That is what makes Q11's "text is the
//! source of truth, the graph is a view onto it" true in the data structure and not just in prose.
//!
//! Two ways in, for the two editing surfaces S2 builds:
//!
//! * The **text editor** (S2.3, S2.4) owns its buffer and calls [`Document::parse`] as the user
//!   types, showing [`ParseError`]s where they fall. A document is never invalid; a *buffer* is.
//! * The **graph and parameter forms** (S2.5, S2.6) hold a valid `Document` and change it through
//!   [`Document::replace`], which reparses and refuses anything that would not survive the trip.
//!
//! [`Document::to_pipeline`] converts to upstream's `VPLPipeline` for execution. Everything Studio
//! keeps extra is dropped there, which is correct — the runner has no use for a comment.

mod ast;
mod parse;
mod print;

#[cfg(test)]
mod differential;
#[cfg(test)]
mod tests;

pub use ast::{Comment, LineCol, Node, Pipeline, Property, Quote, Span, Str, Value};
pub use parse::ParseError;
pub use print::quote_value;

use std::collections::BTreeMap;
use versatiles_pipeline::vpl::{VPLNode, VPLPipeline};

/// A VPL document: the text, and a tree that points into it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Document {
	text: String,
	pipeline: Pipeline,
	comments: Vec<Comment>,
}

impl Document {
	/// Parses `text`, or reports the first thing wrong with it and where.
	pub fn parse(text: impl Into<String>) -> Result<Self, ParseError> {
		let text = text.into();
		let (pipeline, comments) = parse::Parser::new(&text).parse_document()?;
		Ok(Self {
			text,
			pipeline,
			comments,
		})
	}

	/// The document, byte for byte as it was written.
	#[must_use]
	pub fn text(&self) -> &str {
		&self.text
	}

	#[must_use]
	pub const fn pipeline(&self) -> &Pipeline {
		&self.pipeline
	}

	/// Every `#` comment, in source order. Upstream discards these.
	#[must_use]
	pub fn comments(&self) -> &[Comment] {
		&self.comments
	}

	/// The source text a span covers.
	///
	/// Returns `None` for a span that is out of range or lands mid-character, so a stale span from
	/// before an edit cannot panic the caller.
	#[must_use]
	pub fn slice(&self, span: Span) -> Option<&str> {
		self.text.get(span.start..span.end)
	}

	/// Converts a byte offset to the line and column an editor would show.
	///
	/// Offsets past the end clamp to the last position rather than failing: a caret at the end of
	/// the buffer is a real place to be.
	#[must_use]
	pub fn line_col(&self, offset: usize) -> LineCol {
		let offset = offset.min(self.text.len());
		let before = &self.text[..offset];
		let line = before.matches('\n').count() + 1;
		let line_start = before.rfind('\n').map_or(0, |i| i + 1);
		LineCol {
			line,
			column: self.text[line_start..offset].chars().count() + 1,
		}
	}

	/// Replaces the text under `span` and reparses.
	///
	/// **Either the whole edit lands or nothing does.** If the result would not parse, the error
	/// comes back and the document is exactly as it was — the same discipline as
	/// [`Bookmarks::load`](crate::store::Bookmarks::load), and for the same reason: a half-applied
	/// edit is worse than a refused one. Error spans are relative to the *attempted* text, which is
	/// what a caller wanting to explain the failure needs.
	pub fn replace(&mut self, span: Span, replacement: &str) -> Result<(), ParseError> {
		let mut candidate = String::with_capacity(self.text.len() + replacement.len());
		candidate.push_str(self.text.get(..span.start).ok_or_else(|| ParseError {
			message: "the span starts outside the document".to_string(),
			span,
		})?);
		candidate.push_str(replacement);
		candidate.push_str(self.text.get(span.end..).ok_or_else(|| ParseError {
			message: "the span ends outside the document".to_string(),
			span,
		})?);

		*self = Self::parse(candidate)?;
		Ok(())
	}

	/// The tree upstream's pipeline runner wants.
	///
	/// This is where the extra information is deliberately dropped. Two things happen that are not
	/// obvious, and both exist to match `parse_vpl` exactly rather than to be tidy: parameters
	/// collapse into a `BTreeMap`, so their order is lost; and repeated keys concatenate their
	/// values instead of the last one winning.
	#[must_use]
	pub fn to_pipeline(&self) -> VPLPipeline {
		to_pipeline(&self.pipeline)
	}
}

impl std::fmt::Display for Document {
	/// The original text — a `Document` is its text.
	///
	/// For the canonical rendering of a tree, print [`Document::pipeline`] instead.
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		f.write_str(&self.text)
	}
}

/// The VPL that reads `source` — the read node an opened container corresponds to.
///
/// Under [Q22](../../../docs/decisions.md) an opened container *is* a `from_container` node at the
/// head of the pipeline; there is no separate list of sources. This builds that node.
///
/// It lives in the core rather than the webview so the quoting rules stay in one place, next to the
/// parser that defines them. Returns `None` for an empty source, which VPL cannot express.
#[must_use]
pub fn read_node_for(source: &str) -> Option<String> {
	Some(format!("from_container filename={}", quote_value(source)?))
}

fn to_pipeline(pipeline: &Pipeline) -> VPLPipeline {
	VPLPipeline::new(pipeline.nodes.iter().map(to_node).collect())
}

fn to_node(node: &Node) -> VPLNode {
	let mut properties: BTreeMap<String, Vec<String>> = BTreeMap::new();
	for property in &node.properties {
		properties
			.entry(property.key.clone())
			.or_default()
			.extend(property.value.strings());
	}
	VPLNode {
		name: node.name.clone(),
		properties,
		sources: node.sources.iter().map(to_pipeline).collect(),
	}
}
