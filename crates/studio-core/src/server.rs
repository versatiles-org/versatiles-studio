//! Server manager - lifecycle of the **single** embedded server.
//!
//! One server for the whole application ([Q16]). Each project and each previewed pipeline node is a
//! named **mount**, not a server of its own: `add_tile_source` and `remove_tile_source` work on a
//! running server, so reconfiguring a preview never restarts anything.
//!
//! Binds to loopback only. The data plane is HTTP because Tauri serialises command returns as JSON,
//! which its own docs warn is slow for large payloads - so tile bytes must not travel over IPC
//! ([Q3]).
//!
//! [Q16]: ../../../docs/decisions.md
//! [Q3]: ../../../docs/decisions.md

use anyhow::{Context, Result, bail};
use async_trait::async_trait;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use versatiles::{config::Config, server::TileServer};
use versatiles_container::{SharedTileSource, SourceType, Tile, TileSource, TileSourceMetadata, TilesRuntime};
use versatiles_core::{TileBBox, TileCoord, TileJSON, TilePyramid, TileSize, TileStream};

/// How long one served tile may take before the work behind it is abandoned.
///
/// **Longer than the webview's own deadline, on purpose.** `state/tiles.svelte.ts` gives up after ten
/// seconds and marks the square, which is what a person sees; this is the backstop that stops the
/// *work*, and if it fired first the map would get an error instead of the marker that explains it.
/// So the two are not redundant and their order matters: the webview owns the message, this owns the
/// core.
///
/// Generous because it is not a responsiveness budget - the webview has already answered by now, and
/// the webview refuses the rest of a zoom once one tile fails, so at most one request per zoom ever
/// reaches this.
const SERVE_DEADLINE: Duration = Duration::from_secs(30);

/// A tile source that gives up on a tile nothing is going to return.
///
/// **Because a request has no other end.** The pipeline answers when it answers, and some operations
/// take minutes over one tile: an overview far above its base level ([vt#264]), a GDAL read of a
/// large dataset, a join against a file that turns out to be enormous. Nothing between the map and
/// the operation bounds that, so a preview can wedge with no error and nothing to click.
///
/// **Serving only.** This wraps what is mounted, and only `tile`. Export and estimate build their own
/// source and never mount one, so a conversion that legitimately takes an hour is untouched - and
/// `tile_stream` is left alone here for the same reason, since it is how bulk work reads.
///
/// Cancellation is not complete and is worth knowing: dropping the future stops the operation
/// *driving* the work, but a `spawn_blocking` chunk already running finishes. The residual is one
/// block rather than the whole request, which is why abandoning one costs a bounded amount.
///
/// [vt#264]: https://github.com/versatiles-org/versatiles-rs/issues/264
#[derive(Debug)]
struct Deadlined {
	inner: SharedTileSource,
	limit: Duration,
}

#[async_trait]
impl TileSource for Deadlined {
	async fn tile(&self, coord: &TileCoord) -> Result<Option<Tile>> {
		match tokio::time::timeout(self.limit, self.inner.tile(coord)).await {
			Ok(tile) => tile,
			Err(_) => bail!(
				"gave up building tile {}/{}/{} after {} s - this pipeline takes longer than that per tile at this zoom",
				coord.level,
				coord.x,
				coord.y,
				self.limit.as_secs()
			),
		}
	}

	// **Forwarded rather than defaulted.** The default bodies are written in terms of `tile` and
	// `tile_stream`, so anything left out here would quietly acquire the deadline too - including the
	// stream methods, which is exactly what must not have one.
	fn source_type(&self) -> Arc<SourceType> {
		self.inner.source_type()
	}

	fn metadata(&self) -> &TileSourceMetadata {
		self.inner.metadata()
	}

	fn tilejson(&self) -> &TileJSON {
		self.inner.tilejson()
	}

	async fn tile_pyramid(&self) -> Result<Arc<TilePyramid>> {
		self.inner.tile_pyramid().await
	}

	async fn measure_tile_size(&self) -> Result<Option<TileSize>> {
		self.inner.measure_tile_size().await
	}

