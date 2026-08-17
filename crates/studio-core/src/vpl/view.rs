//! Turning upstream's concrete tree into the flat view the webview reads.
//!
//! `CstFile` keeps every byte, which is what makes it lossless and what makes it awkward to hand
//! straight to a browser: positions are optional until the tree has been reindexed, whitespace and
//! comments hide inside each token's `leading`, and the structure nests. This flattens all of that
//! once, on the Rust side, so the editor and the graph get spans they can rely on.

use super::ast::{Comment, Node, Pipeline, Property, Quote, Span, Str, Token, TokenKind, Value};
use versatiles_pipeline::vpl::{
	CstFile, CstNode, CstPipeline, CstProperty, CstString, CstStringKind, CstToken, CstValue,
};

/// The span of a token that has been through `reindex_spans`.
///
/// Every path here runs on a tree that was just parsed or just reindexed, so a missing span means
/// a bug rather than a state to handle; an empty span keeps that from becoming a panic.
fn span_of(token: &CstToken) -> Span {
	token.span.clone().map_or(Span::new(0, 0), Span::from)
}

fn quote_of(kind: CstStringKind) -> Quote {
	match kind {
		CstStringKind::Bare => Quote::None,
		CstStringKind::Single => Quote::Single,
		CstStringKind::Double => Quote::Double,
	}
}

fn string_of(string: &CstString) -> Str {
	Str {
		value: string.decode(),
		quote: quote_of(string.kind),
		span: span_of(&string.token),
	}
}

/// The flat pipeline, and every comment found in the trivia along the way.
pub fn lower(file: &CstFile) -> (Pipeline, Vec<Comment>) {
	let mut comments = Vec::new();
	let pipeline = lower_pipeline(&file.pipeline, &mut comments);
	trailing_comments(file, &mut comments);
	comments.sort_by_key(|c| c.span.start);
	(pipeline, comments)
}

/// Comments after the last token, which live in `CstFile::trailing` rather than in any token's
/// leading trivia — so a `# note` at the end of a file is invisible to the walk above.
fn trailing_comments(file: &CstFile, out: &mut Vec<Comment>) {
	if !file.trailing.contains('#') {
		return;
	}
	let rendered = file.to_string();
	let start = rendered.len().saturating_sub(file.trailing.len());
	scan_comments(&file.trailing, start, out);
}

fn lower_pipeline(pipeline: &CstPipeline, comments: &mut Vec<Comment>) -> Pipeline {
	let nodes: Vec<Node> = pipeline
		.nodes
		.items
		.iter()
		.map(|item| {
			if let Some(separator) = &item.separator {
				collect_comments(separator, comments);
			}
			lower_node(&item.value, comments)
		})
		.collect();

	let span = match (nodes.first(), nodes.last()) {
		(Some(first), Some(last)) => Span::new(first.span.start, last.span.end),
		_ => Span::new(0, 0),
	};
	Pipeline { nodes, span }
}

fn lower_node(node: &CstNode, comments: &mut Vec<Comment>) -> Node {
	collect_comments(&node.name, comments);
	let name_span = span_of(&node.name);

	let properties: Vec<Property> = node
		.properties
		.iter()
		.map(|property| {
			collect_comments(&property.key, comments);
			collect_comments(&property.equals, comments);
			let key_span = span_of(&property.key);
			let value = lower_value(&property.value, comments);
			Property {
				key: property.key.text.clone(),
				key_span,
				span: Span::new(key_span.start, value.span().end),
				value,
			}
		})
		.collect();

	let (sources, sources_span) = match &node.sources {
		None => (Vec::new(), None),
		Some(block) => {
			collect_comments(&block.open, comments);
			collect_comments(&block.close, comments);
			let pipelines = block
				.pipelines
				.items
				.iter()
				.map(|item| {
					if let Some(separator) = &item.separator {
						collect_comments(separator, comments);
					}
					lower_pipeline(&item.value, comments)
				})
				.collect();
			let span = Span::new(span_of(&block.open).start, span_of(&block.close).end);
			(pipelines, Some(span))
		}
	};

	let end = sources_span.map_or_else(|| properties.last().map_or(name_span.end, |p| p.span.end), |s| s.end);

	Node {
		name: node.name.text.clone(),
		name_span,
		properties,
		sources,
		sources_span,
		span: Span::new(name_span.start, end),
	}
}

