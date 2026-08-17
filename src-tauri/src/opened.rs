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

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Paths waiting for a webview to pick them up.
#[derive(Default)]
pub struct PendingOpen(Mutex<Vec<String>>);

impl PendingOpen {
	pub fn push(&self, paths: impl IntoIterator<Item = String>) {
		if let Ok(mut queue) = self.0.lock() {
			queue.extend(paths);
		}
	}

	/// Takes everything queued. Draining rather than reading, so two windows cannot both open it.
	pub fn take(&self) -> Vec<String> {
		self
			.0
			.lock()
			.map(|mut queue| std::mem::take(&mut *queue))
			.unwrap_or_default()
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
pub fn take_opened(app: AppHandle) -> Vec<String> {
	app.state::<PendingOpen>().take()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_queue_is_drained_not_read() {
		let pending = PendingOpen::default();
		pending.push(["/a.versatiles".to_string(), "/b.vpl".to_string()]);

		assert_eq!(pending.take(), ["/a.versatiles", "/b.vpl"]);
		assert!(
			pending.take().is_empty(),
			"a second window must not open the same files"
		);
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
