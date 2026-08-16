//! Window management — one window per project ([Q16]).
//!
//! Each `WebviewWindow` is its own OS process, which is where the crash isolation comes from. The
//! core holds everything durable, so a window that dies can be reopened without losing work.
//!
//! [Q16]: ../../docs/decisions.md

use anyhow::{Context, Result};
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

/// Opens `STUDIO_WINDOWS` extra windows at startup.
///
/// A measurement affordance for S0.8, which found ~28 MB per window
/// ([Q16](../../docs/decisions.md)). Kept because that figure came from an empty page — it has to be
/// taken again at S1 with a real map on screen. Remove once ⌘N exists and S1 has re-measured.
pub fn open_extra_from_env(app: &AppHandle) -> Result<()> {
	let Ok(raw) = std::env::var("STUDIO_WINDOWS") else {
		return Ok(());
	};
	let count: usize = raw.parse().unwrap_or(0);
	for i in 1..count {
		open(app, &format!("measure-{i}"))?;
	}
	Ok(())
}
