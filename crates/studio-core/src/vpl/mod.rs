//! VPL documents, over upstream's concrete syntax tree.
//!
//! Studio used to carry its own VPL parser, because `versatiles_pipeline` could parse but not print,
//! kept no positions, and dropped comments and parameter order on the way in - none of which a
//! wrapper could recover. That is no longer true: **4.8.0 ships `CstFile`**, a lossless tree with
//! spans, trivia, a serialiser and structural edits, in response to
//! [#216](https://github.com/versatiles-org/versatiles-rs/issues/216),
//! [#217](https://github.com/versatiles-org/versatiles-rs/issues/217) and
//! [#218](https://github.com/versatiles-org/versatiles-rs/issues/218). Studio's parser, printer and
//! the differential test that kept the two honest are all gone ([Q23]).
//!
//! What remains is Studio's own: a flat view of the tree for the webview ([`Pipeline`]), tokens for
//! the editor to paint, `node_at` for selection sync, and [`validate`] - none of which upstream has
//! any reason to carry.
//!
//! **The tree is the document.** [`Document::text`] renders it rather than storing it, so an edit
//! is a change to the tree and the text follows. Comments and layout survive because the tree keeps
//! them as trivia, not because a formatter is careful.
//!
//! [Q23]: ../../../docs/decisions.md

mod ast;
mod operations;
mod semantics;
mod validate;
mod view;

#[cfg(test)]
mod tests;

pub use ast::{Comment, LineCol, Node, Pipeline, Property, Quote, Span, Str, Token, TokenKind, Value};
pub use operations::{Control, FieldInfo, OperationInfo, operations};
pub use semantics::{Lang, Names, Role, role_of};
pub use validate::{Diagnostic, validate};

use std::collections::BTreeSet;
use versatiles_pipeline::vpl::{CstFile, VPLNode, VPLPipeline, parse_cst};

/// A parse failure, positioned. Upstream's error, narrowed to what an editor needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
	pub message: String,
	pub span: Span,
}

impl std::fmt::Display for ParseError {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		write!(f, "{} (at byte {})", self.message, self.span.start)
	}
}

impl std::error::Error for ParseError {}

impl From<versatiles_pipeline::vpl::VplParseError> for ParseError {
	fn from(error: versatiles_pipeline::vpl::VplParseError) -> Self {
		Self {
			message: error.message,
			span: error.span.into(),
		}
	}
}

/// A VPL document: the concrete tree, and the flat view the webview reads.
#[derive(Debug, Clone, PartialEq)]
pub struct Document {
	cst: CstFile,
	text: String,
	view: Pipeline,
	comments: Vec<Comment>,
}

impl Document {
	/// Parses `text`, or reports the first thing wrong with it and where.
	pub fn parse(text: impl Into<String>) -> Result<Self, ParseError> {
		Ok(Self::from_cst(parse_cst(&text.into())?))
	}

	fn from_cst(cst: CstFile) -> Self {
		let text = cst.to_string();
		let (view, comments) = view::lower(&cst);
		Self {
			cst,
			text,
			view,
			comments,
		}
	}

	/// Rebuilds after a structural edit, so every span matches the text again.
	fn rebuilt(mut cst: CstFile) -> Self {
		cst.reindex_spans();
		Self::from_cst(cst)
	}

	/// The document, byte for byte.
	#[must_use]
	pub fn text(&self) -> &str {
		&self.text
	}

	#[must_use]
	pub const fn pipeline(&self) -> &Pipeline {
		&self.view
	}

	/// Every `#` comment, in source order.
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

	/// Every token in the document, in order, for the editor to paint.
	#[must_use]
	pub fn tokens(&self) -> Vec<Token> {
		view::tokens(&self.cst)
	}

	/// Converts a byte offset to the line and column an editor would show.
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
	/// comes back and the document is exactly as it was.
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

	/// Sets the value of the property whose *value* occupies `span`.
	///
	/// The quoting is chosen by the tree rather than the caller, which is the point: a form field
	/// hands over the string a user typed and `CstString` works out whether it needs bare, single or
	/// double quotes - the same rules the serialiser uses, so the two cannot disagree.
	pub fn set_value(&mut self, span: Span, value: &str) -> Result<(), ParseError> {
		let mut cst = self.cst.clone();
		if !view::set_value_at(&mut cst, span, value) {
			return Err(ParseError {
				message: "no value at that position".to_string(),
				span,
			});
		}
		*self = Self::rebuilt(cst);
		Ok(())
	}

