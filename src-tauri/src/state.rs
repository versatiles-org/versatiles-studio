//! Application state owned by the Tauri process.
//!
//! Everything durable lives in the core, not the webview ([Q16]) — this struct is what the commands
//! reach through to get there.
//!
//! **Two scopes, and the split is the whole of [S7.1](../../docs/scope-release-3.md).** What belongs
//! to the *application* — one embedded server, the job runner, the recent files, the problem log —
//! sits on [`AppState`]. What belongs to a *project* sits on [`Project`], and there is one of those
//! per window ([Q48]).
//!
//! Until S7.1 all of it was application-wide, so ⌘N opened a second window onto the same graphs,
//! the same undo stack and the same camera. Q16 decided one window per project at S0.8; this is
//! where that stops being a plan.
//!
//! [Q48]: ../../docs/decisions.md
//!
//! [Q6]: ../../docs/decisions.md
//! [Q16]: ../../docs/decisions.md
//! [Q22]: ../../docs/decisions.md
//! [Q25]: ../../docs/decisions.md
//! [Q32]: ../../docs/decisions.md

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use studio_core::{
	diagnostics::Diagnostics,
	graphs::{GraphId, Graphs},
	history::History,
	jobs::Jobs,
	server::ServerManager,
	store::{Layout, Recents, Views},
	style::Recipe,
};
use tauri::Window;

/// Which node, in which graph, the map is pinned to ([Q32]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pinned {
	pub graph: GraphId,
	/// The path `Pipeline::at_path` walks — a node index, then pairs of source and node index.
	pub path: Vec<usize>,
}
use tokio::sync::Mutex;

/// One project: the graphs, how they are drawn, and where on disk it all is.
///
/// **One of these per window** ([Q48]), which is what makes a window mean something. Everything here
/// was an application-wide `Mutex` on [`AppState`] until [S7.1](../../docs/scope-release-3.md), and
/// the giveaway that it should not have been is `history`: an undo stack shared between two projects
/// steps one of them back into the other's edit.
#[derive(Default)]
pub struct Project {
	/// **The project's graphs** — several named VPL documents, each producing one named tile
	/// source ([Q32]). Owned here rather than in the webview ([Q16]); each carries its own file and
	/// dirty state, which is why `pipeline_file` no longer exists beside this.
	pub graphs: Graphs,
	/// **The project's style**, as the recipe it is rendered from ([Q36], S4.2). One per project
	/// over every graph it serves ([Q32]); the webview turns it into a MapLibre style, because that
	/// is where the generator is.
	pub style: Recipe,
	/// One undo stack across every graph *and* the style, whichever view an edit came from
	/// ([Q11], [Q32], [Q36], G6) — and across this project only.
	pub history: History,
	/// The node whose output the map is showing, overriding the style ([Q32]). `None` is the
	/// ordinary state: the map draws every mounted graph.
	pub pinned: Option<Pinned>,
	/// What relative paths in the VPL resolve against.
	///
	/// A `.vpl` file's paths are relative to **that file**, the way `versatiles convert` resolves
	/// them, so opening one moves this. Before any is opened it is wherever Studio was started; it
	/// becomes the project directory once [Q6] has one.
	pub dir: PathBuf,
	/// The directory this project was last saved to or opened from, if any.
	///
	/// **Not `dir` above**, which starts at the working directory and only ever answers "what do
	/// relative paths mean". This answers a different question — *has this been saved, and where* —
	/// and the two disagree for the whole of a project's life until someone saves. Without it,
	/// "Save Project" would have to ask for a directory it already knows, which is what makes it
	/// indistinguishable from "Save Project As…".
	pub root: Option<PathBuf>,
}

impl Project {
	/// A project with nothing in it, resolving relative paths against the working directory.
	fn new() -> Self {
		Self {
			dir: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
			..Self::default()
		}
	}
}

/// Every open project, by the label of the window showing it.
///
/// **Keyed by window label** because that is the identity [Q16] describes, and because a reload
/// keeps it — which is what lets a window that crashed come back to its work rather than to an empty
/// one. Created when a window first asks for a project, so nothing has to know in advance which
/// windows will exist.
#[derive(Default)]
pub struct Projects(Mutex<HashMap<String, Arc<Mutex<Project>>>>);

impl Projects {
	/// This window's project, created empty if it has none yet.
	pub async fn of(&self, label: &str) -> Arc<Mutex<Project>> {
		Arc::clone(
			self
				.0
				.lock()
				.await
				.entry(label.to_string())
				.or_insert_with(|| Arc::new(Mutex::new(Project::new()))),
		)
	}

	/// Forgets a window's project. Called when the window is destroyed, not when it reloads.
	///
	/// Returns what was held, so the caller can take down what it had running — the server mounts
	/// belonging to it, once [S7.2](../../docs/scope-release-3.md) gives them names of their own.
	pub async fn close(&self, label: &str) -> Option<Arc<Mutex<Project>>> {
		self.0.lock().await.remove(label)
	}
}

