//! A recursive-descent parser for VPL that records where everything is.
//!
//! **This deliberately reimplements a grammar that already exists upstream**, which needs
//! justifying. `versatiles_pipeline`'s parser is built on nom combinators that discard as they go:
//! `ws0` swallows comments with `value((), …)`, properties land in a `BTreeMap` that sorts and
//! merges them, and nothing anywhere records an offset. None of that is reachable by wrapping it —
//! the information is gone before the parser returns. Studio needs all three to put an error under
//! the right character (C4) and to keep a graph selection and a text caret pointing at the same
//! thing (C1, S2.5), so the grammar has to be walked again.
//!
//! The risk that creates is drift: a Studio that accepts VPL the CLI rejects, or the reverse, is
//! worse than no editor at all. `differential.rs` holds that shut — every case runs through both
//! parsers and both must agree, on acceptance and on the resulting tree.
//!
//! The grammar, as implemented upstream:
//!
//! ```text
//! pipeline := ws0 node (ws0 '|' ws0 node)* ws0
//! node     := ws0 ident ws0 (property (ws1 property)*)? ws0 sources? ws0
//! sources  := '[' ws0 (pipeline (ws0 ',' ws0 pipeline)*)? ws0 ']'
//! property := ident ws0 '=' ws0 value
//! value    := array | string
//! array    := '[' ws0 (string (ws0 ',' ws0 string)*)? ws0 ']'
//! string   := '"' … '"' | '\'' … '\'' | unquoted
//! ws0/ws1  := (whitespace | '#' …)*
//! ```

use super::ast::{Comment, Node, Pipeline, Property, Quote, Span, Str, Value};

/// A parse failure, positioned.
///
/// One span and one sentence: upstream renders nom's `VerboseError` into a multi-line trace with no
/// offsets, which reads well in a terminal and is useless to an editor that wants to underline
/// something.
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

type PResult<T> = Result<T, ParseError>;

/// Characters allowed in a bare, unquoted value. Public so the printer can ask the same question
/// the parser does, rather than keeping a second copy of the answer.
#[must_use]
pub fn is_unquoted_char(c: char) -> bool {
	c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')
}

/// Characters allowed after the first in an identifier.
fn is_ident_tail(c: char) -> bool {
	c.is_ascii_alphanumeric() || matches!(c, '_' | '-')
}

pub struct Parser<'a> {
	input: &'a str,
	pos: usize,
	comments: Vec<Comment>,
}

impl<'a> Parser<'a> {
	pub fn new(input: &'a str) -> Self {
		Self {
			input,
			pos: 0,
			comments: Vec::new(),
		}
	}

	/// Parses a whole document, which must be one pipeline and nothing else.
	pub fn parse_document(mut self) -> PResult<(Pipeline, Vec<Comment>)> {
		let pipeline = self.pipeline()?;
		self.ws0();
		if self.pos < self.input.len() {
			return Err(self.error_here("unexpected input after the end of the pipeline"));
		}
		Ok((pipeline, self.comments))
	}

	// -- primitives ------------------------------------------------------------------------------

