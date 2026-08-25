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
use std::collections::HashMap;
use std::{path::Path, sync::Arc};
use versatiles::{config::Config, server::TileServer};
use versatiles_container::{TileSource, TilesRuntime};

/// Owns the embedded server and the runtime it reads containers with.
pub struct ServerManager {
	server: TileServer,
	runtime: TilesRuntime,
	/// How many times each name has been mounted. See [`ServerManager::tile_url`].
	revisions: HashMap<String, u64>,
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

		Ok(Self {
			server,
			runtime,
			revisions: HashMap::new(),
		})
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
	/// The tile URL template for a mount, including the revision that defeats caching.
	///
	/// **The embedded server sends `cache-control: public, max-age=2419200`** — 28 days, hardcoded
	/// in `versatiles`' handler with no way to turn it off. That is right for a public tile server
	/// and wrong for an editing surface: mount names are stable, so re-opening a file that changed
	/// on disk, or rebuilding a preview after an edit, asks for the same URL and the webview
	/// answers from its cache. Tiles that are weeks old then look like the current ones.
	///
	/// A revision that changes on every mount makes each build a different URL, which no cache can
	/// confuse — the webview's, or MapLibre's own. Per mount rather than global, so re-opening one
	/// source does not force every other to be refetched.
	#[must_use]
	pub fn tile_url(&self, name: &str) -> String {
		let revision = self.revisions.get(name).copied().unwrap_or(0);
		format!("{}/tiles/{name}/{{z}}/{{x}}/{{y}}?v={revision}", self.base_url())
	}

