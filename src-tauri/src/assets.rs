//! Locating the bundled asset tier (S0.6).
//!
//! Sprites and Latin glyphs ship as archives inside the installer and are mounted on the embedded
//! server, never unpacked ([Q9]). This module exists only because a bundled resource lives in a
//! different place in dev than in a packaged app.
//!
//! [Q9]: ../../docs/decisions.md

use anyhow::{Context, Result};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Where `sprites.tar.gz` and `glyphs.tar.gz` are on this machine.
///
/// In a packaged app Tauri copies them next to the binary. In `tauri dev` there is no bundle, so
/// fall back to the source tree - which is also what makes a fresh clone work after
/// `npm run assets:fetch`.
pub fn resource_dir(app: &AppHandle) -> Result<PathBuf> {
	if let Ok(dir) = app.path().resource_dir() {
		let bundled = dir.join("resources");
		if bundled.join("glyphs.tar.gz").exists() {
			return Ok(bundled);
		}
		if dir.join("glyphs.tar.gz").exists() {
			return Ok(dir);
		}
	}

	let in_tree = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
	if in_tree.join("glyphs.tar.gz").exists() {
		return Ok(in_tree);
	}

	anyhow::bail!("bundled assets not found - run `npm run assets:fetch`")
}

/// Mounts the bundled tier on the embedded server.
///
/// Prefixes match what MapLibre asks for: `/assets/glyphs/{fontstack}/{range}.pbf` and
/// `/assets/sprites/basics/sprites.json`.
pub async fn mount_bundled(app: &AppHandle, server: &mut studio_core::server::ServerManager) -> Result<()> {
	let dir = resource_dir(app)?;
	server
		.mount_static(&dir.join("glyphs.tar.gz"), "/assets/glyphs")
		.await
		.context("mounting bundled glyphs")?;
	server
		.mount_static(&dir.join("sprites.tar.gz"), "/assets/sprites")
		.await
		.context("mounting bundled sprites")?;
	Ok(())
}

/// Mounts every installed font family beside the bundled tier (G7, S4.1).
///
/// **After the bundled one, and at the same prefix.** `add_static_source` pushes onto a list, so a
/// family is another place the server looks for `/assets/glyphs/{fontstack}/{range}.pbf` rather than
/// a replacement for the Latin subset that ships in the binary. A font stack the bundled tier does
/// not have is found in an installed archive; one it does is answered without touching them.
pub async fn mount_fonts(dir: &std::path::Path, server: &mut studio_core::server::ServerManager) -> Result<()> {
	for archive in studio_core::assets::installed(dir) {
		server
			.mount_static(&archive, "/assets/glyphs")
			.await
			.with_context(|| format!("mounting {}", archive.display()))?;
	}
	Ok(())
}
