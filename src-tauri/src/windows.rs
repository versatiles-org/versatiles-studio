//! Window management — one window per project ([Q16]).
//!
//! Each `WebviewWindow` is its own OS process, which is where the crash isolation comes from. The
//! core holds everything durable, so a window that dies can be reopened without losing work.
//!
//! [Q16]: ../../docs/decisions.md

use anyhow::{Context, Result};
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

/// Opens a window with the given label.
pub fn open(app: &AppHandle, label: &str) -> Result<()> {
	WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
		.title("VersaTiles Studio")
		.inner_size(1280.0, 800.0)
		.min_inner_size(900.0, 600.0)
		.build()
		.with_context(|| format!("opening window {label:?}"))?;
	Ok(())
}

/// Opens a new window with a label nothing else is using.
///
/// **The label is generated here rather than asked for.** It has to be unique for the lifetime of
/// the process, and a webview picking its own would have to know about every window but its own to
/// avoid a collision. The pattern matters beyond uniqueness: `capabilities/default.json` grants
/// permissions to `main` and `window-*`, so a window named outside that scheme would open and then
/// be unable to call a single command.
pub fn open_new(app: &AppHandle) -> Result<()> {
	static NEXT: AtomicU32 = AtomicU32::new(1);
	open(app, &format!("window-{}", NEXT.fetch_add(1, Ordering::Relaxed)))
}

/// Opens `STUDIO_WINDOWS` extra windows at startup.
///
/// A measurement affordance for S0.8, which found ~28 MB per window
/// ([Q16](../../docs/decisions.md)). Kept because that figure came from an empty page — it has to be
/// taken again at S1 with a real map on screen. Remove once S1 has re-measured — ⌘N now exists,
/// and these are named `window-…` for the same capability reason [`open_new`] explains.
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
