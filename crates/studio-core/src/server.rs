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
use std::sync::Arc;
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

	#[tokio::test]
	async fn unmounting_an_absent_source_is_not_an_error() -> Result<()> {
		let mut server = ServerManager::start().await?;

		assert!(!server.unmount("nothing-here")?, "no mount should have been removed");

		server.stop().await;
		Ok(())
	}
}