	/// Sets a parameter on the node whose *name* occupies `span`, adding it if it is not set.
	///
	/// Addressed by node rather than by property, because the parameter may not exist yet - which is
	/// the whole point: the generated form offers every parameter an operation accepts, not only the
	/// ones already written down.
	pub fn set_property(&mut self, span: Span, key: &str, values: &[String]) -> Result<(), ParseError> {
		let mut cst = self.cst.clone();
		if !view::set_property_at(&mut cst, span, key, values) {
			return Err(ParseError {
				message: "no operation at that position".to_string(),
				span,
			});
		}
		*self = Self::rebuilt(cst);
		Ok(())
	}

	/// Lays the document out again, keeping every comment ([vt#249]).
	///
	/// **Upstream's formatter, on the tree that still has the comments.** `to_string_pretty`
	/// formats the *semantic* pipeline, which has already forgotten them - so before 4.9.1, "format
	/// this" and "keep what I wrote" were exclusive, and offering a Format command meant either
	/// deleting someone's notes or growing a second formatter that would disagree with the first.
	///
	/// Only trivia changes: no node moves, no parameter is reordered, no value is re-quoted. That is
	/// what makes it safe to offer on a document someone is in the middle of editing.
	///
	/// [vt#249]: https://github.com/versatiles-org/versatiles-rs/issues/249
	pub fn format(&mut self) {
		let mut cst = self.cst.clone();
		cst.format();
		// `format` reindexes as it goes; going through `rebuilt` anyway keeps one path from a
		// changed tree to a Document, rather than two that could stop agreeing.
		*self = Self::rebuilt(cst);
	}

	/// Removes the property occupying `span`, together with the whitespace that separated it.
	pub fn remove_property(&mut self, span: Span) -> Result<(), ParseError> {
		let mut cst = self.cst.clone();
		if !view::remove_property_at(&mut cst, span) {
			return Err(ParseError {
				message: "no parameter at that position".to_string(),
				span,
			});
		}
		*self = Self::rebuilt(cst);
		Ok(())
	}

	/// Inserts `operation` into the chain immediately after the node whose name occupies `span`.
	///
	/// Addressed by the name span, like [`set_property`](Self::set_property), because that is what a
	/// selection is. The new node carries no parameters: the generated form is where those are set,
	/// and inventing defaults here would put a second opinion about them next to `field_meta`.
	///
	/// **Textual, not a tree edit.** Inserting ` | filter` at the end of a node's span and reparsing
	/// keeps every comment and every scrap of the author's spacing outside that point, which a
	/// rebuild from the tree would normalise away ([Q11](../../../docs/decisions.md)). Nesting comes
	/// free: a node inside a `[ … ]` block has its span inside the brackets, so the insertion lands
	/// in that chain rather than the outer one.
	///
	/// A read operation inserted mid-chain parses and then fails validation, which is the right
	/// place for it to fail - C4 already marks it, and refusing here would be a second copy of a
	/// rule `validate` owns.
	pub fn insert_after(&mut self, span: Span, operation: &str) -> Result<(), ParseError> {
		let at = self
			.pipeline()
			.node_at(span.start)
			.map(|(_, node)| node.span.end)
			.ok_or_else(|| ParseError {
				message: "no operation at that position".to_string(),
				span,
			})?;
		self.replace(Span { start: at, end: at }, &format!(" | {operation}"))
	}

	/// Removes the node whose name occupies `span`, and the separator that joined it to the chain.
	///
	/// **A comment between two nodes goes with the later one.** In a multi-line pipeline a comment
	/// sits above the node it describes, so removing a node takes the text from the end of its
	/// predecessor - comment included. Removing the *first* node instead takes up to the start of
	/// its successor, which is the one case where that rule cannot hold; there is no predecessor for
	/// the comment to stay with.
	///
	/// Refused when it would empty the chain: an empty pipeline does not parse, so the alternative
	/// is an "unexpected character" error about a document the user never wrote.
	pub fn remove_node(&mut self, span: Span) -> Result<(), ParseError> {
		let missing = || ParseError {
			message: "no operation at that position".to_string(),
			span,
		};
		let cut = {
			let pipeline = self.pipeline();
			let (path, _) = pipeline.node_at(span.start).ok_or_else(missing)?;
			let (parent, index) = pipeline.parent_of(&path).ok_or_else(missing)?;
			if parent.nodes.len() < 2 {
				return Err(ParseError {
					message: "a pipeline needs at least one operation".to_string(),
					span,
				});
			}
			if index > 0 {
				Span {
					start: parent.nodes[index - 1].span.end,
					end: parent.nodes[index].span.end,
				}
			} else {
				Span {
					start: parent.nodes[0].span.start,
					end: parent.nodes[1].span.start,
				}
			}
		};
		self.replace(cut, "")
	}