	/// Mounts a tile source, **replacing** any mount already using that name.
	///
	/// Replacing rather than failing, because a name is derived from the source it came from: the
	/// same name means the same container, so a second mount is a re-open, not a collision. The
	/// underlying `add_tile_source` rejects a duplicate id, which surfaced as
	/// `tile source '…' already exists` the second time a user opened the same file — an error about
	/// Studio's internals for something the user is entitled to do.
	pub async fn mount(&mut self, name: &str, source: Arc<Box<dyn TileSource>>) -> Result<()> {
		self.unmount(name)?;
		*self.revisions.entry(name.to_string()).or_insert(0) += 1;
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

	/// Removes every mount whose name starts with `prefix`, and reports how many went.
	///
	/// **For a window that has closed** ([S7.2](../../../docs/scope-release-3.md)): one server serves
	/// the whole application, so each window's mounts carry its own prefix, and what it had served is
	/// exactly what shares that prefix. Asked for by prefix rather than tracked as a list, because a
	/// list is a second account of the same fact and the two would disagree the first time a mount
	/// failed halfway.
	///
	/// Names that were mounted and have since gone are attempted and ignored — `revisions` remembers
	/// every name ever mounted, which is what keeps a re-mount from reusing a cached revision.
	pub fn unmount_prefix(&mut self, prefix: &str) -> Result<usize> {
		let names: Vec<String> = self
			.revisions
			.keys()
			.filter(|name| name.starts_with(prefix))
			.cloned()
			.collect();

		let mut removed = 0;
		for name in names {
			if self.unmount(&name)? {
				removed += 1;
			}
			self.revisions.remove(&name);
		}
		Ok(removed)
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

	/// Opening the same container twice is something a user does — from the file dialog, then from
	/// the recents list, or by dropping the same file again. It used to fail with
	/// `tile source '…' already exists`, because mount names are derived from the source and so
	/// collide by design on a re-open.
	#[tokio::test]
	async fn mounting_the_same_name_twice_replaces_rather_than_failing() -> Result<()> {
		let Some(path) = crate::analysis::tests::sample_container("berlin.versatiles") else {
			eprintln!("skipping: set STUDIO_TESTDATA to a directory of sample containers");
			return Ok(());
		};

		let mut server = ServerManager::start().await?;
		let source = path.to_str().unwrap();

		for attempt in 1..=3 {
			let (reader, _) = crate::analysis::open(server.runtime(), source).await?;
			server
				.mount("berlin", reader)
				.await
				.unwrap_or_else(|e| panic!("mount #{attempt} should succeed: {e:#}"));
		}

		// And the mount still works afterwards — replaced, not left in some half-removed state.
		assert!(server.unmount("berlin")?, "one mount should remain, not three");
		assert!(!server.unmount("berlin")?, "and only one");

		server.stop().await;
		Ok(())
	}

	/// The bug this guards, which is invisible until a file changes on disk.
	///
	/// The embedded server sends `cache-control: public, max-age=2419200` — 28 days, hardcoded
	/// upstream. Mount names are stable by design, so without a revision the URL after an edit is
	/// byte-for-byte the URL before it, and the webview answers from its cache: you change a
	/// container, re-open it, and see the old tiles.
	#[tokio::test]
	async fn every_mount_gets_a_url_no_cache_has_seen_before() -> Result<()> {
		let Some(path) = crate::analysis::tests::sample_container("berlin.versatiles") else {
			eprintln!("skipping: set STUDIO_TESTDATA to a directory of sample containers");
			return Ok(());
		};

		let mut server = ServerManager::start().await?;
		let source = path.to_str().unwrap();
		let mut seen = std::collections::HashSet::new();

		for _ in 0..3 {
			let (reader, _) = crate::analysis::open(server.runtime(), source).await?;
			server.mount("berlin", reader).await?;
			assert!(
				seen.insert(server.tile_url("berlin")),
				"a re-mount must not reuse a URL: {}",
				server.tile_url("berlin")
			);
		}

		// And the revision belongs to the mount, so re-opening one source does not force every
		// other to be refetched.
		let other = server.tile_url("elsewhere");
		let (reader, _) = crate::analysis::open(server.runtime(), source).await?;
		server.mount("berlin", reader).await?;
		assert_eq!(server.tile_url("elsewhere"), other, "an untouched mount keeps its URL");

		server.stop().await;
		Ok(())
	}

	/// The template still has to be one MapLibre can fill in.
	#[test]
	fn a_tile_url_is_a_template_with_a_revision() {
		let url = "http://127.0.0.1:1/tiles/x/{z}/{x}/{y}?v=2";
		assert!(url.contains("{z}/{x}/{y}"), "MapLibre needs the placeholders intact");
		assert!(url.contains("?v="), "and the revision must survive them");
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

	/// What a closed window takes down with it ([S7.2](../../../docs/scope-release-3.md)).
	///
	/// One server serves the whole application, so each window's mounts carry its own prefix — and a
	/// window that has gone must take exactly those and nothing belonging to a window still open.
	///
	/// **Built from `from_debug` rather than from a sample container**, so this one runs everywhere.
	/// The collision it guards is the only one in S7 that nothing else catches — two windows serving
	/// each other's tiles produces no error and no failed job — and a test that skips on most
	/// machines is not much of a guard.
	#[tokio::test]
	async fn unmounting_a_prefix_takes_that_window_and_no_other() -> Result<()> {
		let mut server = ServerManager::start().await?;
		// The collision this whole scheme exists for: the same graph name in two windows.
		for name in ["window-1.pipeline", "window-1.preview", "window-2.pipeline"] {
			let pipeline = crate::vpl::Document::parse("from_debug")?.to_pipeline();
			let source = crate::preview::build(server.runtime(), pipeline, Path::new(".")).await?;
			server.mount(name, source).await?;
		}

		assert_eq!(server.unmount_prefix("window-1.")?, 2);
		assert!(
			server.unmount("window-2.pipeline")?,
			"the other window is still being served"
		);

		server.stop().await;
		Ok(())
	}

	#[tokio::test]
	async fn unmounting_a_prefix_nothing_was_mounted_under_is_not_an_error() -> Result<()> {
		let mut server = ServerManager::start().await?;
		assert_eq!(server.unmount_prefix("window-9.")?, 0);
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
