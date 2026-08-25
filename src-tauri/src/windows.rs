//! Window management - one window per project ([Q16]).
//!
//! Each `WebviewWindow` is its own OS process, which is where the crash isolation comes from. The
//! core holds everything durable, so a window that dies can be reopened without losing work.
//!
//! [Q16]: ../../docs/decisions.md

use anyhow::{Context, Result};
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

/// The label the launcher always has.
///
/// One launcher, not one per press: it holds nothing, so a second would be a duplicate of a window
/// that is already asking the same question. Inside `window-*` because the capability grants nothing
/// to a label outside it.
pub const LAUNCHER: &str = "window-launcher";

/// Whether windows should open without appearing.
///
/// **For the end-to-end suite, and only for it.** Every spec opens a window and closes it again, so
/// running the suite on the machine you are working on means a minute of windows taking focus and
/// flashing past. The driver reaches the webview rather than the screen - it finds elements and
/// dispatches events inside the page - so a window it never shows is one it can still drive.
///
/// Compiled in only under `e2e`, like the data directory it sits beside: a shipped build has no
/// environment variable that can make Studio start invisibly ([the plan](../../docs/scope-e2e.md)).
#[cfg(feature = "e2e")]
fn hidden() -> bool {
	std::env::var_os("STUDIO_HIDDEN").is_some()
}

#[cfg(not(feature = "e2e"))]
fn hidden() -> bool {
	false
}

/// Opens a project window with the given label.
pub fn open(app: &AppHandle, label: &str) -> Result<()> {
	WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
		.title("VersaTiles Studio")
		.inner_size(1280.0, 800.0)
		.min_inner_size(900.0, 600.0)
		.visible(!hidden())
		// Drag and drop is on by default - `tauri.conf.json` said so explicitly and no longer
		// describes a window at all (S7.7). The builder can only turn it *off*, which is what makes
		// the default safe to rely on rather than something this has to restate.
		.build()
		.with_context(|| format!("opening window {label:?}"))?;
	Ok(())
}

/// The label the next project window will have.
///
/// Handed out before the window is built so a caller can queue what that window should open
/// ([S7.6](../../docs/scope-release-3.md)) - a webview boots asynchronously, and a handoff that
/// waited for it would be racing the thing it is handing off to.
pub fn next_label() -> String {
	static NEXT: AtomicU32 = AtomicU32::new(1);
	format!("window-{}", NEXT.fetch_add(1, Ordering::Relaxed))
}

/// Opens the launcher, or brings the one that is already open to the front (S7.5, [Q48]).
///
/// **Its own page**, not the workbench with the workbench hidden: `landing.html` loads a few cards
/// and a list of recent files, and none of MapLibre. Small and fixed-ish, because it is a launcher
/// and a launcher that opens at 1280×800 looks like an application that failed to load.
///
/// [Q48]: ../../docs/decisions.md
pub fn open_launcher(app: &AppHandle) -> Result<()> {
	if let Some(existing) = tauri::Manager::get_webview_window(app, LAUNCHER) {
		// Focusing a window that was asked not to appear would put it on screen, which is the one
		// thing the suite is asking not to happen.
		if !hidden() {
			existing.set_focus().context("focusing the launcher")?;
		}
		return Ok(());
	}

	WebviewWindowBuilder::new(app, LAUNCHER, WebviewUrl::App("landing.html".into()))
		.title("VersaTiles Studio")
		// Two columns: the ways in on the left, what was open recently on the right. Wider than tall
		// because the recent list is the returning half of this window and needs room to be a list
		// rather than a preview of one.
		.inner_size(880.0, 580.0)
		.min_inner_size(720.0, 480.0)
		.resizable(true)
		.visible(!hidden())
		.build()
		.context("opening the launcher")?;
	Ok(())
}

/// Whether any window is holding a project - the launcher does not count.
///
/// What tells "there is somewhere to open this" from "Studio is showing nothing", which is the
/// question both startup and a file arriving from the operating system have to answer
/// ([S7.7](../../docs/scope-release-3.md)).
pub fn any_project_open(app: &AppHandle) -> bool {
	tauri::Manager::webview_windows(app)
		.keys()
		.any(|label| label != LAUNCHER)
}

/// Closes the launcher if it is open. Its question has been answered.
pub fn close_launcher(app: &AppHandle) {
	if let Some(launcher) = tauri::Manager::get_webview_window(app, LAUNCHER) {
		let _ = launcher.close();
	}
}

/// Opens `STUDIO_WINDOWS` extra windows at startup.
///
/// A measurement affordance for S0.8, which found ~28 MB per window
/// ([Q16](../../docs/decisions.md)). Kept because that figure came from an empty page - it has to be
/// taken again at S1 with a real map on screen. Remove once S1 has re-measured - ⌘N now exists,
/// and these are named `window-…` for the same capability reason [`next_label`] explains.
pub fn open_extra_from_env(app: &AppHandle) -> Result<()> {
	let Ok(raw) = std::env::var("STUDIO_WINDOWS") else {
		return Ok(());
	};
	let count: usize = raw.parse().unwrap_or(0);
	for i in 1..count {
		open(app, &format!("window-measure-{i}"))?;
	}
	Ok(())
}