	/// The tree the pipeline runner wants. Parameter order and comments are dropped here, which is
	/// correct - the runner has no use for either.
	#[must_use]
	pub fn to_pipeline(&self) -> VPLPipeline {
		self.cst.lower()
	}

	/// The same tree with the switched-off nodes taken out ([Q49]).
	///
	/// **What an eye means.** A node whose eye is off is not in the pipeline that runs - so this is
	/// the document minus those nodes, and everything downstream of here builds, mounts, draws and
	/// styles what comes back. `None` means nothing is left to run at all.
	///
	/// **Switching off a chain's head switches off the chain**, because a chain that does not read
	/// anything is not a chain. One level down that is what makes `from_stacked [ a, b ]` become
	/// `from_stacked [ a ]` - the branch leaves the composite and everything after the composite
	/// keeps running, which is the whole reason the eyes are per node rather than a cut point.
	///
	/// Paths are the ones [`Pipeline::node_at`] produces: a node index, then pairs of source and
	/// node index.
	///
	/// [Q49]: ../../../docs/decisions.md
	#[must_use]
	pub fn to_pipeline_without(&self, off: &BTreeSet<Vec<usize>>) -> Option<VPLPipeline> {
		if off.is_empty() {
			return Some(self.to_pipeline());
		}
		strip(self.to_pipeline(), &mut Vec::new(), off)
	}
}

/// One chain with its switched-off nodes removed, or `None` when nothing is left of it.
fn strip(pipeline: VPLPipeline, path: &mut Vec<usize>, off: &BTreeSet<Vec<usize>>) -> Option<VPLPipeline> {
	let mut kept: Vec<VPLNode> = Vec::new();
	for (index, mut node) in pipeline.pipeline.into_iter().enumerate() {
		path.push(index);
		if off.contains(path.as_slice()) {
			path.pop();
			// The head, so the whole chain goes: what follows it has nothing to read.
			if index == 0 {
				return None;
			}
			continue;
		}
		let sources = std::mem::take(&mut node.sources);
		node.sources = sources
			.into_iter()
			.enumerate()
			.filter_map(|(source, chain)| {
				path.push(source);
				let kept = strip(chain, path, off);
				path.pop();
				kept
			})
			.collect();
		kept.push(node);
		path.pop();
	}
	(!kept.is_empty()).then(|| VPLPipeline::new(kept))
}

impl std::fmt::Display for Document {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		f.write_str(&self.text)
	}
}

/// The VPL that reads `source` with `operation` - the node an opened file corresponds to.
///
/// Under [Q22](../../../docs/decisions.md) an opened file *is* a read node at the head of the
/// pipeline; there is no separate list of sources. The quoting comes from the tree, so a path with
/// spaces or apostrophes is written correctly without the caller thinking about it.
///
/// Which operation to pass is [`import::kind_for`](crate::import::kind_for)'s answer - a container
/// becomes `from_container`, a GeoJSON `from_geo`, a CSV `from_csv` (S3.2).
#[must_use]
pub fn read_node(operation: &str, source: &str) -> String {
	read_node_with(operation, source, &[])
}

/// [`read_node`], plus parameters the caller already knows the answers to.
///
/// What a CSV's coordinate columns are called is knowable from its header, and an import that fills
/// them in is a working pipeline rather than a form with two required fields and no clue what goes
/// in them (S3.4). The quoting is still the tree's, which matters here more than for a path: a
/// delimiter can be a tab.
#[must_use]
pub fn read_node_with(operation: &str, source: &str, extra: &[(&str, &str)]) -> String {
	use versatiles_pipeline::vpl::{CstNode, CstPipeline, CstToken, Punctuated};
	let mut node = CstNode::new(operation);
	// Which parameter the source answers is the operation's to say: `from_tilejson` takes a `url`
	// and would not parse with a `filename`.
	node.set_property(&crate::import::source_parameter(operation), source);
	for (key, value) in extra {
		node.set_property(key, value);
	}
	CstFile::new(CstPipeline {
		nodes: Punctuated::new([node], &CstToken::new(" | ")),
	})
	.to_string()
}