	fn rest(&self) -> &'a str {
		&self.input[self.pos..]
	}

	fn peek(&self) -> Option<char> {
		self.rest().chars().next()
	}

	fn at(&self, c: char) -> bool {
		self.peek() == Some(c)
	}

	fn bump(&mut self) -> Option<char> {
		let c = self.peek()?;
		self.pos += c.len_utf8();
		Some(c)
	}

	fn eat(&mut self, c: char) -> bool {
		if self.at(c) {
			self.pos += c.len_utf8();
			true
		} else {
			false
		}
	}

	fn take_while(&mut self, mut f: impl FnMut(char) -> bool) -> &'a str {
		let start = self.pos;
		while let Some(c) = self.peek() {
			if !f(c) {
				break;
			}
			self.pos += c.len_utf8();
		}
		&self.input[start..self.pos]
	}

	/// A point to rewind to.
	///
	/// The position alone is not enough: `ws0` collects comments as a side effect, so rewinding past
	/// one and re-scanning it would record it twice. Both halves have to move together.
	fn checkpoint(&self) -> (usize, usize) {
		(self.pos, self.comments.len())
	}

	fn rewind(&mut self, (pos, comments): (usize, usize)) {
		self.pos = pos;
		self.comments.truncate(comments);
	}

	fn error_here(&self, message: impl Into<String>) -> ParseError {
		// A zero-width span at the offending position, widened to one character where there is one,
		// so an editor has something to underline rather than a caret in the void.
		let end = self.peek().map_or(self.pos, |c| self.pos + c.len_utf8());
		ParseError {
			message: message.into(),
			span: Span::new(self.pos, end),
		}
	}

	/// Whitespace and comments, any amount including none.
	fn ws0(&mut self) -> bool {
		let start = self.pos;
		loop {
			let before = self.pos;
			self.take_while(char::is_whitespace);
			if self.at('#') {
				let hash = self.pos;
				self.bump();
				let text = self.take_while(|c| c != '\n').to_string();
				self.comments.push(Comment {
					text,
					span: Span::new(hash, self.pos),
				});
			}
			if self.pos == before {
				break;
			}
		}
		self.pos != start
	}

	/// Identifier: an ASCII letter, then letters, digits, `_` or `-`.
	fn ident(&mut self) -> Option<(String, Span)> {
		let start = self.pos;
		let first = self.peek()?;
		if !first.is_ascii_alphabetic() {
			return None;
		}
		self.bump();
		self.take_while(is_ident_tail);
		Some((self.input[start..self.pos].to_string(), Span::new(start, self.pos)))
	}

	// -- strings ---------------------------------------------------------------------------------

	fn string(&mut self) -> PResult<Str> {
		match self.peek() {
			Some('"') => self.double_quoted(),
			Some('\'') => self.single_quoted(),
			_ => self.unquoted(),
		}
	}

	fn unquoted(&mut self) -> PResult<Str> {
		let start = self.pos;
		let value = self.take_while(is_unquoted_char).to_string();
		if value.is_empty() {
			return Err(self.error_here("expected a value"));
		}
		Ok(Str {
			value,
			quote: Quote::None,
			span: Span::new(start, self.pos),
		})
	}

	/// `'…'` — everything up to the closing quote, verbatim. No escapes, so a `'` cannot appear.
	fn single_quoted(&mut self) -> PResult<Str> {
		let start = self.pos;
		self.bump();
		let value = self.take_while(|c| c != '\'').to_string();
		// Upstream uses `is_not("'")`, which demands at least one character — so `''` is a parse
		// error there, and must be one here too. Empty strings are written `""`.
		if value.is_empty() {
			return Err(self.error_here("a single-quoted string cannot be empty — write \"\""));
		}
		if !self.eat('\'') {
			return Err(self.error_here("unterminated single-quoted string"));
		}
		Ok(Str {
			value,
			quote: Quote::Single,
			span: Span::new(start, self.pos),
		})
	}

	/// `"…"` with `\\`, `\"`, `\n` and `\t`.
	///
	/// Needs at least one character or escape. Upstream's `escaped_transform` fails on an empty
	/// body, so `""` is a parse error there — which, together with `''` being one too, means **VPL
	/// has no way to write an empty string at all**. Studio reproduces the gap rather than inventing
	/// a spelling for it; see `quote_value`.
	fn double_quoted(&mut self) -> PResult<Str> {
		let start = self.pos;
		self.bump();
		let mut value = String::new();
		let mut elements = 0usize;
		loop {
			match self.bump() {
				None => return Err(self.error_here("unterminated double-quoted string")),
				Some('"') if elements == 0 => {
					return Err(ParseError {
						message: "VPL has no empty string — remove the parameter instead".to_string(),
						span: Span::new(start, self.pos),
					});
				}
				Some('"') => break,
				Some('\\') => {
					elements += 1;
					let escape_start = self.pos - 1;
					match self.bump() {
						Some('\\') => value.push('\\'),
						Some('"') => value.push('"'),
						Some('n') => value.push('\n'),
						Some('t') => value.push('\t'),
						_ => {
							return Err(ParseError {
								message: "unknown escape — VPL understands \\\\, \\\", \\n and \\t".to_string(),
								span: Span::new(escape_start, self.pos),
							});
						}
					}
				}
				Some(c) => {
					elements += 1;
					value.push(c);
				}
			}
		}
		Ok(Str {
			value,
			quote: Quote::Double,
			span: Span::new(start, self.pos),
		})
	}

	// -- values ----------------------------------------------------------------------------------

	fn value(&mut self) -> PResult<Value> {
		if self.at('[') {
			let start = self.pos;
			self.bump();
			self.ws0();
			let mut items = Vec::new();
			if !self.at(']') {
				loop {
					items.push(self.string()?);
					self.ws0();
					if !self.eat(',') {
						break;
					}
					self.ws0();
				}
			}
			self.ws0();
			if !self.eat(']') {
				return Err(self.error_here("expected ']' to close the array"));
			}
			Ok(Value::Array {
				items,
				span: Span::new(start, self.pos),
			})
		} else {
			self.string().map(Value::Single)
		}
	}

	// -- properties ------------------------------------------------------------------------------

	/// One `key=value`, on the understanding that an identifier has already been seen.
	///
	/// Upstream wraps everything after the key in `cut`, so once a bare word appears where a
	/// parameter belongs there is no backing out: `read foo` is an error, not a node called `read`
	/// with `foo` left over. Committing here is what reproduces that.
	fn property(&mut self) -> PResult<Property> {
		let (key, key_span) = self
			.ident()
			.ok_or_else(|| self.error_here("expected a parameter name"))?;
		self.ws0();
		if !self.eat('=') {
			return Err(self.error_here(format!("expected '=' after the parameter '{key}'")));
		}
		self.ws0();
		let value = self.value()?;
		Ok(Property {
			key,
			key_span,
			span: Span::new(key_span.start, value.span().end),
			value,
		})
	}

	// -- nodes and pipelines ---------------------------------------------------------------------

	fn node(&mut self) -> PResult<Node> {
		self.ws0();
		let (name, name_span) = self
			.ident()
			.ok_or_else(|| self.error_here("expected an operation name"))?;

		let mut properties = Vec::new();
		loop {
			// Parameters must be separated by whitespace, and the separator only counts if a
			// parameter really follows — otherwise the space before a `[…]` block would be eaten.
			let checkpoint = self.checkpoint();
			self.ws0();
			if !self.starts_ident() {
				self.rewind(checkpoint);
				break;
			}
			properties.push(self.property()?);
		}

		self.ws0();
		let (sources, sources_span) = self.sources()?;
		let end = sources_span.map_or_else(|| properties.last().map_or(name_span.end, |p| p.span.end), |s| s.end);

		Ok(Node {
			name,
			name_span,
			properties,
			sources,
			sources_span,
			span: Span::new(name_span.start, end),
		})
	}

	fn starts_ident(&self) -> bool {
		self.peek().is_some_and(|c| c.is_ascii_alphabetic())
	}

	fn sources(&mut self) -> PResult<(Vec<Pipeline>, Option<Span>)> {
		if !self.at('[') {
			return Ok((Vec::new(), None));
		}
		let start = self.pos;
		self.bump();
		self.ws0();
		let mut pipelines = Vec::new();
		if !self.at(']') {
			loop {
				pipelines.push(self.pipeline()?);
				self.ws0();
				if !self.eat(',') {
					break;
				}
				self.ws0();
			}
		}
		self.ws0();
		if !self.eat(']') {
			return Err(self.error_here("expected ']' to close the source list"));
		}
		Ok((pipelines, Some(Span::new(start, self.pos))))
	}

	fn pipeline(&mut self) -> PResult<Pipeline> {
		self.ws0();
		let start = self.pos;
		let mut nodes = vec![self.node()?];
		loop {
			let checkpoint = self.checkpoint();
			self.ws0();
			if !self.eat('|') {
				self.rewind(checkpoint);
				break;
			}
			self.ws0();
			nodes.push(self.node()?);
		}
		let end = nodes.last().map_or(start, |n| n.span.end);
		Ok(Pipeline {
			nodes,
			span: Span::new(start, end),
		})
	}
}
