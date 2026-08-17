//! Turning a tree back into text.
//!
//! Two different jobs hide behind the word "serialise", and conflating them is how a formatter
//! quietly eats a user's comments:
//!
//! * [`Document::text`](super::Document::text) returns the original bytes. A parsed-then-printed
//!   document is the identity, because the text never stopped being the document.
//! * `Display`, here, renders a **canonical** form: one space between parameters, ` | ` between
//!   nodes, no comments. This is for trees Studio *builds* — a node the graph editor just added has
//!   no text to preserve.
//!
//! Quote style is carried through where it still fits, so printing a tree that came from text does
//! not rewrite `'a'` into `a` for no reason.

use super::ast::{Node, Pipeline, Property, Quote, Str, Value};
use std::fmt;

/// Renders a value with the least punctuation that parses back to the same string, or `None` if VPL
/// cannot express it.
///
/// Preference order is bare, then single quotes, then double. Single quotes have no escape
/// mechanism, so a value containing one goes to double quotes.
///
/// **`None` means the empty string, and it is the only such value.** Both quote forms need at least
/// one character — `''` because upstream matches the body with `is_not`, `""` because it uses
/// `escaped_transform` — so there is no spelling for it anywhere in the grammar. Callers have to
/// decide what an empty form field means; the honest reading is "remove the parameter", since a
/// parameter that is present but blank is not a state VPL has. Returning `None` forces that choice
/// to be made rather than writing a file that will not parse.
#[must_use]
pub fn quote_value(value: &str) -> Option<String> {
	if value.is_empty() {
		return None;
	}
	if value.chars().all(super::parse::is_unquoted_char) {
		return Some(value.to_string());
	}
	if !value.contains('\'') {
		return Some(format!("'{value}'"));
	}
	Some(quote_double(value))
}

/// Double quotes, escaping the four sequences the grammar understands.
fn quote_double(value: &str) -> String {
	let mut out = String::with_capacity(value.len() + 2);
	out.push('"');
	for c in value.chars() {
		match c {
			'\\' => out.push_str("\\\\"),
			'"' => out.push_str("\\\""),
			'\n' => out.push_str("\\n"),
			'\t' => out.push_str("\\t"),
			_ => out.push(c),
		}
	}
	out.push('"');
	out
}

impl fmt::Display for Str {
	/// Honours how the value was written, while that spelling is still valid — the value may have
	/// been edited since it was parsed.
	///
	/// Fails for the empty string, which no spelling covers. Parsing can never produce one, so
	/// reaching this is a bug in whatever built the tree rather than bad input; [`quote_value`]
	/// reports the same condition without panicking, and is the right call for anything handling a
	/// value a user typed.
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		let rendered = match self.quote {
			_ if self.value.is_empty() => return Err(fmt::Error),
			Quote::Single if !self.value.contains('\'') => format!("'{}'", self.value),
			Quote::Double => quote_double(&self.value),
			_ => quote_value(&self.value).ok_or(fmt::Error)?,
		};
		f.write_str(&rendered)
	}
}

impl fmt::Display for Value {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			Self::Single(s) => write!(f, "{s}"),
			Self::Array { items, .. } => {
				f.write_str("[")?;
				for (i, item) in items.iter().enumerate() {
					if i > 0 {
						f.write_str(",")?;
					}
					write!(f, "{item}")?;
				}
				f.write_str("]")
			}
		}
	}
}

impl fmt::Display for Property {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(f, "{}={}", self.key, self.value)
	}
}

impl fmt::Display for Node {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(&self.name)?;
		for property in &self.properties {
			write!(f, " {property}")?;
		}
		if !self.sources.is_empty() {
			f.write_str(" [")?;
			for (i, pipeline) in self.sources.iter().enumerate() {
				if i > 0 {
					f.write_str(", ")?;
				}
				write!(f, "{pipeline}")?;
			}
			f.write_str("]")?;
		}
		Ok(())
	}
}

impl fmt::Display for Pipeline {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		for (i, node) in self.nodes.iter().enumerate() {
			if i > 0 {
				f.write_str(" | ")?;
			}
			write!(f, "{node}")?;
		}
		Ok(())
	}
}
