//! Server manager — lifecycle of the **single** embedded server.
//!
//! One server for the whole application ([Q16]). Each project and each previewed pipeline node is a
//! named **mount**, not a server of its own: `add_tile_source` and `remove_tile_source` work on a
//! running server, so reconfiguring a preview never restarts anything.
//!
//! Binds to loopback only. The data plane is HTTP because Tauri serialises command returns as JSON,
//! which its own docs warn is slow for large payloads — so tile bytes must not travel over IPC
//! ([Q3]).
//!
//! [Q16]: ../../../docs/decisions.md
//! [Q3]: ../../../docs/decisions.md

use anyhow::{Context, Result};
use std::{path::Path, sync::Arc};
use versatiles::{config::Config, server::TileServer};
use versatiles_container::{TileSource, TilesRuntime};

/// Owns the embedded server and the runtime it reads containers with.
pub struct ServerManager {
	server: TileServer,
	runtime: TilesRuntime,
}

impl ServerManager {
	/// Starts a server on an ephemeral loopback port.
	///
	/// Port 0 lets the OS choose, which avoids both a fixed-port collision and the firewall prompt
	/// that binding a predictable port on a non-loopback interface would trigger.
	pub async fn start() -> Result<Self> {
		let runtime = versatiles::runtime::create_runtime();
		let config = Config {
			server: versatiles::config::ServerConfig {
				ip: Some("127.0.0.1".to_string()),
				port: Some(0),
				..Default::default()
			},
			..Default::default()
		};

		let mut server = TileServer::from_config(config, runtime.clone())
			.await
			.context("building the embedded tile server")?;
		server.start().await.context("starting the embedded tile server")?;

		Ok(Self { server, runtime })
	}

	/// The loopback port the server actually bound to.
	#[must_use]
	pub fn port(&self) -> u16 {
		self.server.port()
	}

	/// Base URL for the webview to fetch tiles from.
	#[must_use]
	pub fn base_url(&self) -> String {
		format!("http://127.0.0.1:{}", self.port())
	}

	/// Mounts a tile source under `name`, replacing any mount already using it.
	pub async fn mount(&mut self, name: &str, source: Arc<Box<dyn TileSource>>) -> Result<()> {
		self
			.server
			.add_tile_source(name.to_string(), source)
			.await
			.with_context(|| format!("mounting tile source {name:?}"))
	}

	/// Removes a mount. Returns whether one was there.
	pub fn unmount(&mut self, name: &str) -> Result<bool> {
		self
			.server
			.remove_tile_source(name)
			.with_context(|| format!("unmounting tile source {name:?}"))
	}

	/// Mounts a static archive under `url_prefix`, e.g. `glyphs.tar.gz` at `/assets/glyphs`.
	///
	/// The archive is served **as an archive** — `.tar`, `.tar.gz` and `.tar.br` are all read in
	/// place, so the 512 glyph files inside never touch the disk ([Q9]). Unpacking them would cost
	/// nothing here and everything on Windows, and would make the asset non-atomic to replace.
	///
	/// [Q9]: ../../../docs/decisions.md
	pub async fn mount_static(&mut self, path: &Path, url_prefix: &str) -> Result<()> {
		self
			.server
			.add_static_source(path, url_prefix)
			.await
			.with_context(|| format!("mounting {} at {url_prefix}", path.display()))
	}

	/// The runtime containers are opened with — shared so readers are reused across mounts.
	#[must_use]
	pub fn runtime(&self) -> &TilesRuntime {
		&self.runtime
	}

	/// Stops the server. Consuming `self` makes use-after-stop a compile error.
	pub async fn stop(mut self) {
		self.server.stop().await;
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The point of the core being Tauri-free ([Q3]): this exercises the whole data plane with no
	/// Tauri runtime anywhere.
	///
	/// [Q3]: ../../../docs/decisions.md
	#[tokio::test]
	async fn starts_on_an_ephemeral_loopback_port() -> Result<()> {
		let server = ServerManager::start().await?;

		assert_ne!(server.port(), 0, "the OS should have assigned a real port");
		assert_eq!(server.base_url(), format!("http://127.0.0.1:{}", server.port()));

		server.stop().await;
		Ok(())
	}

	/// The bundled tier, end to end: mount the real archive and fetch a glyph range over HTTP.
	///
	/// Skipped when the resources have not been fetched yet, so a fresh clone still passes
	/// `cargo test` before `npm run assets:fetch` has run.
	#[tokio::test]
	async fn serves_bundled_glyphs_straight_from_the_archive() -> Result<()> {
		let archive = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/resources/glyphs.tar.gz");
		if !archive.exists() {
			eprintln!("skipping: run `npm run assets:fetch` first");
			return Ok(());
		}

		let mut server = ServerManager::start().await?;
		server.mount_static(&archive, "/assets/glyphs").await?;

		let url = format!("{}/assets/glyphs/noto_sans_regular/0-255.pbf", server.base_url());
		let response = reqwest::get(&url).await?;

		assert_eq!(
			response.status(),
			200,
			"glyph range should be served from inside the archive"
		);
		assert!(
			!response.bytes().await?.is_empty(),
			"0-255 is Latin, so it must not be an empty tile"
		);

		server.stop().await;
		Ok(())
	}

	/// The whole S1.2 path: open a container, mount it, fetch a tile over HTTP — no Tauri anywhere.
	#[tokio::test]
	async fn serves_tiles_from_a_mounted_container() -> Result<()> {
		let Some(path) = crate::analysis::tests::sample_container("berlin.versatiles") else {
			eprintln!("skipping: set STUDIO_TESTDATA to a directory of sample containers");
			return Ok(());
		};

		let mut server = ServerManager::start().await?;
		let (reader, info) = crate::analysis::open(server.runtime(), path.to_str().unwrap()).await?;
		server.mount("berlin", reader).await?;

		// A tile that must exist: the top-left tile of the container's own minimum zoom.
		let url = format!("{}/tiles/berlin/{}/0/0", server.base_url(), info.min_zoom);
		let status = reqwest::get(&url).await?.status();
		assert!(
			status.is_success() || status == 204,
			"mounted container should answer at {url}, got {status}"
		);

		// And unmounting really removes it.
		assert!(server.unmount("berlin")?);
		server.stop().await;
		Ok(())
	}

	#[tokio::test]
	async fn unmounting_an_absent_source_is_not_an_error() -> Result<()> {
		let mut server = ServerManager::start().await?;

		assert!(!server.unmount("nothing-here")?, "no mount should have been removed");

		server.stop().await;
		Ok(())
	}
}
