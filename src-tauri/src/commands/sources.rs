//! Opening tile containers (A1, S1.2).

use crate::state::AppState;
use studio_core::analysis::{self, ContainerInfo};
use tauri::State;

/// Opens a container, mounts it on the embedded server, and returns what is cheap to know.
///
/// The mount name is derived from the path so the webview can build tile URLs without a second
/// round trip. Re-opening the same path replaces the mount rather than stacking duplicates.
#[tauri::command]
pub async fn open_container(state: State<'_, AppState>, source: String) -> Result<OpenedContainer, String> {
	let mut server = state.server.lock().await;

	let (reader, info) = analysis::open(server.runtime(), &source)
		.await
		.map_err(|e| format!("{e:#}"))?;

	let name = mount_name(&source);
	server.mount(&name, reader).await.map_err(|e| format!("{e:#}"))?;

	Ok(OpenedContainer {
		tile_url: format!("{}/tiles/{name}/{{z}}/{{x}}/{{y}}", server.base_url()),
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
	pub info: ContainerInfo,
}

/// A URL-safe mount name derived from the source path.
///
/// Stable for a given path, so re-opening replaces rather than accumulates.
fn mount_name(source: &str) -> String {
	let stem = std::path::Path::new(source)
		.file_stem()
		.map_or_else(|| "source".to_string(), |s| s.to_string_lossy().into_owned());
	let cleaned: String = stem
		.chars()
		.map(|c| {
			if c.is_ascii_alphanumeric() {
				c.to_ascii_lowercase()
			} else {
				'_'
			}
		})
		.collect();
	if cleaned.is_empty() {
		"source".to_string()
	} else {
		cleaned
	}
}

#[cfg(test)]
mod tests {
	use super::mount_name;

	#[test]
	fn mount_names_are_url_safe_and_stable() {
		assert_eq!(mount_name("/data/Berlin Extract.versatiles"), "berlin_extract");
		assert_eq!(mount_name("/x/osm.mbtiles"), "osm");
		assert_eq!(mount_name("/x/....."), "source");
		assert_eq!(mount_name("/a/b.versatiles"), mount_name("/a/b.versatiles"));
	}
}
