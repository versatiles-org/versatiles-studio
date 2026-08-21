//! VPL parsing and structured edits (S2.2, ahead of the editor at S2.3).
//!
//! The webview never assembles VPL itself. It sends the string a user typed into a field and gets
//! back a whole document with the quoting already decided — because working out whether a value
//! needs bare, single or double quotes is the parser's business, and duplicating those rules in
//! TypeScript is how the two drift apart.

use crate::state::AppState;
use studio_core::graphs::GraphId;
use studio_core::history::{EditKind, Target};
use studio_core::jobs::{JobHandle, Lane};
use studio_core::preview::VPLPipeline;
use studio_core::style::Recipe;
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
	/// Which graph this is ([Q32](../../../docs/decisions.md)). The webview addresses everything by
	/// id rather than by name, so a rename cannot invalidate a reference held mid-edit.
	pub graph: studio_core::graphs::GraphId,
	pub name: String,
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
	fn of(graph: &studio_core::graphs::Graph, history: &studio_core::history::History) -> Self {
		let info = graph.info();
		Self {
			graph: info.id,
			name: info.name,
			text: graph.document.text().to_string(),
			pipeline: graph.document.pipeline().clone(),
			tokens: graph.document.tokens(),
			diagnostics: validate(&graph.document),
			can_undo: history.can_undo(),
			can_redo: history.can_redo(),
			path: info.path,
			dirty: info.dirty,
		}
	}
}

/// Every graph in this project, in the order the pane shows them ([Q32]).
#[tauri::command]
#[specta::specta]
pub async fn graphs(state: State<'_, AppState>) -> Result<Vec<studio_core::graphs::GraphInfo>, String> {
	Ok(state.graphs.lock().await.list())
}

/// One graph in full, or `None` if it has been removed.
#[tauri::command]
#[specta::specta]
pub async fn graph(state: State<'_, AppState>, id: GraphId) -> Result<Option<DocumentView>, String> {
	let history = state.history.lock().await;
	Ok(state.graphs.lock().await.get(id).map(|g| DocumentView::of(g, &history)))
}

/// Creates a graph from VPL text, and returns it.
///
/// Takes the **source** rather than a name, so the one rule that turns a file into a graph name
/// lives here and not in each caller ([Q35]) — a webview that passed a whole path would have named
/// a graph `users-me-data-berlin-mbtiles`. Two `places.geojson` files in different folders both want
/// to be `places`, and the second becoming `places-2` beats a refusal or a silent overwrite.
///
/// `None` is for a graph with no file behind it, which nothing creates today.
#[tauri::command]
#[specta::specta]
pub async fn add_graph(
	state: State<'_, AppState>,
	source: Option<String>,
	text: String,
) -> Result<DocumentView, VplError> {
	let document = Document::parse(text)?;
	let name = source
		.as_deref()
		.map_or_else(|| "graph".to_string(), studio_core::graphs::name_for_source);
	let mut graphs = state.graphs.lock().await;
	let id = graphs.add(&name, document, None);

	let mut history = state.history.lock().await;
	// The baseline every graph needs, so undo has somewhere to step back to rather than stopping
	// at this graph's first edit (see `History`).
	let graph = graphs.get(id).expect("just added");
	history.push(Target::Graph(id), graph.document.text(), EditKind::Replaced);
	Ok(DocumentView::of(graph, &history))
}

/// Removes a graph, and reports whether there was one.
#[tauri::command]
#[specta::specta]
pub async fn remove_graph(state: State<'_, AppState>, id: GraphId) -> Result<bool, String> {
	// The mount goes with it, or the style would keep resolving a source that no longer exists.
	let name = state.graphs.lock().await.get(id).map(|graph| graph.name.clone());
	if let Some(name) = name {
		let mut server = state.server.lock().await;
		if let Err(error) = server.unmount(&name) {
			eprintln!("could not unmount {name}: {error:#}");
		}
	}
	// A pin into a graph that is gone would leave the map showing something unreachable.
	let mut pinned = state.pinned.lock().await;
	if pinned.as_ref().is_some_and(|p| p.graph == id) {
		*pinned = None;
	}
	Ok(state.graphs.lock().await.remove(id))
}