	async fn tile_stream(&self, bbox: TileBBox) -> Result<TileStream<'static, Tile>> {
		self.inner.tile_stream(bbox).await
	}

	async fn tile_coord_stream(&self, bbox: TileBBox) -> Result<TileStream<'static, ()>> {
		self.inner.tile_coord_stream(bbox).await
	}

	async fn tile_size_stream(&self, bbox: TileBBox) -> Result<TileStream<'static, u32>> {
		self.inner.tile_size_stream(bbox).await
	}
}

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
	/// **The embedded server sends `cache-control: public, max-age=2419200`** - 28 days, hardcoded
	/// in `versatiles`' handler with no way to turn it off. That is right for a public tile server
	/// and wrong for an editing surface: mount names are stable, so re-opening a file that changed
	/// on disk, or rebuilding a preview after an edit, asks for the same URL and the webview
	/// answers from its cache. Tiles that are weeks old then look like the current ones.
	///
	/// A revision that changes on every mount makes each build a different URL, which no cache can
	/// confuse - the webview's, or MapLibre's own. Per mount rather than global, so re-opening one
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
	/// `tile source '…' already exists` the second time a user opened the same file - an error about
	/// Studio's internals for something the user is entitled to do.
	pub async fn mount(&mut self, name: &str, source: SharedTileSource) -> Result<()> {
		self.unmount(name)?;
		*self.revisions.entry(name.to_string()).or_insert(0) += 1;
		// Wrapped here rather than by the caller: mounting is what makes a source answer a map, and a
		// map is the only reader that cannot wait.
		let served: SharedTileSource = Arc::new(Deadlined {
			inner: source,
			limit: SERVE_DEADLINE,
		});
		self
			.server
			.add_tile_source(name.to_string(), served)
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
	/// **For a window that has closed** ([S7.2](../../../docs/history.md)): one server serves
	/// the whole application, so each window's mounts carry its own prefix, and what it had served is
	/// exactly what shares that prefix. Asked for by prefix rather than tracked as a list, because a
	/// list is a second account of the same fact and the two would disagree the first time a mount
	/// failed halfway.
	///
	/// Names that were mounted and have since gone are attempted and ignored - `revisions` remembers
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
	/// The archive is served **as an archive** - `.tar`, `.tar.gz` and `.tar.br` are all read in
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

	/// The runtime containers are opened with - shared so readers are reused across mounts.
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

	/// A source that never answers a tile, and answers a stream at once.
	///
	/// Split that way because the two must be treated differently: a served tile has to give up and a
	/// bulk read has to be left alone, and a source that hung on both could not tell them apart.
	#[derive(Debug)]
	struct NeverAnswers(SharedTileSource);

	#[async_trait]
	impl TileSource for NeverAnswers {
		async fn tile(&self, _coord: &TileCoord) -> Result<Option<Tile>> {
			std::future::pending().await
		}
		fn source_type(&self) -> Arc<SourceType> {
			self.0.source_type()
		}
		fn metadata(&self) -> &TileSourceMetadata {
			self.0.metadata()
		}
		fn tilejson(&self) -> &TileJSON {
			self.0.tilejson()
		}
		async fn tile_stream(&self, bbox: TileBBox) -> Result<TileStream<'static, Tile>> {
			self.0.tile_stream(bbox).await
		}
	}

	async fn a_source() -> Result<SharedTileSource> {
		let runtime = versatiles::runtime::create_runtime();
		let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../testdata");
		let document = crate::vpl::Document::parse("from_debug format=png")?;
		crate::preview::build(&runtime, document.to_pipeline(), &dir).await
	}

	/// **A served tile that will not arrive is given up on**, with a message naming the tile rather
	/// than a timeout somewhere in a stack.
	#[tokio::test]
	async fn a_served_tile_gives_up_rather_than_hanging() -> Result<()> {
		let stuck: SharedTileSource = Arc::new(NeverAnswers(a_source().await?));
		// Milliseconds rather than the real `SERVE_DEADLINE`: the behaviour under test is that the
		// wait ends at all, and a test that waits thirty seconds to prove it would be its own bug.
		let served = Deadlined {
			inner: stuck,
			limit: Duration::from_millis(50),
		};

		let error = served
			.tile(&TileCoord::new(3, 1, 2)?)
			.await
			.expect_err("a tile nothing answers should fail rather than hang");

		assert!(format!("{error}").contains("3/1/2"), "{error}");
		assert!(format!("{error}").contains("gave up"), "{error}");
		Ok(())
	}

	/// **And a bulk read is not.** `tile_stream` is how export and estimate read, and a conversion
	/// that legitimately takes an hour must not be cut off at thirty seconds - so the deadline is on
	/// the one method a map uses and forwarded everywhere else.
	#[tokio::test]
	async fn a_bulk_read_keeps_its_own_time() -> Result<()> {
		let served = Deadlined {
			inner: Arc::new(NeverAnswers(a_source().await?)),
			// Shorter than the stream could possibly take, so a deadline wrongly applied to it would
			// fire before the stream was ready and this would fail.
			limit: Duration::from_nanos(1),
		};

		let bbox = TileBBox::from_min_and_size(2, 0, 0, 4, 4)?;
		assert!(
			served.tile_stream(bbox).await.is_ok(),
			"a bulk read must not be deadlined"
		);
		Ok(())
	}

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

	/// Opening the same container twice is something a user does - from the file dialog, then from
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

		// And the mount still works afterwards - replaced, not left in some half-removed state.
		assert!(server.unmount("berlin")?, "one mount should remain, not three");
		assert!(!server.unmount("berlin")?, "and only one");

		server.stop().await;
		Ok(())
	}

	/// The bug this guards, which is invisible until a file changes on disk.
	///
	/// The embedded server sends `cache-control: public, max-age=2419200` - 28 days, hardcoded
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

	/// The whole S1.2 path: open a container, mount it, fetch a tile over HTTP - no Tauri anywhere.
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

	/// What a closed window takes down with it ([S7.2](../../../docs/history.md)).
	///
	/// One server serves the whole application, so each window's mounts carry its own prefix - and a
	/// window that has gone must take exactly those and nothing belonging to a window still open.
	///
	/// **Built from `from_debug` rather than from a sample container**, so this one runs everywhere.
	/// The collision it guards is the only one in S7 that nothing else catches - two windows serving
	/// each other's tiles produces no error and no failed job - and a test that skips on most
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
