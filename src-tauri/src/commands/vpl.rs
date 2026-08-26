//! VPL parsing and structured edits (S2.2, ahead of the editor at S2.3).
//!
//! The webview never assembles VPL itself. It sends the string a user typed into a field and gets
//! back a whole document with the quoting already decided - because working out whether a value
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
pub async fn graphs(
	window: tauri::Window,
	state: State<'_, AppState>,
) -> Result<Vec<studio_core::graphs::GraphInfo>, String> {
	let project = state.project(&window).await;
	let list = project.lock().await.graphs.list();
	Ok(list)
}

/// One graph in full, or `None` if it has been removed.
#[tauri::command]
#[specta::specta]
pub async fn graph(
	window: tauri::Window,
	state: State<'_, AppState>,
	id: GraphId,
) -> Result<Option<DocumentView>, String> {
	let held = state.project(&window).await;
	let project = held.lock().await;
	Ok(project.graphs.get(id).map(|g| DocumentView::of(g, &project.history)))
}

/// Creates a graph from VPL text, and returns it.
///
/// Takes the **source** rather than a name, so the one rule that turns a file into a graph name
/// lives here and not in each caller ([Q35]) - a webview that passed a whole path would have named
/// a graph `users-me-data-berlin-mbtiles`. Two `places.geojson` files in different folders both want
/// to be `places`, and the second becoming `places-2` beats a refusal or a silent overwrite.
///
/// `None` is for a graph with no file behind it, which nothing creates today.
#[tauri::command]
#[specta::specta]
pub async fn add_graph(
	window: tauri::Window,
	state: State<'_, AppState>,
	source: Option<String>,
	text: String,
) -> Result<DocumentView, VplError> {
	let document = Document::parse(text)?;
	let name = source
		.as_deref()
		.map_or_else(|| "graph".to_string(), studio_core::graphs::name_for_source);
	let held = state.project(&window).await;
	let mut project = held.lock().await;
	let id = project.graphs.add(&name, document, None);

	// The baseline every graph needs, so undo has somewhere to step back to rather than stopping
	// at this graph's first edit (see `History`).
	let text = project.graphs.get(id).expect("just added").document.text().to_string();
	project.history.push(Target::Graph(id), text, EditKind::Replaced);
	let graph = project.graphs.get(id).expect("just added");
	Ok(DocumentView::of(graph, &project.history))
}

/// Removes a graph, and reports whether there was one.
#[tauri::command]
#[specta::specta]
pub async fn remove_graph(window: tauri::Window, state: State<'_, AppState>, id: GraphId) -> Result<bool, String> {
	let held = state.project(&window).await;
	let mount = {
		let project = held.lock().await;
		let name = project.graphs.get(id).map(|graph| graph.name.clone());
		name.map(|name| project.mount(&name))
	};

	// The mount goes with it, or the style would keep resolving a source that no longer exists.
	// The server is the application's, so it is taken after the project lock is released.
	if let Some(mount) = mount {
		let mut server = state.server.lock().await;
		if let Err(error) = server.unmount(&mount) {
			eprintln!("could not unmount {mount}: {error:#}");
		}
	}
	let removed = held.lock().await.graphs.remove(id);
	Ok(removed)
}

