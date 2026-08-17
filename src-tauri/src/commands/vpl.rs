//! VPL parsing and structured edits (S2.2, ahead of the editor at S2.3).
//!
//! The webview never assembles VPL itself. It sends the string a user typed into a field and gets
//! back a whole document with the quoting already decided — because working out whether a value
//! needs bare, single or double quotes is the parser's business, and duplicating those rules in
//! TypeScript is how the two drift apart.

use crate::state::AppState;
use studio_core::history::EditKind;
use studio_core::jobs::{JobHandle, Lane};
use studio_core::preview::VPLPipeline;
use studio_core::vpl::{Diagnostic, Document, OperationInfo, ParseError, Pipeline, Span, Token, operations, validate};
use tauri::{AppHandle, State};

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

/// Adds an operation to the chain, immediately after the node whose name occupies `span`.
///
/// The pipeline could only gain a transform by typing VPL before this; the graph could add a source
/// and nothing else. Which operations exist comes from [`vpl_operations`], so a new one upstream is
/// offerable without a change here (C2).
#[tauri::command]
#[specta::specta]
pub fn vpl_insert_node(text: String, span: Span, operation: String) -> Result<String, VplError> {
	let mut document = Document::parse(text)?;
	document.insert_after(span, &operation)?;
	Ok(document.text().to_string())
}

