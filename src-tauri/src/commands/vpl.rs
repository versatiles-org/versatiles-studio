//! VPL parsing and structured edits (S2.2, ahead of the editor at S2.3).
//!
//! The webview never assembles VPL itself. It sends the string a user typed into a field and gets
//! back a whole document with the quoting already decided — because working out whether a value
//! needs bare, single or double quotes is the parser's business, and duplicating those rules in
//! TypeScript is how the two drift apart.

use studio_core::vpl::{Document, ParseError, Pipeline, Span};

/// A parse failure the editor can place, rather than a rendered string it would have to read.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VplError {
	pub message: String,
	pub span: Span,
}

impl From<ParseError> for VplError {
	fn from(error: ParseError) -> Self {
		Self {
			message: error.message,
			span: error.span,
		}
	}
}

/// Parses VPL into a tree with spans, so the webview can render one field per property.
#[tauri::command]
pub fn vpl_parse(text: String) -> Result<Pipeline, VplError> {
	Ok(Document::parse(text)?.pipeline().clone())
}

/// Sets the value at `span` and returns the whole document back.
///
/// Returning the text rather than a patch keeps the webview from having to apply spans itself; it
/// re-parses what it gets and re-renders. The documents here are a few hundred bytes.
#[tauri::command]
pub fn vpl_set_value(text: String, span: Span, value: String) -> Result<String, VplError> {
	let mut document = Document::parse(text)?;
	document.set_value(span, &value)?;
	Ok(document.text().to_string())
}

/// Removes the property at `span`. This is what clearing a field means — VPL has no empty value.
#[tauri::command]
pub fn vpl_remove_property(text: String, span: Span) -> Result<String, VplError> {
	let mut document = Document::parse(text)?;
	document.remove_property(span)?;
	Ok(document.text().to_string())
}