/// Renames a graph, and reports the name it actually took.
///
/// The name is the mount, the source name in `style.json` and the `.vpl` filename at once ([Q32]),
/// so this remounts under the new name - and since [S6.4](../../../docs/history.md) the
/// recipe files each source's style under that name too, so the style moves with it.
///
/// **Without this a rename silently resets the style.** The entry would stay under the old name,
/// referenced by nothing, and the source would come back with defaults as though it had never been
/// touched. It is not recorded as a style edit: renaming a graph is not a restyling, and ⌘Z after
/// one should undo the rename rather than half of it.
#[tauri::command]
#[specta::specta]
pub async fn rename_graph(
	window: tauri::Window,
	state: State<'_, AppState>,
	id: GraphId,
	name: String,
) -> Result<String, String> {
	let held = state.project(&window).await;
	// Graphs and style under one lock - they are one project now, which is also what retires the
	// note that used to be here about taking two locks in a fixed order to avoid a deadlock.
	let (stale, renamed) = {
		let mut project = held.lock().await;
		let old = project.graphs.get(id).map(|graph| graph.name.clone());
		let renamed = project.graphs.rename(id, &name).map_err(|error| format!("{error:#}"))?;
		let stale = old.filter(|old| old != &renamed).map(|old| {
			project.style.rename_source(&old, &renamed);
			project.mount(&old)
		});
		(stale, renamed)
	};

	// The mount the old name was served from. The new one is built on the next refresh, which the
	// webview asks for as soon as this returns.
	if let Some(stale) = stale {
		let mut server = state.server.lock().await;
		if let Err(error) = server.unmount(&stale) {
			eprintln!("could not unmount {stale}: {error:#}");
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
	window: tauri::Window,
	state: State<'_, AppState>,
	id: GraphId,
	text: String,
	kind: Option<EditKind>,
) -> Result<DocumentView, VplError> {
	let document = Document::parse(text)?;
	let held = state.project(&window).await;
	let mut project = held.lock().await;
	let Some(graph) = project.graphs.get_mut(id) else {
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
	let text = graph.document.text().to_string();

	// The caller says where the edit came from, because only it knows: the same command carries a
	// keystroke and a form change, and they deserve different undo granularity.
	project.history.push(Target::Graph(id), text, kind.unwrap_or_default());
	let graph = project.graphs.get(id).expect("just edited");
	Ok(DocumentView::of(graph, &project.history))
}

/// Lays a graph's VPL out again, keeping its comments ([vt#249], S1.11).
///
/// **Recorded as an edit, not a rewrite.** It goes on the undo stack like anything else, and the
/// file behind it is kept - reformatting a `.vpl` is a change to it, not a replacement of it, so
/// Save still writes where it came from.
///
/// [vt#249]: https://github.com/versatiles-org/versatiles-rs/issues/249
#[tauri::command]
#[specta::specta]
pub async fn format_graph(
	window: tauri::Window,
	state: State<'_, AppState>,
	id: GraphId,
) -> Result<DocumentView, VplError> {
	let held = state.project(&window).await;
	let mut project = held.lock().await;
	let Some(graph) = project.graphs.get_mut(id) else {
		return Err(VplError {
			message: "no such graph".to_string(),
			span: Span::new(0, 0),
		});
	};

	graph.document.format();
	let text = graph.document.text().to_string();

	// `Replaced` rather than a keystroke: this changes the whole document at once, and merging it
	// into a run of typing would make one ⌘Z undo both the formatting and the last thing typed.
	project.history.push(Target::Graph(id), text, EditKind::Replaced);
	let graph = project.graphs.get(id).expect("just formatted");
	Ok(DocumentView::of(graph, &project.history))
}

/// Steps back, or forward again. `None` when there is nowhere to go.
///
/// **One stack across every graph** ([Q32], G6), so this may hand back a graph other than the one
/// being edited - which is why it returns the whole document rather than just its text.
#[tauri::command]
#[specta::specta]
pub async fn undo(window: tauri::Window, state: State<'_, AppState>) -> Result<Option<Restored>, VplError> {
	step(&window, state, true).await
}

#[tauri::command]
#[specta::specta]
pub async fn redo(window: tauri::Window, state: State<'_, AppState>) -> Result<Option<Restored>, VplError> {
	step(&window, state, false).await
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

async fn step(window: &tauri::Window, state: State<'_, AppState>, back: bool) -> Result<Option<Restored>, VplError> {
	let held = state.project(window).await;
	let mut project = held.lock().await;
	let Some(step) = (if back {
		project.history.undo()
	} else {
		project.history.redo()
	}) else {
		return Ok(None);
	};

	match step.target {
		Target::Graph(id) => {
			// Every state on the stack parsed when it was recorded, so this cannot fail - but it is
			// parsed rather than assumed, because a panic here would take the window with it.
			let document = Document::parse(step.text)?;
			let Some(graph) = project.graphs.get_mut(id) else {
				// The graph was removed after the edit was recorded; nothing to restore into.
				return Ok(None);
			};
			graph.document = document;
			let graph = project.graphs.get(id).expect("just restored");
			Ok(Some(Restored::Graph(DocumentView::of(graph, &project.history))))
		}
		Target::Style => {
			// Same reasoning: it serialised from a `Recipe`, so it reads back as one - and a
			// corrupt entry loses the step rather than the window.
			let Ok(recipe) = Recipe::parse(&step.text) else {
				return Ok(None);
			};
			project.style = recipe.clone();
			Ok(Some(Restored::Style(recipe)))
		}
	}
}

/// What the editor needs on every keystroke: how to paint the text, and what is wrong with it.
///
/// One command rather than two, because they are answers to the same parse - asking separately
/// would parse the same text twice and let the highlighting and the diagnostics disagree about
/// which version they describe.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(specta::Type)]
pub struct Review {
	pub tokens: Vec<Token>,
	/// Empty when the pipeline is sound. Parse failures come back as an `Err` instead - a document
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
/// operation accepts - including the ones the node has no span for yet.
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
/// Refused when it would empty the pipeline - see `Document::remove_node` for why that is a message
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
	/// operations chosen for a pipeline that no longer exists. It also costs nothing extra - the
	/// source is already built and every check is a comparison against its declared tile type.
	pub fits: Vec<studio_core::analysis::Fit>,
}

/// Opens a `.vpl` file as this window's pipeline (C9, S2.9).
///
/// A pipeline written by hand or emitted by the CLI has to be openable, or "edit VPL" only ever
/// means "edit VPL Studio wrote" and the two tools cannot hand work to each other.
///
/// **Relative paths in the file resolve against the file**, the way `versatiles convert` resolves
/// them - `from_container filename="berlin.mbtiles"` beside the `.vpl` means exactly that - so
/// opening one moves `project_dir`.
#[tauri::command]
#[specta::specta]
pub async fn open_vpl(
	window: tauri::Window,
	state: State<'_, AppState>,
	path: String,
) -> Result<DocumentView, VplError> {
	let text = std::fs::read_to_string(&path).map_err(|error| VplError {
		message: format!("could not read {path}: {error}"),
		span: Span::new(0, 0),
	})?;

	let document = Document::parse(text)?;

	let file = std::path::PathBuf::from(&path);
	// The graph is named after the file it came from - which is also what it will be saved back as,
	// and what the style will reference ([Q32]). Same rule as every other way in ([Q35]).
	let stem = studio_core::graphs::name_for_source(&path);
	let saved = (file, document.text().to_string());

	let held = state.project(&window).await;
	let view = {
		let mut project = held.lock().await;
		if let Some(parent) = std::path::Path::new(&path).parent() {
			project.dir = parent.to_path_buf();
		}
		let id = project.graphs.add(&stem, document, Some(saved));
		let text = project.graphs.get(id).expect("just added").document.text().to_string();
		project.history.push(Target::Graph(id), text, EditKind::Replaced);
		let graph = project.graphs.get(id).expect("just added");
		DocumentView::of(graph, &project.history)
	};

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
/// *project* - the manifest, the style and the pipeline as a directory - is G1 at S5.1, and stays a
/// separate command because it has a different scope.
#[tauri::command]
#[specta::specta]
pub async fn save_vpl(
	window: tauri::Window,
	state: State<'_, AppState>,
	graph: GraphId,
	path: String,
) -> Result<DocumentView, VplError> {
	let held = state.project(&window).await;
	let Some(document) = held.lock().await.graphs.get(graph).map(|g| g.document.clone()) else {
		return Err(VplError {
			message: "no such graph".to_string(),
			span: Span::new(0, 0),
		});
	};

	// **The destination is checked, not trusted.** The `.vpl` filter lives in the file dialog, which
	// is on the webview's side of the boundary - so it shapes what a person is offered and decides
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
	// does - otherwise a pipeline saved beside its inputs would stop finding them.
	let file = std::path::PathBuf::from(&path);
	let mut project = held.lock().await;
	if let Some(parent) = file.parent() {
		project.dir = parent.to_path_buf();
	}
	let Some(entry) = project.graphs.get_mut(graph) else {
		return Err(VplError {
			message: "no such graph".to_string(),
			span: Span::new(0, 0),
		});
	};
	entry.file = Some((file, document.text().to_string()));

	let entry = project.graphs.get(graph).expect("just saved");
	Ok(DocumentView::of(entry, &project.history))
}

/// Switches a graph on or off - the eye on its row in the sources list ([Q49]).
///
/// Off means it is not built: no job when the project opens, no mount on the server, and no source
/// in the `style.json` a save writes. Nothing else changes - the document, its file, its crop and
/// its style entry all stay, and switching it back on finds the nodes it had off still off.
///
/// **Durable**, so a slow source somebody switched off is still off tomorrow. It is the caller's
/// job to remount or forget the tiles; this owns the fact, not the map.
#[tauri::command]
#[specta::specta]
pub async fn set_graph_enabled(
	window: tauri::Window,
	state: State<'_, AppState>,
	graph: GraphId,
	enabled: bool,
) -> Result<bool, String> {
	let held = state.project(&window).await;
	let mut project = held.lock().await;
	Ok(project.graphs.set_enabled(graph, enabled))
}

/// Switches one node of a graph on or off - the eye on its row in the chain ([Q49]).
///
/// A node that is off is not in the pipeline that runs; the pipe flows **through** it rather than
/// stopping at it, which is what tells this from the pin it replaces. Refused for the two nodes a
/// chain cannot do without - see [`Graphs::set_node_enabled`].
///
/// **Not an edit, and not in the `.vpl`.** The file stays the pipeline every tool runs; which of
/// its operations Studio runs is recorded beside the crop in `project.yaml`, for the same reason
/// the crop is. So it survives a reopen, and the preview, the style and an export all agree about
/// it. `path` is the node path the graph view already speaks - a node index, then pairs of source
/// and node index.
#[tauri::command]
#[specta::specta]
pub async fn set_node_enabled(
	window: tauri::Window,
	state: State<'_, AppState>,
	graph: GraphId,
	path: Vec<u32>,
	enabled: bool,
) -> Result<(), String> {
	// `u32` at the boundary: a path arrives from JavaScript as numbers, and specta will not emit a
	// 64-bit integer as a `number` (see `bindings.rs`).
	let path: Vec<usize> = path.into_iter().map(|index| index as usize).collect();
	let held = state.project(&window).await;
	let mut project = held.lock().await;
	project
		.graphs
		.set_node_enabled(graph, &path, enabled)
		.map_err(|error| format!("{error:#}"))
}

/// Builds a graph and mounts it under its own name ([Q32]).
///
/// Every graph is served, because that is what a style names: mounting by name rather than under
/// one shared mount is what lets a style reference `basemap` and `hillshade` separately.
///
/// **What is built is the graph's *effective* pipeline** ([Q49]) - the document minus the nodes
/// whose eyes are off, and nothing at all when the graph itself is off. Every route to tiles goes
/// through here, so the map, the server and the style cannot disagree about what a graph is.
#[tauri::command]
#[specta::specta]
pub async fn mount_graph(
	app: AppHandle,
	window: tauri::Window,
	state: State<'_, AppState>,
	graph: GraphId,
) -> Result<Option<Preview>, String> {
	let held = state.project(&window).await;
	let (name, mount, pipeline, dir) = {
		let project = held.lock().await;
		let Some(found) = project.graphs.get(graph) else {
			return Ok(None);
		};
		let name = found.name.clone();
		// Switched off, or switched off down to nothing: there are no tiles to serve, and saying so
		// is what keeps an off graph out of the stack and out of the style.
		let Some(pipeline) = found.drawn() else {
			return Ok(None);
		};
		let mount = project.mount(&name);
		(name, mount, pipeline, project.dir.clone())
	};

	let (tx, rx) = tokio::sync::oneshot::channel();
	let label = format!("Building {name}");
	state
		.jobs
		.submit(label, Lane::Latest, window.label(), move |handle| async move {
			let outcome = build_into(&app, &handle, pipeline, &name, &mount, dir).await;
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

/// Builds a pipeline and mounts it, replacing whatever was there.
///
/// **`mount` and `name` are different things** ([S7.2](../../../docs/history.md)). `mount`
/// is where the tiles are served from, and carries the window's prefix so two projects with a graph
/// of the same name do not serve each other's tiles. `name` is what the webview calls this source in
/// the style it composes - the graph's own name, which a prefix would leak into every `style.json`
/// Studio exports.
///
/// **The directory comes in rather than being looked up.** The job outlives the command, and by the
/// time it runs the window that asked may have opened a project somewhere else - so what a relative
/// `filename` means is captured with the pipeline it belongs to, not read again later (S7.1).
async fn build_into(
	app: &AppHandle,
	handle: &JobHandle,
	wanted: VPLPipeline,
	name: &str,
	mount: &str,
	dir: std::path::PathBuf,
) -> anyhow::Result<Preview> {
	// Fetched here rather than captured: the job outlives the command's borrow, and an `AppHandle`
	// is the supported way to reach managed state from something that does.
	let state = tauri::Manager::state::<AppState>(app);
	handle.working("building the pipeline");
	let mut server = state.server.lock().await;
	let source = studio_core::preview::build(server.runtime(), wanted, &dir).await?;

	handle.working("reading what it produces");
	let info = studio_core::analysis::describe(&source, "preview").await?;

	handle.working("looking at what it contains");
	let layers = studio_core::analysis::probe_layers(&source, &info).await;
	let fits = studio_core::analysis::fitting(&source).await;

	server.mount(mount, source).await?;
	Ok(Preview {
		name: name.to_string(),
		tile_url: server.tile_url(mount),
		info,
		layers,
		fits,
	})
}

/// Every way this build can bring data in (S3.2).
///
/// Build-time information about the binary, like [`vpl_operations`] - the catalogue is derived from
/// the operation registry, so it cannot offer something this build cannot do.
#[tauri::command]
#[specta::specta]
pub fn import_kinds() -> Vec<studio_core::import::ImportKind> {
	studio_core::import::kinds()
}

/// Which kind a path belongs to, or `None` for a file Studio has no way in for.
///
/// Asked here rather than matched in the webview so that one list of extensions serves the dialog,
/// the drop target and the cards - three places that had already started to disagree.
#[tauri::command]
#[specta::specta]
pub fn import_kind_for(path: String) -> Option<studio_core::import::ImportKind> {
	studio_core::import::kind_for(&path)
}

/// The read node a chosen file becomes - `from_geo filename='…'`, quoting included.
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
/// every node needs its own answer - one `from_csv` reading `a.csv` has nothing to say about
/// another reading `b.csv`. It used to take a path, which was correct only while a single node had
/// a form to fill in.
///
/// One call rather than one per node: `for_node` refuses anything that is not a `from_csv` before
/// it touches a disk, so the sweep costs a header read per CSV node and a string comparison for the
/// rest.
#[tauri::command]
#[specta::specta]
pub async fn field_suggestions(
	window: tauri::Window,
	state: State<'_, AppState>,
	graph: GraphId,
) -> Result<Vec<studio_core::suggest::NodeSuggestions>, String> {
	let held = state.project(&window).await;
	let (document, dir) = {
		let project = held.lock().await;
		let Some(document) = project.graphs.get(graph).map(|g| g.document.clone()) else {
			return Ok(Vec::new());
		};
		(document, project.dir.clone())
	};
	Ok(studio_core::suggest::for_pipeline(document.pipeline(), &dir))
}
