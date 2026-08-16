//! Application state owned by the Tauri process.
//!
//! Everything durable lives in the core, not the webview ([Q16]) — this struct is what the commands
//! reach through to get there.
//!
//! [Q16]: ../../docs/decisions.md

use std::path::PathBuf;
use studio_core::{project::Recents, server::ServerManager};
use tokio::sync::Mutex;

pub struct AppState {
	/// One embedded server for the whole application; projects are named mounts on it.
	pub server: Mutex<ServerManager>,
	/// Recently opened sources. The core owns the list; the platform layer owns where it lives.
	pub recents: Mutex<Recents>,
	pub recents_path: PathBuf,
}