fn lower_value(value: &CstValue, comments: &mut Vec<Comment>) -> Value {
	match value {
		CstValue::Single(string) => {
			collect_comments(&string.token, comments);
			Value::Single(string_of(string))
		}
		CstValue::Array(array) => {
			collect_comments(&array.open, comments);
			collect_comments(&array.close, comments);
			let items = array
				.items
				.items
				.iter()
				.map(|item| {
					if let Some(separator) = &item.separator {
						collect_comments(separator, comments);
					}
					collect_comments(&item.value.token, comments);
					string_of(&item.value)
				})
				.collect();
			Value::Array {
				items,
				span: Span::new(span_of(&array.open).start, span_of(&array.close).end),
			}
		}
	}
}

/// Pulls `# …` runs out of a token's leading trivia.
///
/// The trivia occupies the bytes immediately before the token, so a comment's position is derived
/// by counting back from where the token starts.
fn collect_comments(token: &CstToken, out: &mut Vec<Comment>) {
	if !token.leading.contains('#') {
		return;
	}
	scan_comments(
		&token.leading,
		span_of(token).start.saturating_sub(token.leading.len()),
		out,
	);
}

/// Every `# …` run in `trivia`, positioned relative to `start`.
fn scan_comments(trivia: &str, start: usize, out: &mut Vec<Comment>) {
	let mut offset = 0;
	while let Some(hash) = trivia[offset..].find('#') {
		let from = offset + hash;
		let to = trivia[from..].find('\n').map_or(trivia.len(), |n| from + n);
		out.push(Comment {
			text: trivia[from + 1..to].to_string(),
			span: Span::new(start + from, start + to),
		});
		offset = to;
		if offset >= trivia.len() {
			break;
		}
	}
}

// -- highlighting -------------------------------------------------------------------------------

/// Every token, classified. Punctuation comes from the tree's own tokens rather than from the gaps
/// between them — the concrete tree records the `=`, the brackets and the separators, so nothing
/// has to be inferred.
pub fn tokens(file: &CstFile) -> Vec<Token> {
	let mut out = Vec::new();
	pipeline_tokens(&file.pipeline, &mut out);
	let mut trailing = Vec::new();
	trailing_comments(file, &mut trailing);
	out.extend(trailing.into_iter().map(|c| Token {
		kind: TokenKind::Comment,
		span: c.span,
	}));
	out.sort_by_key(|t| t.span.start);
	out
}

fn push(out: &mut Vec<Token>, kind: TokenKind, token: &CstToken) {
	comment_tokens(token, out);
	if !token.text.is_empty() {
		out.push(Token {
			kind,
			span: span_of(token),
		});
	}
}

fn comment_tokens(token: &CstToken, out: &mut Vec<Token>) {
	let mut found = Vec::new();
	collect_comments(token, &mut found);
	out.extend(found.into_iter().map(|c| Token {
		kind: TokenKind::Comment,
		span: c.span,
	}));
}

fn pipeline_tokens(pipeline: &CstPipeline, out: &mut Vec<Token>) {
	for item in &pipeline.nodes.items {
		if let Some(separator) = &item.separator {
			push(out, TokenKind::Punctuation, separator);
		}
		node_tokens(&item.value, out);
	}
}