pub struct AppState {
	/// One embedded server for the whole application; projects are named mounts on it.
	pub server: Mutex<ServerManager>,
	/// Recent sources and named views. The core owns the lists; this layer owns where they live.
	pub recents: Mutex<Recents>,
	pub views: Mutex<Views>,
	/// Which left-pane sections are open, and how wide the pane is (S2.2, [Q22]).
	pub layout: Mutex<Layout>,
	/// Every open project, one per window ([Q48], S7.1).
	pub projects: Projects,
	/// What has gone wrong this session, for the panel that lets a user copy it (S6.8).
	///
	/// Not behind a `Mutex` for the same reason `jobs` is not: it is `Clone` and locks its own ring.
	/// It has to be, in fact — the panic hook holds a clone of this from before any window exists,
	/// and a hook that had to reach through Tauri's state map could not run during start-up.
	pub diagnostics: Diagnostics,
	/// Where the problem log is written, and where the previous run's is read from.
	///
	/// `app_log_dir`, not `app_data_dir`: it is a log, it is what a user is asked to send, and every
	/// platform already has a place people know to look for one.
	pub log_dir: PathBuf,
	/// Long operations, their queue and their logs ([Q3], E7, S3.1).
	///
	/// Not behind a `Mutex`: the runner is `Clone` and locks its own registry, so a command that
	/// only wants to submit a job never waits on one that is listing them.
	pub jobs: Jobs,
	/// Where these files live. `app_data_dir`, not `app_config_dir`: these are user *data*, not
	/// configuration. Invisible on macOS — both land in Application Support — but on Linux it is
	/// `~/.local/share` versus `~/.config`, and views belong in the former. The store owns the
	/// filenames inside it.
	pub data_dir: PathBuf,
	/// Where installed font families live (G7, S4.1).
	///
	/// A directory of its own inside `data_dir`, because these are archives the server mounts by
	/// scanning the directory — and a scan that also found `recents.json` would try to serve it.
	pub asset_dir: PathBuf,
}

impl AppState {
	/// The project belonging to the window a command was called from.
	///
	/// **Every command that touches a project takes the window it came from**, rather than reaching
	/// for one global answer. Two lines at each of forty call sites, and the alternative — inferring
	/// the "current" project — is a guess that is wrong whenever two windows are open, which is the
	/// entire point of S7.1.
	pub async fn project(&self, window: &Window) -> Arc<Mutex<Project>> {
		self.projects.of(window.label()).await
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::path::Path;

	/// The rule S7.1 exists for: what one window is editing is not what another is editing.
	#[tokio::test]
	async fn two_windows_hold_two_projects() {
		let projects = Projects::default();

		{
			let held = projects.of("window-1").await;
			held.lock().await.graphs.add(
				"berlin",
				studio_core::vpl::Document::parse("from_container filename=\"x\"").expect("parses"),
				None,
			);
		}

		assert_eq!(projects.of("window-1").await.lock().await.graphs.list().len(), 1);
		assert_eq!(
			projects.of("window-2").await.lock().await.graphs.list().len(),
			0,
			"a second window starts empty rather than inheriting the first's work"
		);
	}

	/// Asking twice is asking about the same project — a window's work must not depend on which
	/// command reached for it first.
	#[tokio::test]
	async fn the_same_window_gets_the_same_project() {
		let projects = Projects::default();
		let first = projects.of("window-1").await;
		let second = projects.of("window-1").await;
		assert!(Arc::ptr_eq(&first, &second));
	}

	/// A closed window's project goes with it; the label coming back is a new project, not that one.
	#[tokio::test]
	async fn closing_forgets_the_project() {
		let projects = Projects::default();
		projects.of("window-1").await.lock().await.graphs.add(
			"berlin",
			studio_core::vpl::Document::parse("from_container filename=\"x\"").expect("parses"),
			None,
		);

		assert!(projects.close("window-1").await.is_some());
		assert!(
			projects.of("window-1").await.lock().await.graphs.list().is_empty(),
			"a reused label is a fresh project, not the one that was closed"
		);
	}

	#[tokio::test]
	async fn closing_a_window_that_never_asked_for_one_is_not_an_error() {
		assert!(Projects::default().close("window-9").await.is_none());
	}

	/// Relative paths in a VPL mean something from the moment a project exists, not once it is saved.
	#[tokio::test]
	async fn a_new_project_resolves_relative_paths_somewhere() {
		let projects = Projects::default();
		let held = projects.of("window-1").await;
		let project = held.lock().await;
		assert!(project.dir.is_absolute() || project.dir == Path::new("."));
		assert!(project.root.is_none(), "nothing has been saved yet");
	}
}
