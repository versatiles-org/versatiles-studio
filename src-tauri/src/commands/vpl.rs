//! VPL parsing and structured edits (S2.2, ahead of the editor at S2.3).
//!
//! The webview never assembles VPL itself. It sends the string a user typed into a field and gets
//! back a whole document with the quoting already decided — because working out whether a value
//! needs bare, single or double quotes is the parser's business, and duplicating those rules in
//! TypeScript is how the two drift apart.

use crate::state::AppState;
use studio_core::history::EditKind;
use studio_core::vpl::{Diagnostic, Document, OperationInfo, ParseError, Pipeline, Span, Token, operations, validate};
use tauri::State;

/// A parse failure the editor can place, rather than a rendered string it would have to read.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(specta::Type)]
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
#[specta::specta]
pub fn vpl_operations() -> Vec<OperationInfo> {
	operations()
}

/// Parses VPL into a tree with spans, so the webview can render one field per property.
#[tauri::command]
#[specta::specta]
pub fn vpl_parse(text: String) -> Result<Pipeline, VplError> {
	Ok(Document::parse(text)?.pipeline().clone())
}

/// The whole document a view needs: the text, its tree, and its tokens.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(specta::Type)]
pub struct DocumentView {
	pub text: String,
	pub pipeline: Pipeline,
	/// For the editor to paint, derived from the same tree ([Q25](../../../docs/decisions.md)).
	pub tokens: Vec<Token>,
	/// Checked against the operations that exist (C4). A pipeline can parse and still be wrong.
	pub diagnostics: Vec<Diagnostic>,
	/// Whether ⌘Z and ⇧⌘Z have anywhere to go, so the interface can say so.
	pub can_undo: bool,
	pub can_redo: bool,
	/// The `.vpl` this came from, if any, so Save has somewhere to write without asking.
	pub path: Option<String>,
	/// Whether the pipeline differs from what is on disk.
	pub dirty: bool,
}

impl DocumentView {
	fn of(
		document: &Document,
		history: &studio_core::history::History,
		file: Option<&(std::path::PathBuf, String)>,
	) -> Self {
		Self {
			text: document.text().to_string(),
			pipeline: document.pipeline().clone(),
			tokens: document.tokens(),
			diagnostics: validate(document),
			can_undo: history.can_undo(),
			can_redo: history.can_redo(),
			path: file.map(|(path, _)| path.to_string_lossy().into_owned()),
			// A pipeline with no file behind it is dirty as soon as it has content: there is
			// somewhere it could be saved to, and nowhere it has been.
			dirty: file.is_none_or(|(_, saved)| saved != document.text()),
		}
	}
}

/// This window's pipeline, or `None` before anything has been opened.
#[tauri::command]
#[specta::specta]
pub async fn pipeline(state: State<'_, AppState>) -> Result<Option<DocumentView>, String> {
	let history = state.history.lock().await;
	let file = state.pipeline_file.lock().await.clone();
	Ok(state
		.pipeline
		.lock()
		.await
		.as_ref()
		.map(|document| DocumentView::of(document, &history, file.as_ref())))
}

/// Replaces the pipeline, rejecting text that does not parse.
///
/// The editor holds the text a user is typing, which is often mid-edit and invalid; the *document*
/// never is. A rejection carries a span so the editor can mark it (C4).
#[tauri::command]
#[specta::specta]
pub async fn set_pipeline(
	state: State<'_, AppState>,
	text: String,
	kind: Option<EditKind>,
) -> Result<DocumentView, VplError> {
	let document = Document::parse(text)?;

	// A wholesale replacement — opening a container, say — is no longer the file that was open, so
	// Save must not silently write over it. An edit keeps the file and simply makes it dirty.
	if kind == Some(EditKind::Replaced) {
		*state.pipeline_file.lock().await = None;
	}

	let mut history = state.history.lock().await;
	// The caller says where the edit came from, because only it knows: the same command carries a
	// keystroke and a form change, and they deserve different undo granularity.
	history.push(document.text(), kind.unwrap_or_default());
	let view = DocumentView::of(&document, &history, state.pipeline_file.lock().await.as_ref());
	*state.pipeline.lock().await = Some(document);
	Ok(view)
}

/// Steps the document back, or forward again. `None` when there is nowhere to go.
///
/// One stack for every view (G6): a form change undone from the text tab is the same ⌘Z.
#[tauri::command]
#[specta::specta]
pub async fn undo(state: State<'_, AppState>) -> Result<Option<DocumentView>, VplError> {
	step(state, true).await
}

#[tauri::command]
#[specta::specta]
pub async fn redo(state: State<'_, AppState>) -> Result<Option<DocumentView>, VplError> {
	step(state, false).await
}

async fn step(state: State<'_, AppState>, back: bool) -> Result<Option<DocumentView>, VplError> {
	let mut history = state.history.lock().await;
	let Some(text) = (if back { history.undo() } else { history.redo() }) else {
		return Ok(None);
	};
	// Every state on the stack parsed when it was recorded, so this cannot fail — but it is parsed
	// rather than assumed, because a panic here would take the window with it.
	let document = Document::parse(text.to_string())?;
	let view = DocumentView::of(&document, &history, state.pipeline_file.lock().await.as_ref());
	*state.pipeline.lock().await = Some(document);
	Ok(Some(view))
}

