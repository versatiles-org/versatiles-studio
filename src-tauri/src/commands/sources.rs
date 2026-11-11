//! Opening tile containers (A1, S1.2).

use crate::state::AppState;
use studio_core::{
	analysis::{self, ContainerInfo},
	opening::{OpenProgress, Opening},
	store::RecentEntry,
};
use tauri::{State, ipc::Channel};

/// Opens a container, mounts it on the embedded server, and returns what is cheap to know.
///
/// Deliberately does **not** touch the window's pipeline. Opening a file from the dialog should set
/// it; mounting a container because the pipeline already mentions it should not, or following an
/// edit would overwrite the edit. The caller knows which it is doing; the `vpl` field is here so it
/// can set the pipeline itself.
///
/// The mount name is derived from the path so the webview can build tile URLs without a second
/// round trip. Re-opening the same path replaces the mount rather than stacking duplicates - see
/// [`ServerManager::mount`](studio_core::server::ServerManager::mount), which is where that is
/// actually enforced.
///
/// `progress` hears how far the open has got: reading the tile index, then computing the tile
/// pyramid (#21). Nothing is sent on it once this returns.
#[tauri::command]
#[specta::specta]
pub async fn open_container(
	window: tauri::Window,
	state: State<'_, AppState>,
	source: String,
	progress: Channel<OpenProgress>,
) -> Result<OpenedContainer, String> {
	// `from_container filename="berlin.mbtiles"` in a `.vpl` means *beside that file*, not beside
	// wherever Studio was started - and *that file* belongs to this window's project (S7.1).
	// Absolute paths and URLs are left alone.
	let (resolved, mount, dir) = {
		let held = state.project(&window).await;
		let project = held.lock().await;
		// **Mounted under this window's prefix** (S7.2), even though two windows opening the same
		// file would serve identical tiles. Sharing one mount would be cheaper by one index read and
		// would mean the first window to close pulls the tiles out from under the second.
		(
			resolve(&source, &project.dir),
			project.mount(&mount_name(&source)),
			project.dir.clone(),
		)
	};

	// Opening a container *is* adding a read node at the head of the pipeline (Q22). The core builds
	// the VPL so the quoting rules stay next to the parser that defines them.
	let vpl = studio_core::vpl::read_node("from_container", &source);
	let node = studio_core::vpl::Document::parse(&vpl)
		.map_err(|e| format!("{e:#}"))?
		.to_pipeline()
		.pipeline
		.into_iter()
		.next()
		.ok_or("the read node did not parse into a node")?;

	// A send fails only when the window has gone, and an open is not worth failing over that.
	let opening = Opening::new(std::sync::Arc::new(move |step| {
		let _ = progress.send(step);
	}));

	// **Built as the pipeline's head, not opened as a bare reader**, so the preview that follows
	// takes this source rather than opening the file again. For a remote container that was a second
	// download of its whole index, and a second walk over it to find the zoom range.
	//
	// **On the open's own runtime, and before the server is locked.** The runtime is what lets its
	// progress be told apart from the server's other work (see `studio_core::opening`). And the
	// server's lock is held only for the mount: a planet-sized index can take minutes, and the
	// other windows should not wait for it.
	let head = studio_core::preview::build_head(opening.runtime(), node, &dir)
		.await
		.map_err(|e| format!("{e:#}"))?;
	let info = analysis::describe(head.source(), &resolved)
		.await
		.map_err(|e| format!("{e:#}"))?;
	drop(opening);

	let mut server = state.server.lock().await;
	server
		.mount(&mount, head.source().clone())
		.await
		.map_err(|e| format!("{e:#}"))?;
	state.heads.offer(window.label(), head);

	// Only record what actually opened - a failed attempt is not a recent file.
	{
		let mut recents = state.recents.lock().await;
		recents.record(&source);
		if let Err(error) = recents.save(&state.data_dir) {
			// Never fail an open because the MRU list could not be written.
			eprintln!("could not save recents: {error:#}");
		}
	}

	Ok(OpenedContainer {
		tile_url: server.tile_url(&mount),
		vpl: vpl.clone(),
		name: mount,
		info,
	})
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(specta::Type)]
pub struct OpenedContainer {
	/// Mount name on the embedded server.
	pub name: String,
	/// Ready-made template for MapLibre; the port is ephemeral, so it is never assumed.
	pub tile_url: String,
	/// The `from_container` node this container corresponds to in the pipeline (Q22).
	pub vpl: String,
	pub info: ContainerInfo,
}

