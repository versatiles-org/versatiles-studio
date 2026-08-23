//! Application state owned by the Tauri process.
//!
//! Everything durable lives in the core, not the webview ([Q16]) — this struct is what the commands
//! reach through to get there.
//!
//! [Q6]: ../../docs/decisions.md
//! [Q16]: ../../docs/decisions.md
//! [Q22]: ../../docs/decisions.md
//! [Q25]: ../../docs/decisions.md
//! [Q32]: ../../docs/decisions.md

use std::path::PathBuf;
use studio_core::{
	graphs::{GraphId, Graphs},
	history::History,
	jobs::Jobs,
	server::ServerManager,
	store::{Layout, Recents, Views},
	style::Recipe,
};

/// Which node, in which graph, the map is pinned to ([Q32]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pinned {
	pub graph: GraphId,
	/// The path `Pipeline::at_path` walks — a node index, then pairs of source and node index.
	pub path: Vec<usize>,
}
use tokio::sync::Mutex;

pub struct AppState {
	/// One embedded server for the whole application; projects are named mounts on it.
	pub server: Mutex<ServerManager>,
	/// Recent sources and named views. The core owns the lists; this layer owns where they live.
	pub recents: Mutex<Recents>,
	pub views: Mutex<Views>,
	/// Which left-pane sections are open, and how wide the pane is (S2.2, [Q22]).
	pub layout: Mutex<Layout>,
	/// **The project's graphs** — several named VPL documents, each producing one named tile
	/// source ([Q32]). Owned here rather than in the webview ([Q16]); each carries its own file and
	/// dirty state, which is why `pipeline_file` no longer exists beside this.
	pub graphs: Mutex<Graphs>,
	/// **The project's style**, as the recipe it is rendered from ([Q36], S4.2). One per project
	/// over every graph it serves ([Q32]); the webview turns it into a MapLibre style, because that
	/// is where the generator is.
	pub style: Mutex<Recipe>,
	/// One undo stack across every graph *and* the style, whichever view an edit came from
	/// ([Q11], [Q32], [Q36], G6).
	pub history: Mutex<History>,
	/// The node whose output the map is showing, overriding the style ([Q32]). `None` is the
	/// ordinary state: the map draws every mounted graph.
	pub pinned: Mutex<Option<Pinned>>,
	/// What relative paths in the VPL resolve against.
	///
	/// A `.vpl` file's paths are relative to **that file**, the way `versatiles convert` resolves
	/// them, so opening one moves this. Before any is opened it is wherever Studio was started; it
	/// becomes the project directory once [Q6] has one.
	pub project_dir: Mutex<PathBuf>,
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