/// Renames a graph, and reports the name it actually took.
///
/// The name is the mount, the source name in `style.json` and the `.vpl` filename at once ([Q32]),
/// so this remounts under the new name. **Rewriting the style's references is the other half**, and
/// lands with the style itself at S4 — there is nothing referencing a graph yet.
#[tauri::command]
#[specta::specta]
pub async fn rename_graph(state: State<'_, AppState>, id: GraphId, name: String) -> Result<String, String> {
	let mut graphs = state.graphs.lock().await;
	let old = graphs.get(id).map(|graph| graph.name.clone());
	let renamed = graphs.rename(id, &name).map_err(|error| format!("{error:#}"))?;

	if let Some(old) = old.filter(|old| old != &renamed) {
		let mut server = state.server.lock().await;
		if let Err(error) = server.unmount(&old) {
			eprintln!("could not unmount {old}: {error:#}");
		}
	}
	Ok(renamed)
}

/// Replaces a graph's text, rejecting what does not parse.
///
/// The editor holds the text a user is typing, which is often mid-edit and invalid; the *document*
/// never is. A rejection carries a span so the editor can mark it (C4).
#[tauri::command]
#[specta::specta]
pub async fn set_graph(
	state: State<'_, AppState>,
	id: GraphId,
	text: String,
	kind: Option<EditKind>,
) -> Result<DocumentView, VplError> {
	let document = Document::parse(text)?;
	let mut graphs = state.graphs.lock().await;
	let Some(graph) = graphs.get_mut(id) else {
		return Err(VplError {
			message: "no such graph".to_string(),
			span: Span::new(0, 0),
		});
	};

	// A wholesale replacement is no longer the file that was open, so Save must not silently write
	// over it. An edit keeps the file and simply makes it dirty.
	if kind == Some(EditKind::Replaced) {
		graph.file = None;
	}
	graph.document = document;

	let mut history = state.history.lock().await;
	// The caller says where the edit came from, because only it knows: the same command carries a
	// keystroke and a form change, and they deserve different undo granularity.
	history.push(Target::Graph(id), graph.document.text(), kind.unwrap_or_default());
	Ok(DocumentView::of(graph, &history))
}

/// Lays a graph's VPL out again, keeping its comments ([vt#249], S1.11).
///
/// **Recorded as an edit, not a rewrite.** It goes on the undo stack like anything else, and the
/// file behind it is kept — reformatting a `.vpl` is a change to it, not a replacement of it, so
/// Save still writes where it came from.
///
/// [vt#249]: https://github.com/versatiles-org/versatiles-rs/issues/249
#[tauri::command]
#[specta::specta]
pub async fn format_graph(state: State<'_, AppState>, id: GraphId) -> Result<DocumentView, VplError> {
	let mut graphs = state.graphs.lock().await;
	let Some(graph) = graphs.get_mut(id) else {
		return Err(VplError {
			message: "no such graph".to_string(),
			span: Span::new(0, 0),
		});
	};

	graph.document.format();

	let mut history = state.history.lock().await;
	// `Replaced` rather than a keystroke: this changes the whole document at once, and merging it
	// into a run of typing would make one ⌘Z undo both the formatting and the last thing typed.
	history.push(Target::Graph(id), graph.document.text(), EditKind::Replaced);
	Ok(DocumentView::of(graph, &history))
}

/// Steps back, or forward again. `None` when there is nowhere to go.
///
/// **One stack across every graph** ([Q32], G6), so this may hand back a graph other than the one
/// being edited — which is why it returns the whole document rather than just its text.
#[tauri::command]
#[specta::specta]
pub async fn undo(state: State<'_, AppState>) -> Result<Option<Restored>, VplError> {
	step(state, true).await
}

#[tauri::command]
#[specta::specta]
pub async fn redo(state: State<'_, AppState>) -> Result<Option<Restored>, VplError> {
	step(state, false).await
}

/// What a step back or forward restored.
///
/// **The step says which document it changed**, because one stack now spans the graphs and the
/// style ([Q36]) and the webview has to know which of them to redraw. Returning only a graph view
/// would have made undoing a style edit look like nothing happened.
///
/// [Q36]: ../../../docs/decisions.md
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Restored {
	Graph(DocumentView),
	Style(Recipe),
}