/// What the editor needs on every keystroke: how to paint the text, and what is wrong with it.
///
/// One command rather than two, because they are answers to the same parse — asking separately
/// would parse the same text twice and let the highlighting and the diagnostics disagree about
/// which version they describe.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(specta::Type)]
pub struct Review {
	pub tokens: Vec<Token>,
	/// Empty when the pipeline is sound. Parse failures come back as an `Err` instead — a document
	/// that does not parse has no tree to validate.
	pub diagnostics: Vec<Diagnostic>,
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
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
#[specta::specta]
pub fn vpl_set_property(text: String, span: Span, key: String, values: Vec<String>) -> Result<String, VplError> {
	let mut document = Document::parse(text)?;
	document.set_property(span, &key, &values)?;
	Ok(document.text().to_string())
}

/// Removes the property at `span`. This is what clearing a field means (see `VplNodeCard`).
#[tauri::command]
#[specta::specta]
pub fn vpl_remove_property(text: String, span: Span) -> Result<String, VplError> {
	let mut document = Document::parse(text)?;
	document.remove_property(span)?;
	Ok(document.text().to_string())
}

/// The pipeline's output, mounted on the embedded server and ready for the map (S2.7, C3).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(specta::Type)]
pub struct Preview {
	/// Mount name, stable so a rebuild replaces rather than accumulates.
	pub name: String,
	pub tile_url: String,
	pub info: studio_core::analysis::ContainerInfo,
}

/// Runs the pipeline up to `path` and mounts the result.
///
/// Building opens the inputs, so this is not instant on a large source — the caller should say it
/// is working. It is not yet a cancellable job; that arrives with the runner at S3.1.
#[tauri::command]
#[specta::specta]
pub async fn preview_pipeline(state: State<'_, AppState>, path: Vec<u32>) -> Result<Option<Preview>, String> {
	// `u32` rather than `usize` at the boundary: it arrives from JavaScript as numbers, and specta
	// will not emit a 64-bit integer as a `number` (see `bindings.rs`).
	let path: Vec<usize> = path.into_iter().map(|index| index as usize).collect();
	let Some(document) = state.pipeline.lock().await.clone() else {
		return Ok(None);
	};
	// An empty path means the whole pipeline — what the map shows when nothing is selected.
	let full = document.to_pipeline();
	let wanted = if path.is_empty() {
		Some(full)
	} else {
		studio_core::preview::up_to(full, &path)
	};
	let Some(wanted) = wanted else { return Ok(None) };

	let mut server = state.server.lock().await;
	let dir = state.project_dir.lock().await.clone();
	let source = studio_core::preview::build(server.runtime(), wanted, &dir)
		.await
		.map_err(|e| format!("{e:#}"))?;
	let info = studio_core::analysis::describe(&source, "preview")
		.await
		.map_err(|e| format!("{e:#}"))?;

	const NAME: &str = "preview";
	server.mount(NAME, source).await.map_err(|e| format!("{e:#}"))?;
	Ok(Some(Preview {
		name: NAME.to_string(),
		tile_url: server.tile_url(NAME),
		info,
	}))
}

/// Opens a `.vpl` file as this window's pipeline (C9, S2.9).
///
/// A pipeline written by hand or emitted by the CLI has to be openable, or "edit VPL" only ever
/// means "edit VPL Studio wrote" and the two tools cannot hand work to each other.
///
/// **Relative paths in the file resolve against the file**, the way `versatiles convert` resolves
/// them — `from_container filename="berlin.mbtiles"` beside the `.vpl` means exactly that — so
/// opening one moves `project_dir`.
#[tauri::command]
#[specta::specta]
pub async fn open_vpl(state: State<'_, AppState>, path: String) -> Result<DocumentView, VplError> {
	let text = std::fs::read_to_string(&path).map_err(|error| VplError {
		message: format!("could not read {path}: {error}"),
		span: Span::new(0, 0),
	})?;

	let document = Document::parse(text)?;

	if let Some(parent) = std::path::Path::new(&path).parent() {
		*state.project_dir.lock().await = parent.to_path_buf();
	}

	let saved = (std::path::PathBuf::from(&path), document.text().to_string());
	*state.pipeline_file.lock().await = Some(saved.clone());

	let mut history = state.history.lock().await;
	history.push(document.text(), EditKind::Replaced);
	let view = DocumentView::of(&document, &history, Some(&saved));
	*state.pipeline.lock().await = Some(document);

	{
		let mut recents = state.recents.lock().await;
		recents.record(&path);
		if let Err(error) = recents.save(&state.data_dir) {
			eprintln!("could not save recents: {error:#}");
		}
	}

	Ok(view)
}

/// Writes the pipeline to a `.vpl` file and remembers it as the file this window is editing.
///
/// The narrower half of saving: this writes the pipeline as the file the CLI already reads. Saving a
/// *project* — the manifest, the style and the pipeline as a directory — is G1 at S5.1, and stays a
/// separate command because it has a different scope.
#[tauri::command]
#[specta::specta]
pub async fn save_vpl(state: State<'_, AppState>, path: String) -> Result<DocumentView, VplError> {
	let Some(document) = state.pipeline.lock().await.clone() else {
		return Err(VplError {
			message: "there is no pipeline to save".to_string(),
			span: Span::new(0, 0),
		});
	};

	studio_core::project::save_vpl(std::path::Path::new(&path), document.text()).map_err(|error| VplError {
		message: format!("{error:#}"),
		span: Span::new(0, 0),
	})?;

	// Saving to a file makes that file's directory what relative paths mean, exactly as opening one
	// does — otherwise a pipeline saved beside its inputs would stop finding them.
	let file = std::path::PathBuf::from(&path);
	if let Some(parent) = file.parent() {
		*state.project_dir.lock().await = parent.to_path_buf();
	}
	let saved = (file, document.text().to_string());
	*state.pipeline_file.lock().await = Some(saved.clone());

	let history = state.history.lock().await;
	Ok(DocumentView::of(&document, &history, Some(&saved)))
}
