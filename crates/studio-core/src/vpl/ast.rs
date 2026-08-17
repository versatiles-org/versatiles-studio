//! The syntax tree: every part of it knows where it came from.
//!
//! Upstream's `VPLNode` is a *semantic* tree — it holds what the pipeline runner needs and throws
//! the rest away. This is a *syntactic* one. The difference is three things it keeps: byte spans,
//! comments, and the order the author wrote parameters in.

use serde::{Deserialize, Serialize};

/// A byte range in the document, `start..end`.
///
/// Byte offsets rather than character indices because that is what text editors, `str` slicing and
/// LSP-shaped protocols all speak. The parser only ever splits on character boundaries, so slicing
/// with one cannot panic.
///
/// `Deserialize` too: a span makes the round trip out to a form field and back when the webview
/// asks for the value under it to be changed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
	pub start: usize,
	pub end: usize,
}

impl Span {
	#[must_use]
	pub const fn new(start: usize, end: usize) -> Self {
		Self { start, end }
	}

	#[must_use]
	pub const fn len(&self) -> usize {
		self.end - self.start
	}

	#[must_use]
	pub const fn is_empty(&self) -> bool {
		self.start == self.end
	}

	/// Whether `offset` falls inside the span, counting the end as inside.
	///
	/// Inclusive at the end because a caret sitting just after a token is still "in" it as far as a
	/// user is concerned — click past the last character of a node name and you meant that node.
	#[must_use]
	pub const fn contains(&self, offset: usize) -> bool {
		self.start <= offset && offset <= self.end
	}
}

/// How a string was written. Preserved so a round trip does not silently re-quote the author.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Quote {
	/// Bare, e.g. `mvt` or `13.4`.
	None,
	/// `'…'` — no escape processing.
	Single,
	/// `"…"` — `\\`, `\"`, `\n` and `\t` are unescaped.
	Double,
}

/// One string literal: what it means, how it was written, and where it sits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Str {
	/// The decoded value — escapes resolved, quotes removed.
	pub value: String,
	pub quote: Quote,
	/// Covers the quotes, where there are any.
	pub span: Span,
}

/// A parameter value: one string, or a bracketed list of them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Value {
	Single(Str),
	Array { items: Vec<Str>, span: Span },
}

impl Value {
	#[must_use]
	pub const fn span(&self) -> Span {
		match self {
			Self::Single(s) => s.span,
			Self::Array { span, .. } => *span,
		}
	}

	/// The values, flattened — the shape the pipeline runner wants.
	#[must_use]
	pub fn strings(&self) -> Vec<String> {
		match self {
			Self::Single(s) => vec![s.value.clone()],
			Self::Array { items, .. } => items.iter().map(|s| s.value.clone()).collect(),
		}
	}
}

/// One `key=value` pair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Property {
	pub key: String,
	pub key_span: Span,
	pub value: Value,
	/// `key` through the end of the value.
	pub span: Span,
}

/// One operation, its parameters, and any nested pipelines feeding it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
	pub name: String,
	pub name_span: Span,
	/// **In source order, with duplicates kept.** Upstream stores a `BTreeMap`, which sorts the
	/// keys and merges repeats; rewriting a file through that would reorder parameters the author
	/// deliberately arranged. Semantic lookups go through [`Node::property`], which applies
	/// upstream's merge rule without disturbing what is stored here.
	pub properties: Vec<Property>,
	/// Nested pipelines from the `[…]` block, if there is one.
	pub sources: Vec<Pipeline>,
	/// The `[…]` block itself, brackets included.
	pub sources_span: Option<Span>,
	/// Name through the end of the sources block.
	pub span: Span,
}

impl Node {
	/// Every value recorded for `key`, in source order.
	///
	/// Repeats are concatenated rather than overriding, because that is what upstream's parser does
	/// when it folds the property list into its map — `a=1 a=2` means `[1, 2]`, not `2`.
	#[must_use]
	pub fn property(&self, key: &str) -> Vec<String> {
		self
			.properties
			.iter()
			.filter(|p| p.key == key)
			.flat_map(|p| p.value.strings())
			.collect()
	}

	/// The innermost node containing `offset`, and the path taken to reach it.
	///
	/// The path is the index at each level of nesting, so a caller can address the node again after
	/// an edit. Nested pipelines win over their parent: a caret inside a source block belongs to the
	/// node it is written inside, not the one it feeds.
	#[must_use]
	pub fn node_at(&self, offset: usize) -> Option<(Vec<usize>, &Self)> {
		if !self.span.contains(offset) {
			return None;
		}
		for (i, pipeline) in self.sources.iter().enumerate() {
			if let Some((mut path, node)) = pipeline.node_at(offset) {
				let mut full = vec![i];
				full.append(&mut path);
				return Some((full, node));
			}
		}
		Some((vec![], self))
	}
}

/// A chain of nodes, `a | b | c`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pipeline {
	pub nodes: Vec<Node>,
	pub span: Span,
}

impl Pipeline {
	/// The innermost node containing `offset`, with the path of indices that reaches it.
	///
	/// This is what makes a graph selection and a text caret the same thing (S2.5).
	#[must_use]
	pub fn node_at(&self, offset: usize) -> Option<(Vec<usize>, &Node)> {
		for (i, node) in self.nodes.iter().enumerate() {
			if let Some((mut path, found)) = node.node_at(offset) {
				let mut full = vec![i];
				full.append(&mut path);
				return Some((full, found));
			}
		}
		None
	}

	/// Follows a path produced by [`Pipeline::node_at`].
	#[must_use]
	pub fn node_at_path(&self, path: &[usize]) -> Option<&Node> {
		let (&first, rest) = path.split_first()?;
		let mut node = self.nodes.get(first)?;
		for pair in rest.chunks(2) {
			match pair {
				[source, index] => node = node.sources.get(*source)?.nodes.get(*index)?,
				_ => return None,
			}
		}
		Some(node)
	}
}

/// A `# …` comment: discarded by upstream, kept here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
	/// The text after `#`, up to but not including the newline.
	pub text: String,
	/// Covers the `#`.
	pub span: Span,
}

/// A position a human can act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineCol {
	/// 1-based, as every editor counts them.
	pub line: usize,
	/// 1-based, counted in characters rather than bytes so a line of CJK does not report column 40
	/// for the thirteenth character.
	pub column: usize,
}
