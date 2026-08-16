//! Application state owned by the Tauri process.
//!
//! Everything durable lives in the core, not the webview ([Q16]) — this struct is what the commands
//! reach through to get there.
//!
//! [Q16]: ../../docs/decisions.md

use studio_core::server::ServerManager;
use tokio::sync::Mutex;

pub struct AppState {
	/// One embedded server for the whole application; projects are named mounts on it.
	pub server: Mutex<ServerManager>,
}