/// Removes the node whose name occupies `span`, and the separator that joined it to the chain.
///
/// Refused when it would empty the pipeline — see `Document::remove_node` for why that is a message
/// rather than a parse failure.
#[tauri::command]
#[specta::specta]
pub fn vpl_remove_node(text: String, span: Span) -> Result<String, VplError> {
	let mut document = Document::parse(text)?;
	document.remove_node(span)?;
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
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
#[derive(specta::Type)]
pub struct Preview {
	/// Mount name, stable so a rebuild replaces rather than accumulates.
	pub name: String,
	pub tile_url: String,
	pub info: studio_core::analysis::ContainerInfo,
	/// The layers this produces, with their property keys (S3.3, E1).
	///
	/// Carried on the preview rather than fetched separately because it is an answer about *this*
	/// build: asking afterwards would race the next edit, and the form would offer property names
	/// from a pipeline that no longer exists. Empty for raster output.
	pub layers: Vec<studio_core::analysis::LayerInspection>,
}

/// What a preview request came to.
///
/// Three outcomes rather than an `Option`, because "there is nothing at that path" and "you asked
/// again before I finished" are different facts and the caller does different things with them.
#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[derive(specta::Type)]
pub enum PreviewOutcome {
	// Boxed only to keep the variants a similar size — `Preview` carries a whole `ContainerInfo`,
	// and the other two carry nothing. Transparent on the wire and in the generated types.
	Ready(Box<Preview>),
	/// The path names no node, or there is no pipeline yet.
	Nothing,
	/// A newer preview replaced this one before it finished. Its answer is the current one.
	Superseded,
}

/// Runs the pipeline up to `path` and mounts the result — as a cancellable job (S2.7, S3.1).
///
/// Building opens the inputs, which on a large source is not instant, so this runs in the runner's
/// [`Lane::Latest`]: **editing the pipeline again stops the build that is now out of date**, rather
/// than leaving it to finish an answer nobody will look at. That is also why the caller no longer
/// needs a token to discard stale replies — being superseded is something the runner knows, so it
/// is something this can report.
#[tauri::command]
#[specta::specta]
pub async fn preview_pipeline(
	app: AppHandle,
	state: State<'_, AppState>,
	path: Vec<u32>,
) -> Result<PreviewOutcome, String> {
	// `u32` rather than `usize` at the boundary: it arrives from JavaScript as numbers, and specta
	// will not emit a 64-bit integer as a `number` (see `bindings.rs`).
	let path: Vec<usize> = path.into_iter().map(|index| index as usize).collect();
	let Some(document) = state.pipeline.lock().await.clone() else {
		return Ok(PreviewOutcome::Nothing);
	};
	// An empty path means the whole pipeline — what the map shows when nothing is selected.
	let full = document.to_pipeline();
	let wanted = if path.is_empty() {
		Some(full)
	} else {
		studio_core::preview::up_to(full, &path)
	};
	let Some(wanted) = wanted else {
		return Ok(PreviewOutcome::Nothing);
	};

	// The result travels back through a oneshot rather than the event stream: it is an answer to
	// *this* call, not news for every listener, and it carries a mount URL the bar has no use for.
	let (tx, rx) = tokio::sync::oneshot::channel();
	state
		.jobs
		.submit("Building preview", Lane::Latest, move |handle| async move {
			let outcome = build_preview(&app, &handle, wanted).await;
			// Sent as a `Result`, so a failure reaches the caller's `catch` *and* is recorded as a
			// failed job. Only supersession drops the sender, which is what makes that distinguishable
			// from failing at the far end.
			let _ = tx.send(outcome.as_ref().map_err(|e| format!("{e:#}")).cloned());
			outcome.map(|_| ())
		});

	match rx.await {
		Ok(Ok(preview)) => Ok(PreviewOutcome::Ready(Box::new(preview))),
		Ok(Err(error)) => Err(error),
		// A dropped sender is a job that was aborted, which in this lane means superseded.
		Err(_) => Ok(PreviewOutcome::Superseded),
	}
}

/// The build itself, split out so the job body is about reporting rather than about tiles.
async fn build_preview(app: &AppHandle, handle: &JobHandle, wanted: VPLPipeline) -> anyhow::Result<Preview> {
	// Fetched here rather than captured: the job outlives the command's borrow, and an `AppHandle`
	// is the supported way to reach managed state from something that does.
	let state = tauri::Manager::state::<AppState>(app);
	handle.working("building the pipeline");
	let mut server = state.server.lock().await;
	let dir = state.project_dir.lock().await.clone();
	let source = studio_core::preview::build(server.runtime(), wanted, &dir).await?;

	handle.working("reading what it produces");
	let info = studio_core::analysis::describe(&source, "preview").await?;

	handle.working("looking at what it contains");
	let layers = studio_core::analysis::probe_layers(&source, &info).await;

	const NAME: &str = "preview";
	server.mount(NAME, source).await?;
	Ok(Preview {
		name: NAME.to_string(),
		tile_url: server.tile_url(NAME),
		info,
		layers,
	})
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

/// Every way this build can bring data in (S3.2).
///
/// Build-time information about the binary, like [`vpl_operations`] — the catalogue is derived from
/// the operation registry, so it cannot offer something this build cannot do.
#[tauri::command]
#[specta::specta]
pub fn import_kinds() -> Vec<studio_core::import::ImportKind> {
	studio_core::import::kinds()
}

/// Which kind a path belongs to, or `None` for a file Studio has no way in for.
///
/// Asked here rather than matched in the webview so that one list of extensions serves the dialog,
/// the drop target and the cards — three places that had already started to disagree.
#[tauri::command]
#[specta::specta]
pub fn import_kind_for(path: String) -> Option<studio_core::import::ImportKind> {
	studio_core::import::kind_for(&path)
}

/// The read node a chosen file becomes — `from_geo filename='…'`, quoting included.
///
/// The quoting is the core's, for the reason [`vpl_set_value`] gives: a second implementation of
/// VPL's quoting rules in TypeScript is exactly what would drift. So is the *filling in*: a CSV
/// arrives with its coordinate columns already set when its header names them unambiguously
/// (S3.4), which is the difference between an import that runs and one that opens a form.
#[tauri::command]
#[specta::specta]
pub fn import_read_node(kind_id: String, path: String) -> String {
	// Looked up rather than passed whole: the catalogue is the core's, and a webview that could
	// hand back a kind it had edited would be deciding which operation a file becomes.
	studio_core::import::kinds()
		.iter()
		.find(|kind| kind.id == kind_id)
		.map(|kind| studio_core::import::read_node(kind, &path))
		.unwrap_or_default()
}

/// Values the selected node's fields could take, read from what the node points at (S3.4).
///
/// Takes the node's path rather than the node, so the answer is about the document the core holds
/// — asking about a node the webview describes would let the two disagree about which file is
/// meant.
#[tauri::command]
#[specta::specta]
pub async fn field_suggestions(
	state: State<'_, AppState>,
	path: Vec<u32>,
) -> Result<Vec<studio_core::suggest::FieldSuggestion>, String> {
	let path: Vec<usize> = path.into_iter().map(|index| index as usize).collect();
	let Some(document) = state.pipeline.lock().await.clone() else {
		return Ok(Vec::new());
	};
	let Some(node) = document.pipeline().at_path(&path) else {
		return Ok(Vec::new());
	};
	let dir = state.project_dir.lock().await.clone();
	Ok(studio_core::suggest::for_node(node, &dir))
}
