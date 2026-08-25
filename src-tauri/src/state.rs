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
pub struct Project {
	/// What this project's mounts are named after on the shared server ([S7.2]).
	///
	/// The window's label, reduced to what a URL path segment can hold. One server serves the whole
	/// application ([Q16]), so without this two windows each holding a graph called `pipeline` —
	/// which is what a container import names its first graph — mount over each other, and each
	/// window draws the other's tiles. No error, no failed job: plausible tiles from the wrong
	/// project.
	///
	/// [S7.2]: ../../docs/scope-release-3.md
	prefix: String,
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
	/// Which panes are open, how wide they are, the background, and where the camera is looking.
	///
	/// **Per project** ([S7.4](../../docs/scope-release-3.md)) — it reads as pane state and is not:
	/// `view` is the camera and `background` is a map setting, and two windows sharing them meant
	/// panning one panned the other the next time either saved.
	pub layout: Layout,
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
	fn new(label: &str, layout: Layout) -> Self {
		Self {
			layout,
			prefix: label
				.chars()
				.map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
				.collect(),
			graphs: Graphs::new(),
			style: Recipe::default(),
			history: History::new(),
			pinned: None,
			dir: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
			root: None,
		}
	}

	/// What `name` is mounted under on the shared server.
	///
	/// **A dot, because a mount name is one path segment** of `/tiles/{name}/{z}/{x}/{y}` — a slash
	/// would change the shape of the URL rather than the name in it.
	#[must_use]
	pub fn mount(&self, name: &str) -> String {
		format!("{}.{name}", self.prefix)
	}

	/// Everything this project has mounted, for taking it all down at once.
	#[must_use]
	pub fn mounts(&self) -> String {
		format!("{}.", self.prefix)
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
	///
	/// A new one opens on `layout` — what the last window to change one left behind, which is how a
	/// second window gets the pane widths and the background someone has settled on rather than the
	/// defaults they moved away from.
	pub async fn of(&self, label: &str, layout: &Layout) -> Arc<Mutex<Project>> {
		Arc::clone(
			self
				.0
				.lock()
				.await
				.entry(label.to_string())
				.or_insert_with(|| Arc::new(Mutex::new(Project::new(label, layout.clone())))),
		)
	}

	/// This window's project **if it has one**, without creating it.
	///
	/// For asking about a window rather than acting in it — the menu, which is redrawn on focus and
	/// must not bring a project into existence by being looked at (S7.8).
	pub async fn peek(&self, label: &str) -> Option<Arc<Mutex<Project>>> {
		self.0.lock().await.get(label).map(Arc::clone)
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
	/// What a **new** project's layout starts as: the last one any window saved (S7.4).
	///
	/// Not the layout of anything. The live one belongs to a project — [`Project::layout`] — and this
	/// is only what the next window inherits, which is also all that `layout.json` was ever able to
	/// mean once there was more than one window.
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
		// **Without the camera.** Pane widths and a background are preferences worth carrying into a
		// new window; where another project's map was looking is not — and `None` already means
		// "nothing to restore", which leaves a new window free to frame whatever it opens.
		let layout = Layout {
			view: None,
			..self.layout.lock().await.clone()
		};
		self.projects.of(window.label(), &layout).await
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
			let held = projects.of("window-1", &Layout::default()).await;
			held.lock().await.graphs.add(
				"berlin",
				studio_core::vpl::Document::parse("from_container filename=\"x\"").expect("parses"),
				None,
			);
		}

		assert_eq!(
			projects
				.of("window-1", &Layout::default())
				.await
				.lock()
				.await
				.graphs
				.list()
				.len(),
			1
		);
		assert_eq!(
			projects
				.of("window-2", &Layout::default())
				.await
				.lock()
				.await
				.graphs
				.list()
				.len(),
			0,
			"a second window starts empty rather than inheriting the first's work"
		);
	}

	/// Asking twice is asking about the same project — a window's work must not depend on which
	/// command reached for it first.
	#[tokio::test]
	async fn the_same_window_gets_the_same_project() {
		let projects = Projects::default();
		let first = projects.of("window-1", &Layout::default()).await;
		let second = projects.of("window-1", &Layout::default()).await;
		assert!(Arc::ptr_eq(&first, &second));
	}

