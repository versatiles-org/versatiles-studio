//! Application state owned by the Tauri process.
//!
//! Everything durable lives in the core, not the webview ([Q16]) — this struct is what the commands
//! reach through to get there.
//!
//! [Q16]: ../../docs/decisions.md

use std::path::PathBuf;
use studio_core::{
	server::ServerManager,
	store::{Bookmarks, Recents},
};
use tokio::sync::Mutex;

pub struct AppState {
	/// One embedded server for the whole application; projects are named mounts on it.
	pub server: Mutex<ServerManager>,
	/// Recent sources and bookmarks. The core owns the lists; this layer owns where they live.
	pub recents: Mutex<Recents>,
	pub bookmarks: Mutex<Bookmarks>,
	/// Where both files live. `app_data_dir`, not `app_config_dir`: these are user *data*, not
	/// configuration. Invisible on macOS — both land in Application Support — but on Linux it is
	/// `~/.local/share` versus `~/.config`, and bookmarks belong in the former. The store owns the
	/// filenames inside it.
	pub data_dir: PathBuf,
}