fn node_tokens(node: &CstNode, out: &mut Vec<Token>) {
	push(out, TokenKind::Operation, &node.name);
	for property in &node.properties {
		push(out, TokenKind::Key, &property.key);
		push(out, TokenKind::Punctuation, &property.equals);
		match &property.value {
			CstValue::Single(string) => push(out, TokenKind::Value, &string.token),
			CstValue::Array(array) => {
				push(out, TokenKind::Punctuation, &array.open);
				for item in &array.items.items {
					if let Some(separator) = &item.separator {
						push(out, TokenKind::Punctuation, separator);
					}
					push(out, TokenKind::Value, &item.value.token);
				}
				push(out, TokenKind::Punctuation, &array.close);
			}
		}
	}
	if let Some(block) = &node.sources {
		push(out, TokenKind::Punctuation, &block.open);
		for item in &block.pipelines.items {
			if let Some(separator) = &item.separator {
				push(out, TokenKind::Punctuation, separator);
			}
			pipeline_tokens(&item.value, out);
		}
		push(out, TokenKind::Punctuation, &block.close);
	}
}

// -- edits --------------------------------------------------------------------------------------

/// Finds the property whose value occupies `span` and rewrites it. Returns whether one was found.
pub fn set_value_at(file: &mut CstFile, span: Span, value: &str) -> bool {
	with_property_at(&mut file.pipeline, span, false, &mut |node, index| {
		node.properties[index].set_value(value);
	})
}

/// Sets a parameter on the node whose *name* occupies `span`, adding it if it is not there.
///
/// `values` with more than one entry becomes a VPL array. The quoting is the tree's, so a path with
/// spaces or a value with an apostrophe is written correctly without the caller thinking about it.
pub fn set_property_at(file: &mut CstFile, span: Span, key: &str, values: &[String]) -> bool {
	with_node_at(&mut file.pipeline, span, &mut |node| {
		if values.len() == 1 {
			node.set_property(key, &values[0]);
		} else {
			// `set_property` only writes single values, so an array is built and swapped in.
			node.remove_property(key);
			let mut property = CstProperty::new(key, "");
			property.value = CstValue::array(values);
			node.properties.push(property);
		}
	})
}

fn with_node_at(pipeline: &mut CstPipeline, span: Span, apply: &mut dyn FnMut(&mut CstNode)) -> bool {
	for item in &mut pipeline.nodes.items {
		if span_of(&item.value.name) == span {
			apply(&mut item.value);
			return true;
		}
		if let Some(block) = &mut item.value.sources {
			for nested in &mut block.pipelines.items {
				if with_node_at(&mut nested.value, span, apply) {
					return true;
				}
			}
		}
	}
	false
}

/// Finds the property occupying `span` and removes it.
pub fn remove_property_at(file: &mut CstFile, span: Span) -> bool {
	with_property_at(&mut file.pipeline, span, true, &mut |node, index| {
		node.properties.remove(index);
	})
}

/// Walks to the property matching `span` — by its whole extent when `by_property`, otherwise by its
/// value — and applies `apply`.
fn with_property_at(
	pipeline: &mut CstPipeline,
	span: Span,
	by_property: bool,
	apply: &mut dyn FnMut(&mut CstNode, usize),
) -> bool {
	for item in &mut pipeline.nodes.items {
		let node = &mut item.value;
		for index in 0..node.properties.len() {
			let property = &node.properties[index];
			let matches = if by_property {
				let key = span_of(&property.key);
				let end = value_span(&property.value).end;
				key.start == span.start && end == span.end
			} else {
				value_span(&property.value) == span
			};
			if matches {
				apply(node, index);
				return true;
			}
		}
		if let Some(block) = &mut node.sources {
			for nested in &mut block.pipelines.items {
				if with_property_at(&mut nested.value, span, by_property, apply) {
					return true;
				}
			}
		}
	}
	false
}

fn value_span(value: &CstValue) -> Span {
	match value {
		CstValue::Single(string) => span_of(&string.token),
		CstValue::Array(array) => Span::new(span_of(&array.open).start, span_of(&array.close).end),
	}
}