	/// A closed window's project goes with it; the label coming back is a new project, not that one.
	#[tokio::test]
	async fn closing_forgets_the_project() {
		let projects = Projects::default();
		projects
			.of("window-1", &Layout::default())
			.await
			.lock()
			.await
			.graphs
			.add(
				"berlin",
				studio_core::vpl::Document::parse("from_container filename=\"x\"").expect("parses"),
				None,
			);

		assert!(projects.close("window-1").await.is_some());
		assert!(
			projects
				.of("window-1", &Layout::default())
				.await
				.lock()
				.await
				.graphs
				.list()
				.is_empty(),
			"a reused label is a fresh project, not the one that was closed"
		);
	}

	/// The collision S7.2 exists for, and the one nothing else catches.
	///
	/// Two windows each holding a graph called `pipeline` — which is what a container import names
	/// its first graph — mounted over each other on the one shared server. Each window then drew the
	/// other's tiles: no error, no failed job, nothing in the problem log.
	#[tokio::test]
	async fn two_windows_do_not_serve_each_others_tiles() {
		let projects = Projects::default();
		let first = projects.of("window-1", &Layout::default()).await;
		let second = projects.of("window-2", &Layout::default()).await;

		let (a, b) = (
			first.lock().await.mount("pipeline"),
			second.lock().await.mount("pipeline"),
		);
		assert_ne!(a, b);
		// The pinned preview was worse: every window's pin was the literal `preview` mount.
		assert_ne!(
			first.lock().await.mount("preview"),
			second.lock().await.mount("preview")
		);
	}

	/// Within one window a mount name still means one thing, so re-opening replaces rather than
	/// accumulates — the rule `mount_name` was written for, now scoped rather than dropped.
	#[tokio::test]
	async fn one_window_mounts_one_name_one_way() {
		let projects = Projects::default();
		let held = projects.of("window-1", &Layout::default()).await;
		let project = held.lock().await;
		assert_eq!(project.mount("berlin"), project.mount("berlin"));
	}

	/// A mount name is one path segment of `/tiles/{name}/{z}/{x}/{y}`.
	#[tokio::test]
	async fn a_mount_name_stays_inside_its_path_segment() {
		let projects = Projects::default();
		let held = projects.of("window/1:odd", &Layout::default()).await;
		let mounted = held.lock().await.mount("berlin");
		assert!(!mounted.contains('/'), "{mounted}");
		assert!(!mounted.contains(':'), "{mounted}");
	}

	/// What a closing window takes down with it — everything under its prefix and nothing else.
	#[tokio::test]
	async fn a_projects_mounts_are_recognisable_as_its_own() {
		let projects = Projects::default();
		let first = projects.of("window-1", &Layout::default()).await;
		let second = projects.of("window-2", &Layout::default()).await;
		let (prefix, theirs) = (first.lock().await.mounts(), second.lock().await.mount("pipeline"));

		assert!(first.lock().await.mount("pipeline").starts_with(&prefix));
		assert!(
			!theirs.starts_with(&prefix),
			"another window's mount is not ours to unmount"
		);
	}

	/// The collision S7.4 exists for: `Layout` reads as pane state and carries the camera.
	#[tokio::test]
	async fn two_windows_look_wherever_each_of_them_is_looking() {
		let projects = Projects::default();
		let first = projects.of("window-1", &Layout::default()).await;
		let second = projects.of("window-2", &Layout::default()).await;

		first.lock().await.layout.view = Some(studio_core::store::Camera {
			lng: 13.4,
			lat: 52.5,
			zoom: 11.0,
			bearing: 0.0,
			pitch: 0.0,
		});

		assert!(
			second.lock().await.layout.view.is_none(),
			"panning in one window moved the other's camera"
		);
	}

	/// What a second window inherits, and the one thing it does not.
	#[tokio::test]
	async fn a_new_window_inherits_the_widths_but_not_the_view() {
		let settled = Layout {
			left_width: 420.0,
			background: "graybeard".to_string(),
			view: Some(studio_core::store::Camera {
				lng: 13.4,
				lat: 52.5,
				zoom: 11.0,
				bearing: 0.0,
				pitch: 0.0,
			}),
			..Layout::default()
		};

		// What `AppState::project` hands in: the defaults, minus where somebody else was looking.
		let seed = Layout { view: None, ..settled };
		let held = Projects::default().of("window-2", &seed).await;
		let project = held.lock().await;

		assert_eq!(project.layout.left_width, 420.0, "a preference worth carrying over");
		assert_eq!(project.layout.background, "graybeard");
		assert!(
			project.layout.view.is_none(),
			"another project's camera means nothing here — `None` leaves this one free to frame what it opens"
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
		let held = projects.of("window-1", &Layout::default()).await;
		let project = held.lock().await;
		assert!(project.dir.is_absolute() || project.dir == Path::new("."));
		assert!(project.root.is_none(), "nothing has been saved yet");
	}
}