/// Resolves a relative path against the project directory, leaving URLs and absolute paths alone.
fn resolve(source: &str, dir: &std::path::Path) -> String {
	if source.contains("://") {
		return source.to_string();
	}
	let path = std::path::Path::new(source);
	if path.is_absolute() {
		return source.to_string();
	}
	dir.join(path).to_string_lossy().into_owned()
}

/// A URL-safe mount name derived from the source.
///
/// Stable for a given source, so re-opening replaces rather than accumulates - and **unique across
/// sources**, because the file stem alone is not: `https://a/osm.versatiles` and
/// `https://b/osm.versatiles` would otherwise mount over each other, silently breaking whichever
/// map layer resolved first. The hash suffix keeps the name readable while making it unique.
fn mount_name(source: &str) -> String {
	use std::hash::{DefaultHasher, Hash, Hasher};

	let stem = std::path::Path::new(source)
		.file_stem()
		.map_or_else(|| "source".to_string(), |s| s.to_string_lossy().into_owned());
	let mut cleaned: String = stem
		.chars()
		.map(|c| {
			if c.is_ascii_alphanumeric() {
				c.to_ascii_lowercase()
			} else {
				'_'
			}
		})
		.collect();
	// All-separator names ("....." → "_____") are as useless as an empty one.
	if cleaned.is_empty() || cleaned.chars().all(|c| c == '_') {
		cleaned = "source".to_string();
	}

	let mut hasher = DefaultHasher::new();
	source.hash(&mut hasher);
	format!("{cleaned}_{:06x}", hasher.finish() & 0xff_ffff)
}

#[cfg(test)]
mod tests {
	use super::mount_name;

	#[test]
	fn mount_names_are_url_safe() {
		let name = mount_name("/data/Berlin Extract.versatiles");
		assert!(name.starts_with("berlin_extract_"), "got {name}");
		assert!(
			name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'),
			"{name} must be safe in a URL path"
		);
		assert!(mount_name("/x/.....").starts_with("source_"));
	}

	#[test]
	fn mount_names_are_stable_per_source() {
		assert_eq!(mount_name("/a/b.versatiles"), mount_name("/a/b.versatiles"));
	}

	/// The bug this guards: two containers with the same filename from different places would mount
	/// over each other, and the first map layer would quietly stop resolving.
	#[test]
	fn same_filename_from_different_sources_does_not_collide() {
		assert_ne!(
			mount_name("https://a.example/osm.versatiles"),
			mount_name("https://b.example/osm.versatiles")
		);
	}
	/// A `.vpl` file's paths are relative to *that file*, so a relative source has to be resolved
	/// against the project directory before it is opened - otherwise
	/// `from_container filename="berlin.mbtiles"` looks wherever Studio was started.
	#[test]
	fn relative_sources_resolve_against_the_project_directory() {
		use super::resolve;
		let dir = std::path::Path::new("/data/project");

		assert_eq!(resolve("berlin.mbtiles", dir), "/data/project/berlin.mbtiles");
		assert_eq!(
			resolve("tiles/berlin.mbtiles", dir),
			"/data/project/tiles/berlin.mbtiles"
		);

		// Absolute paths and URLs mean what they say.
		assert_eq!(resolve("/elsewhere/berlin.mbtiles", dir), "/elsewhere/berlin.mbtiles");
		assert_eq!(
			resolve("https://example.org/osm.versatiles", dir),
			"https://example.org/osm.versatiles"
		);
		assert_eq!(
			resolve("ssh://host/path/osm.versatiles", dir),
			"ssh://host/path/osm.versatiles"
		);
	}
}

/// The recently opened sources, newest first (A7).
#[tauri::command]
#[specta::specta]
pub async fn recent_sources(state: State<'_, AppState>) -> Result<Vec<RecentEntry>, String> {
	Ok(state.recents.lock().await.entries().to_vec())
}

/// Drops one entry - for a path that has gone away, or that the user wants gone.
#[tauri::command]
#[specta::specta]
pub async fn forget_recent(state: State<'_, AppState>, source: String) -> Result<(), String> {
	let mut recents = state.recents.lock().await;
	recents.forget(&source);
	recents.save(&state.data_dir).map_err(|e| format!("{e:#}"))
}
