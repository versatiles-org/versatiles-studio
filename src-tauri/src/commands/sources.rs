//! Opening tile containers (A1, S1.2).

use crate::state::AppState;
use studio_core::{
	analysis::{self, ContainerInfo, TileInspection},
	store::RecentEntry,
};
use tauri::State;

/// Opens a container, mounts it on the embedded server, and returns what is cheap to know.
///
/// Deliberately does **not** touch the window's pipeline. Opening a file from the dialog should set
/// it; mounting a container because the pipeline already mentions it should not, or following an
/// edit would overwrite the edit. The caller knows which it is doing; the `vpl` field is here so it
/// can set the pipeline itself.
///
/// The mount name is derived from the path so the webview can build tile URLs without a second
/// round trip. Re-opening the same path replaces the mount rather than stacking duplicates — see
/// [`ServerManager::mount`](studio_core::server::ServerManager::mount), which is where that is
/// actually enforced.
#[tauri::command]
pub async fn open_container(state: State<'_, AppState>, source: String) -> Result<OpenedContainer, String> {
	let mut server = state.server.lock().await;

	let (reader, info) = analysis::open(server.runtime(), &source)
		.await
		.map_err(|e| format!("{e:#}"))?;

	// Opening a container *is* adding a read node at the head of the pipeline (Q22). The core builds
	// the VPL so the quoting rules stay next to the parser that defines them.
	let vpl = studio_core::vpl::read_node_for(&source);
	let name = mount_name(&source);
	server.mount(&name, reader).await.map_err(|e| format!("{e:#}"))?;

	// Only record what actually opened — a failed attempt is not a recent file.
	{
		let mut recents = state.recents.lock().await;
		recents.record(&source);
		if let Err(error) = recents.save(&state.data_dir) {
			// Never fail an open because the MRU list could not be written.
			eprintln!("could not save recents: {error:#}");
		}
	}

	Ok(OpenedContainer {
		tile_url: format!("{}/tiles/{name}/{{z}}/{{x}}/{{y}}", server.base_url()),
		vpl: vpl.clone(),
		name,
		info,
	})
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedContainer {
	/// Mount name on the embedded server.
	pub name: String,
	/// Ready-made template for MapLibre; the port is ephemeral, so it is never assumed.
	pub tile_url: String,
	/// The `from_container` node this container corresponds to in the pipeline (Q22).
	pub vpl: String,
	pub info: ContainerInfo,
}

/// A URL-safe mount name derived from the source.
///
/// Stable for a given source, so re-opening replaces rather than accumulates — and **unique across
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
}

/// The recently opened sources, newest first (A7).
#[tauri::command]
pub async fn recent_sources(state: State<'_, AppState>) -> Result<Vec<RecentEntry>, String> {
	Ok(state.recents.lock().await.entries().to_vec())
}

/// Drops one entry — for a path that has gone away, or that the user wants gone.
#[tauri::command]
pub async fn forget_recent(state: State<'_, AppState>, source: String) -> Result<(), String> {
	let mut recents = state.recents.lock().await;
	recents.forget(&source);
	recents.save(&state.data_dir).map_err(|e| format!("{e:#}"))
}

/// Decodes one tile of an open container, layer by layer (A4).
///
/// Takes the source string rather than the mount name so the webview never has to track both.
#[tauri::command]
pub async fn inspect_tile(
	state: State<'_, AppState>,
	source: String,
	z: u8,
	x: u32,
	y: u32,
) -> Result<Option<TileInspection>, String> {
	let server = state.server.lock().await;
	let (reader, _) = analysis::open(server.runtime(), &source)
		.await
		.map_err(|e| format!("{e:#}"))?;
	analysis::inspect_tile(&reader, z, x, y)
		.await
		.map_err(|e| format!("{e:#}"))
}
