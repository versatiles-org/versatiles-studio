//! VPL parsing and structured edits (S2.2, ahead of the editor at S2.3).
//!
//! The webview never assembles VPL itself. It sends the string a user typed into a field and gets
//! back a whole document with the quoting already decided — because working out whether a value
//! needs bare, single or double quotes is the parser's business, and duplicating those rules in
//! TypeScript is how the two drift apart.

use crate::state::AppState;
use studio_core::vpl::{Diagnostic, Document, OperationInfo, ParseError, Pipeline, Span, Token, operations, validate};
use tauri::State;

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

/// Every operation and its parameters, for the generated forms (C2, S2.6).
///
/// Fetched once and cached by the caller: this is build-time information about the binary, so it
/// cannot change while Studio is running.
#[tauri::command]
pub fn vpl_operations() -> Vec<OperationInfo> {
	operations()
}

/// Parses VPL into a tree with spans, so the webview can render one field per property.
#[tauri::command]
pub fn vpl_parse(text: String) -> Result<Pipeline, VplError> {
	Ok(Document::parse(text)?.pipeline().clone())
}

/// The whole document a view needs: the text, its tree, and its tokens.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentView {
	pub text: String,
	pub pipeline: Pipeline,
	/// For the editor to paint, derived from the same tree ([Q25](../../../docs/decisions.md)).
	pub tokens: Vec<Token>,
	/// Checked against the operations that exist (C4). A pipeline can parse and still be wrong.
	pub diagnostics: Vec<Diagnostic>,
}

impl From<&Document> for DocumentView {
	fn from(document: &Document) -> Self {
		Self {
			text: document.text().to_string(),
			pipeline: document.pipeline().clone(),
			tokens: document.tokens(),
			diagnostics: validate(document),
		}
	}
}

/// This window's pipeline, or `None` before anything has been opened.
#[tauri::command]
pub async fn pipeline(state: State<'_, AppState>) -> Result<Option<DocumentView>, String> {
	Ok(state.pipeline.lock().await.as_ref().map(DocumentView::from))
}

/// Replaces the pipeline, rejecting text that does not parse.
///
/// The editor holds the text a user is typing, which is often mid-edit and invalid; the *document*
/// never is. A rejection carries a span so the editor can mark it (C4).
#[tauri::command]
pub async fn set_pipeline(state: State<'_, AppState>, text: String) -> Result<DocumentView, VplError> {
	let document = Document::parse(text)?;
	let view = DocumentView::from(&document);
	*state.pipeline.lock().await = Some(document);
	Ok(view)
}

/// What the editor needs on every keystroke: how to paint the text, and what is wrong with it.
///
/// One command rather than two, because they are answers to the same parse — asking separately
/// would parse the same text twice and let the highlighting and the diagnostics disagree about
/// which version they describe.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
	pub tokens: Vec<Token>,
	/// Empty when the pipeline is sound. Parse failures come back as an `Err` instead — a document
	/// that does not parse has no tree to validate.
	pub diagnostics: Vec<Diagnostic>,
}

#[tauri::command]
pub fn vpl_review(text: String) -> Result<Review, VplError> {
	let document = Document::parse(text)?;
	Ok(Review {
		tokens: document.tokens(),
		diagnostics: validate(&document),
	})
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

/// Sets a parameter on the node whose *name* occupies `span`, adding it if it is not set.
///
/// Takes the node rather than the property, because the generated form offers every parameter an
/// operation accepts — including the ones the node has no span for yet.
#[tauri::command]
pub fn vpl_set_property(text: String, span: Span, key: String, values: Vec<String>) -> Result<String, VplError> {
	let mut document = Document::parse(text)?;
	document.set_property(span, &key, &values)?;
	Ok(document.text().to_string())
}

/// Removes the property at `span`. This is what clearing a field means (see `VplNodeCard`).
#[tauri::command]
pub fn vpl_remove_property(text: String, span: Span) -> Result<String, VplError> {
	let mut document = Document::parse(text)?;
	document.remove_property(span)?;
	Ok(document.text().to_string())
}