async fn step(state: State<'_, AppState>, back: bool) -> Result<Option<Restored>, VplError> {
	let mut history = state.history.lock().await;
	let Some(step) = (if back { history.undo() } else { history.redo() }) else {
		return Ok(None);
	};

	match step.target {
		Target::Graph(id) => {
			// Every state on the stack parsed when it was recorded, so this cannot fail — but it is
			// parsed rather than assumed, because a panic here would take the window with it.
			let document = Document::parse(step.text)?;
			let mut graphs = state.graphs.lock().await;
			let Some(graph) = graphs.get_mut(id) else {
				// The graph was removed after the edit was recorded; nothing to restore into.
				return Ok(None);
			};
			graph.document = document;
			Ok(Some(Restored::Graph(DocumentView::of(graph, &history))))
		}
		Target::Style => {
			// Same reasoning: it serialised from a `Recipe`, so it reads back as one — and a
			// corrupt entry loses the step rather than the window.
			let Ok(recipe) = Recipe::parse(&step.text) else {
				return Ok(None);
			};
			*state.style.lock().await = recipe.clone();
			Ok(Some(Restored::Style(recipe)))
		}
	}
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

/// Removes the property at `span`. This is what clearing a field means (see `NodeCard`).
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
	/// Which transforms can be appended to this, and why the rest cannot (S2.14).
	///
	/// Carried here for the same reason as `layers`, and it is the same kind of answer: what fits
	/// depends on what this build produces, so asking separately would race the next edit and offer
	/// operations chosen for a pipeline that no longer exists. It also costs nothing extra — the
	/// source is already built and every check is a comparison against its declared tile type.
	pub fits: Vec<studio_core::analysis::Fit>,
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
	graph: GraphId,
	path: Vec<u32>,
) -> Result<PreviewOutcome, String> {
	// `u32` rather than `usize` at the boundary: it arrives from JavaScript as numbers, and specta
	// will not emit a 64-bit integer as a `number` (see `bindings.rs`).
	let path: Vec<usize> = path.into_iter().map(|index| index as usize).collect();
	let Some(document) = state.graphs.lock().await.get(graph).map(|g| g.document.clone()) else {
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
	build_into(app, handle, wanted, "preview").await
}

/// Builds a pipeline and mounts it under `name`, replacing whatever was there.
async fn build_into(app: &AppHandle, handle: &JobHandle, wanted: VPLPipeline, name: &str) -> anyhow::Result<Preview> {
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
	let fits = studio_core::analysis::fitting(&source).await;

	server.mount(name, source).await?;
	Ok(Preview {
		name: name.to_string(),
		tile_url: server.tile_url(name),
		info,
		layers,
		fits,
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

	let file = std::path::PathBuf::from(&path);
	// The graph is named after the file it came from — which is also what it will be saved back as,
	// and what the style will reference ([Q32]). Same rule as every other way in ([Q35]).
	let stem = studio_core::graphs::name_for_source(&path);
	let saved = (file, document.text().to_string());

	let mut graphs = state.graphs.lock().await;
	let id = graphs.add(&stem, document, Some(saved));

	let mut history = state.history.lock().await;
	let graph = graphs.get(id).expect("just added");
	history.push(Target::Graph(id), graph.document.text(), EditKind::Replaced);
	let view = DocumentView::of(graph, &history);
	drop(graphs);

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
pub async fn save_vpl(state: State<'_, AppState>, graph: GraphId, path: String) -> Result<DocumentView, VplError> {
	let Some(document) = state.graphs.lock().await.get(graph).map(|g| g.document.clone()) else {
		return Err(VplError {
			message: "no such graph".to_string(),
			span: Span::new(0, 0),
		});
	};

	// **The destination is checked, not trusted.** The `.vpl` filter lives in the file dialog, which
	// is on the webview's side of the boundary — so it shapes what a person is offered and decides
	// nothing. `export_graph` refuses a target it cannot write for the same reason; this is the other
	// command that takes a path, and it was the one not doing it.
	if !studio_core::import::is_pipeline(std::path::Path::new(&path)) {
		return Err(VplError {
			message: format!(
				"a pipeline is saved as .{}",
				studio_core::import::pipeline_extensions().join(" or .")
			),
			span: Span::new(0, 0),
		});
	}

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
	let mut graphs = state.graphs.lock().await;
	let Some(entry) = graphs.get_mut(graph) else {
		return Err(VplError {
			message: "no such graph".to_string(),
			span: Span::new(0, 0),
		});
	};
	entry.file = Some((file, document.text().to_string()));

	let history = state.history.lock().await;
	Ok(DocumentView::of(entry, &history))
}

/// Where the map is looking: the pinned node, or `None` for the ordinary state ([Q32]).
#[tauri::command]
#[specta::specta]
pub async fn pinned(state: State<'_, AppState>) -> Result<Option<Pin>, String> {
	Ok(state.pinned.lock().await.as_ref().map(|pin| Pin {
		graph: pin.graph,
		path: pin.path.iter().map(|index| *index as u32).collect(),
	}))
}

/// Which node the map shows, overriding every mounted graph.
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(specta::Type)]
pub struct Pin {
	pub graph: GraphId,
	pub path: Vec<u32>,
}

/// Pins the map to one node, or clears the pin.
///
/// **Exactly one across the project.** Pinning elsewhere moves it; pinning the pinned node clears
/// it, which is the gesture that gets you back to seeing everything.
#[tauri::command]
#[specta::specta]
pub async fn set_pin(state: State<'_, AppState>, pin: Option<Pin>) -> Result<Option<Pin>, String> {
	let mut current = state.pinned.lock().await;
	*current = pin.map(|pin| crate::state::Pinned {
		graph: pin.graph,
		path: pin.path.iter().map(|index| *index as usize).collect(),
	});
	Ok(current.as_ref().map(|pin| Pin {
		graph: pin.graph,
		path: pin.path.iter().map(|index| *index as u32).collect(),
	}))
}

/// Builds a graph in full and mounts it under its own name ([Q32]).
///
/// Every graph is served, because that is what a style names — this is the ordinary view, and the
/// pin is the exception layered on top. Mounting by name rather than under one shared `preview`
/// mount is what lets a style reference `basemap` and `hillshade` separately.
#[tauri::command]
#[specta::specta]
pub async fn mount_graph(
	app: AppHandle,
	state: State<'_, AppState>,
	graph: GraphId,
) -> Result<Option<Preview>, String> {
	let Some((name, document)) = state
		.graphs
		.lock()
		.await
		.get(graph)
		.map(|g| (g.name.clone(), g.document.clone()))
	else {
		return Ok(None);
	};

	let (tx, rx) = tokio::sync::oneshot::channel();
	let pipeline = document.to_pipeline();
	state
		.jobs
		.submit(format!("Building {name}"), Lane::Latest, move |handle| async move {
			let outcome = build_into(&app, &handle, pipeline, &name).await;
			let _ = tx.send(outcome.as_ref().map_err(|e| format!("{e:#}")).cloned());
			outcome.map(|_| ())
		});

	match rx.await {
		Ok(Ok(preview)) => Ok(Some(preview)),
		Ok(Err(error)) => Err(error),
		// Superseded by a newer build of the same graph; its answer is the current one.
		Err(_) => Ok(None),
	}
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

/// What every node's fields could be set to, read from what each node points at (S3.4).
///
/// **The whole graph, not the selected node.** Every node in the chain carries its own form, so
/// every node needs its own answer — one `from_csv` reading `a.csv` has nothing to say about
/// another reading `b.csv`. It used to take a path, which was correct only while a single node had
/// a form to fill in.
///
/// One call rather than one per node: `for_node` refuses anything that is not a `from_csv` before
/// it touches a disk, so the sweep costs a header read per CSV node and a string comparison for the
/// rest.
#[tauri::command]
#[specta::specta]
pub async fn field_suggestions(
	state: State<'_, AppState>,
	graph: GraphId,
) -> Result<Vec<studio_core::suggest::NodeSuggestions>, String> {
	let Some(document) = state.graphs.lock().await.get(graph).map(|g| g.document.clone()) else {
		return Ok(Vec::new());
	};
	let dir = state.project_dir.lock().await.clone();
	Ok(studio_core::suggest::for_pipeline(document.pipeline(), &dir))
}
