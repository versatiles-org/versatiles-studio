//! Files the operating system asks Studio to open (S0.1).
//!
//! Declaring the associations in `tauri.conf.json` only tells the OS which application owns
//! `.versatiles`, `.mbtiles`, `.pmtiles` and `.vpl`. Receiving the file is a separate problem, and
//! the two platforms disagree about how:
//!
//! * **macOS** delivers it as a `RunEvent::Opened` with URLs — before the window exists at launch,
//!   and again at any time while the application is already running.
//! * **Linux** passes it as a command-line argument, once, at launch.
//!
//! Both end up in the same queue. The webview drains it when it is ready and again whenever it is
//! told something arrived, so a file that landed before the window existed is not lost.
//!
//! **The MIME types are ours, because nobody else has one.** None of the four formats is registered
//! with IANA, and freedesktop's `shared-mime-info` knows none of them — not `.mbtiles`, `.pmtiles`
//! or even GeoPackage — so there is no convention to match and each association declares a
//! `vnd.` string of its own. `x-` would be the older habit and RFC 6648 deprecates it for new types.
//!
//! `.mbtiles` said `application/vnd.mapbox-vector-tile` until 2026-08-23, which was wrong twice
//! over: that type is the *tile* payload, and an MBTiles file is a SQLite container that as often
//! holds PNG or WebP. It is `application/vnd.mbtiles`, matching its two neighbours. The one thing
//! this cannot express is that it is a SQLite database — freedesktop would say
//! `sub-class-of application/vnd.sqlite3`, the way it does for Kexi, and Tauri's association takes
//! a single string. Claiming `application/vnd.sqlite3` outright is the trap to avoid: Studio would
//! offer to open every SQLite file on the machine.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Paths waiting for a webview to pick them up.
///
/// **Two queues, because there are two ways a path arrives** ([S7.6](../../docs/scope-release-3.md)):
///
/// * *For a window*, which is the launcher's handoff — it creates a project window and hands that
///   window the thing it was asked to open. Only that window may take it.
/// * *For nobody in particular*, which is the operating system asking before any window exists. The
///   first window to ask takes it, which is the behaviour a double-clicked file has always had.
#[derive(Default)]
pub struct PendingOpen(Mutex<Queues>);

#[derive(Default)]
struct Queues {
	claimed: HashMap<String, Vec<String>>,
	unclaimed: Vec<String>,
}

impl PendingOpen {
	/// Queues paths for one window. Waits there however long that window takes to start.
	pub fn push_for(&self, label: &str, paths: impl IntoIterator<Item = String>) {
		if let Ok(mut queues) = self.0.lock() {
			queues.claimed.entry(label.to_string()).or_default().extend(paths);
		}
	}

	/// Queues paths for whichever window asks first.
	pub fn push(&self, paths: impl IntoIterator<Item = String>) {
		if let Ok(mut queues) = self.0.lock() {
			queues.unclaimed.extend(paths);
		}
	}

	/// Takes what is waiting for this window, and anything waiting for nobody.
	///
	/// Draining rather than reading, so two windows cannot both open the same file.
	pub fn take(&self, label: &str) -> Vec<String> {
		let Ok(mut queues) = self.0.lock() else {
			return Vec::new();
		};
		let mut taken = queues.claimed.remove(label).unwrap_or_default();
		taken.append(&mut queues.unclaimed);
		taken
	}

	/// Forgets what was waiting for a window that will never ask — one that failed to open.
	pub fn forget(&self, label: &str) {
		if let Ok(mut queues) = self.0.lock() {
			queues.claimed.remove(label);
		}
	}
}

/// The event the webview listens for while it is already running.
pub const OPENED: &str = "studio://opened";

/// Paths passed on the command line, which is how Linux delivers a double-clicked file.
///
/// Skips anything that is not an existing file: the first argument is the executable, and `tauri
/// dev` adds its own flags.
#[must_use]
pub fn from_command_line() -> Vec<String> {
	std::env::args()
		.skip(1)
		.filter(|argument| !argument.starts_with('-'))
		.filter(|argument| PathBuf::from(argument).is_file())
		.collect()
}

/// Queues paths and tells any open window they are there.
pub fn receive(app: &AppHandle, paths: Vec<String>) {
	if paths.is_empty() {
		return;
	}
	app.state::<PendingOpen>().push(paths);
	// Best effort: with no window yet, the queue is what matters and the webview drains it on start.
	let _ = app.emit(OPENED, ());
}

/// Everything the OS has asked Studio to open since the last call.
#[tauri::command]
#[specta::specta]
pub fn take_opened(app: AppHandle, window: tauri::Window) -> Vec<String> {
	app.state::<PendingOpen>().take(window.label())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_queue_is_drained_not_read() {
		let pending = PendingOpen::default();
		pending.push(["/a.versatiles".to_string(), "/b.vpl".to_string()]);

		assert_eq!(pending.take("window-1"), ["/a.versatiles", "/b.vpl"]);
		assert!(
			pending.take("window-2").is_empty(),
			"a second window must not open the same files"
		);
	}

	/// The launcher's handoff: it names the window the file is for, and no other window may take it.
	#[test]
	fn a_path_meant_for_one_window_waits_for_that_window() {
		let pending = PendingOpen::default();
		pending.push_for("window-2", ["/berlin.versatiles".to_string()]);

		assert!(
			pending.take("window-1").is_empty(),
			"another window took the launcher's handoff"
		);
		assert_eq!(pending.take("window-2"), ["/berlin.versatiles"]);
		assert!(pending.take("window-2").is_empty(), "and only once");
	}

	/// A double-clicked file arrives before any window exists, so it waits for whoever asks first.
	#[test]
	fn a_window_takes_its_own_and_whatever_was_waiting_for_nobody() {
		let pending = PendingOpen::default();
		pending.push(["/from-the-os.versatiles".to_string()]);
		pending.push_for("window-2", ["/from-the-launcher.versatiles".to_string()]);

		assert_eq!(
			pending.take("window-2"),
			["/from-the-launcher.versatiles", "/from-the-os.versatiles"]
		);
	}

	/// A window that never opened would otherwise hold its handoff for the life of the process.
	#[test]
	fn forgetting_a_window_drops_what_was_waiting_for_it() {
		let pending = PendingOpen::default();
		pending.push_for("window-2", ["/berlin.versatiles".to_string()]);
		pending.forget("window-2");
		assert!(pending.take("window-2").is_empty());
	}

	/// The executable itself and any flags are not files to open.
	#[test]
	fn command_line_arguments_that_are_not_files_are_ignored() {
		// `from_command_line` reads the real argv, so this checks the filter it applies rather than
		// the arguments themselves — under `cargo test` they are the harness's own.
		for argument in std::env::args() {
			if argument.starts_with('-') {
				assert!(
					!from_command_line().contains(&argument),
					"a flag is not a file: {argument}"
				);
			}
		}
	}
}
