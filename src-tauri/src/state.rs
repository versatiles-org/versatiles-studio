//! Application state owned by the Tauri process.
//!
//! Everything durable lives in the core, not the webview ([Q16]) — this struct is what the commands
//! reach through to get there.
//!
//! [Q6]: ../../docs/decisions.md
//! [Q16]: ../../docs/decisions.md
//! [Q22]: ../../docs/decisions.md
//! [Q25]: ../../docs/decisions.md

use std::path::PathBuf;
use studio_core::{
	history::History,
	server::ServerManager,
	store::{Bookmarks, Layout, Recents},
	vpl::Document,
};
use tokio::sync::Mutex;

pub struct AppState {
	/// One embedded server for the whole application; projects are named mounts on it.
	pub server: Mutex<ServerManager>,
	/// Recent sources and bookmarks. The core owns the lists; this layer owns where they live.
	pub recents: Mutex<Recents>,
	pub bookmarks: Mutex<Bookmarks>,
	/// Which left-pane sections are open, and how wide the pane is (S2.2, [Q22]).
	pub layout: Mutex<Layout>,
	/// **The** pipeline for this window — one document, owned here rather than in the webview
	/// ([Q25]). `None` until something is opened; a project holds exactly one `pipeline.vpl`
	/// ([Q6]).
	pub pipeline: Mutex<Option<Document>>,
	/// One undo stack for the document, whichever view an edit came from ([Q11], G6).
	pub history: Mutex<History>,
	/// What relative paths in the VPL resolve against.
	///
	/// A `.vpl` file's paths are relative to **that file**, the way `versatiles convert` resolves
	/// them, so opening one moves this. Before any is opened it is wherever Studio was started; it
	/// becomes the project directory once [Q6] has one.
	pub project_dir: Mutex<PathBuf>,
	/// Where these files live. `app_data_dir`, not `app_config_dir`: these are user *data*, not
	/// configuration. Invisible on macOS — both land in Application Support — but on Linux it is
	/// `~/.local/share` versus `~/.config`, and bookmarks belong in the former. The store owns the
	/// filenames inside it.
	pub data_dir: PathBuf,
}
