//! Asset manager - install, pin, verify and remove font families (G7, S4.1, [Q9]).
//!
//! Studio ships a small tier and installs the rest on demand: sprites and Latin glyphs are bundled
//! so the first launch renders offline (S0.6), and a font family that covers Cyrillic or CJK is
//! 8-48 MB that most projects never need.
//!
//! **Pinned, never `latest`.** The manifest names a release version and a digest for every archive,
//! and it is compiled in rather than read from disk - a pinned version that a file beside the
//! binary could change is not pinned. Moving one is `npm run assets:update`, deliberately.
//!
//! **Never unpacked.** An archive is served as it arrives: the embedded server reads `.tar.gz`
//! directly ([`ServerManager::mount_static`](crate::server::ServerManager::mount_static)), so
//! installing is a download and a rename, and removing is deleting one file. Unpacking 48 MB of
//! glyphs into tens of thousands of small files would be slower, larger on disk, and would make
//! "is this installed?" a question about a directory tree rather than about a file.
//!
//! [Q9]: ../../docs/decisions.md

use anyhow::{Context, Result};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// The pinned manifest, compiled in.
const MANIFEST: &str = include_str!("../../../assets/manifest.json");

/// A family someone can install, and whether they have.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Family {
	/// The name the archive and the font stack share - `noto_sans`.
	pub id: String,
	/// Download size, so a 48 MB decision is made before it starts rather than during.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub bytes: u64,
	pub installed: bool,
}

/// One archive as the manifest pins it.
#[derive(Debug, Clone)]
pub struct Pinned {
	pub id: String,
	pub url: String,
	/// `sha256:…`, verbatim from the release.
	pub digest: String,
	pub bytes: u64,
}

#[derive(Deserialize)]
struct Manifest {
	sources: std::collections::BTreeMap<String, Source>,
}

#[derive(Deserialize)]
struct Source {
	repo: String,
	version: String,
	#[serde(default)]
	assets: std::collections::BTreeMap<String, Asset>,
}

#[derive(Deserialize)]
struct Asset {
	file: String,
	digest: String,
	bytes: u64,
}

/// Every font family the manifest offers, in a stable order.
///
/// Only `fonts`: the sprites and the Latin glyphs are the bundled tier, and offering to install what
/// is already inside the binary would be a list with two rows nobody can act on.
pub fn families(dir: &Path) -> Result<Vec<Family>> {
	Ok(pinned()?
		.into_iter()
		.map(|asset| Family {
			// From the compiled-in manifest, so it cannot fail; `false` if it somehow did.
			installed: archive_path(dir, &asset.id).is_ok_and(|path| path.exists()),
			id: asset.id,
			bytes: asset.bytes,
		})
		.collect())
}

/// The manifest's font archives, with the URL each is downloaded from.
pub fn pinned() -> Result<Vec<Pinned>> {
	let manifest: Manifest = serde_json::from_str(MANIFEST).context("reading the pinned asset manifest")?;
	let source = manifest
		.sources
		.get("fonts")
		.context("the manifest names no font source")?;

	Ok(source
		.assets
		.iter()
		.map(|(id, asset)| Pinned {
			id: id.clone(),
			url: format!(
				"https://github.com/{}/releases/download/{}/{}",
				source.repo, source.version, asset.file
			),
			digest: asset.digest.clone(),
			bytes: asset.bytes,
		})
		.collect())
}

/// Where an installed family's archive lives.
///
/// **The name is checked here, and it did not used to be.** The doc said it was; nothing did it.
/// `remove` reached this with an id straight from the webview, so `../../../x` named `x.tar.gz`
/// outside the asset directory - and `remove` deletes what it finds. A path built from data is the
/// shape [architecture.md](../../docs/architecture.md) names as the one to be careful with, and this
/// was the counter-example sitting inside the sentence claiming otherwise.
pub fn archive_path(dir: &Path, id: &str) -> Result<PathBuf> {
	crate::paths::segment(id)?;
	Ok(dir.join(format!("{id}.tar.gz")))
}

/// Writes a downloaded archive, refusing one whose contents are not what was pinned.
///
/// **Verified before it is installed, not after.** A truncated download and a substituted file look
/// the same to a reader that has already mounted them, and a glyph archive is a file the map serves
/// to itself - so the check is the point of the digest being in the manifest at all.
pub fn accept(dir: &Path, id: &str, bytes: &[u8], digest: &str) -> Result<PathBuf> {
	let found = format!("sha256:{:x}", Sha256::digest(bytes));
	anyhow::ensure!(
		found == digest,
		"{id} does not match what the manifest pins - expected {digest}, got {found}"
	);

	let path = archive_path(dir, id)?;
	std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
	// The same temporary-then-rename as every other write here: a half-downloaded archive that the
	// server picks up serves half a font.
	let temp = path.with_extension("part");
	std::fs::write(&temp, bytes).with_context(|| format!("writing {}", temp.display()))?;
	std::fs::rename(&temp, &path).with_context(|| format!("installing {}", path.display()))?;
	Ok(path)
}

/// Downloads a family and installs it, reporting to the job that asked for it.
///
/// **Through `versatiles_core`'s HTTP reader rather than a client of its own.** Every other request
/// Studio makes goes that way, so this one carries the same `User-Agent` - including the product
/// token that [vt#248](https://github.com/versatiles-org/versatiles-rs/issues/248) will add. A
/// second client would be a second thing to remember when that lands.
///
/// The whole archive is read before anything is written, because the digest is about the whole of
/// it: a check that verified as it streamed would still have written the bytes it was checking.
pub async fn install(handle: &crate::jobs::JobHandle, id: &str, dir: &Path) -> Result<PathBuf> {
	use versatiles_core::io::{DataReaderHttp, DataReaderTrait};

	let asset = pinned()?
		.into_iter()
		.find(|asset| asset.id == id)
		.with_context(|| format!("{id} is not a family this build knows about"))?;

	handle.log(format!("{} - {:.0} MB", asset.url, asset.bytes as f64 / 1_000_000.0));
	handle.working(format!("downloading {id}"));

	let url = url::Url::parse(&asset.url).with_context(|| format!("parsing {}", asset.url))?;
	let reader = DataReaderHttp::try_from(&url).with_context(|| format!("opening {}", asset.url))?;
	let blob = reader
		.read_all()
		.await
		.with_context(|| format!("downloading {}", asset.url))?;

	handle.working(format!("checking {id}"));
	accept(dir, id, blob.as_slice(), &asset.digest)
}

/// Removes a family, and says whether one was there.
pub fn remove(dir: &Path, id: &str) -> Result<bool> {
	let path = archive_path(dir, id)?;
	if !path.exists() {
		return Ok(false);
	}
	std::fs::remove_file(&path).with_context(|| format!("removing {}", path.display()))?;
	Ok(true)
}

/// Every installed archive, for mounting beside the bundled tier.
///
/// Sorted, so the order the server tries them in does not depend on the filesystem.
pub fn installed(dir: &Path) -> Vec<PathBuf> {
	let Ok(entries) = std::fs::read_dir(dir) else {
		return Vec::new();
	};
	let mut found: Vec<PathBuf> = entries
		.filter_map(Result::ok)
		.map(|entry| entry.path())
		.filter(|path| path.to_string_lossy().ends_with(".tar.gz"))
		.collect();
	found.sort();
	found
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The manifest is compiled in, so a mistake in it is a mistake in the binary - this is the only
	/// place that would notice.
	#[test]
	fn every_pinned_family_has_a_version_and_a_digest() {
		let families = pinned().expect("the manifest should parse");
		assert!(families.len() >= 3, "expected several families: {families:?}");
		for family in &families {
			assert!(family.url.starts_with("https://github.com/"), "{family:?}");
			// Never `latest`: a URL that resolves differently next month is not a pin.
			assert!(!family.url.contains("/latest/"), "{family:?}");
			assert!(family.digest.starts_with("sha256:"), "{family:?}");
			assert!(family.bytes > 0, "{family:?}");
		}
	}

	#[test]
	fn a_family_is_installed_when_its_archive_is_there() {
		let dir = crate::testing::dir("assets-installed");
		let before = families(&dir).unwrap();
		assert!(before.iter().all(|f| !f.installed), "nothing is installed yet");

		let id = &before[0].id;
		std::fs::write(archive_path(&dir, id).unwrap(), b"x").unwrap();
		let after = families(&dir).unwrap();
		assert!(after.iter().find(|f| &f.id == id).unwrap().installed);
	}

	/// A truncated download and a substituted file look the same once mounted, which is what the
	/// digest is in the manifest for.
	#[test]
	fn an_archive_that_is_not_what_was_pinned_is_refused() {
		let dir = crate::testing::dir("assets-digest");
		let right = format!("sha256:{:x}", Sha256::digest(b"the real thing"));

		let error = accept(&dir, "noto_sans", b"something else", &right).unwrap_err();
		assert!(format!("{error:#}").contains("does not match"), "{error:#}");
		assert!(
			!archive_path(&dir, "noto_sans").unwrap().exists(),
			"a refused archive must not be left behind"
		);

		accept(&dir, "noto_sans", b"the real thing", &right).expect("the right bytes should install");
		assert!(archive_path(&dir, "noto_sans").unwrap().exists());
	}

	#[test]
	fn removing_says_whether_there_was_anything_to_remove() {
		let dir = crate::testing::dir("assets-remove");
		let digest = format!("sha256:{:x}", Sha256::digest(b"font"));
		accept(&dir, "lato", b"font", &digest).unwrap();

		assert!(remove(&dir, "lato").unwrap());
		assert!(!remove(&dir, "lato").unwrap(), "the second removal has nothing to do");
		assert!(!archive_path(&dir, "lato").unwrap().exists());
	}

	/// The server mounts these in the order given, so it must not be the order the filesystem
	/// happens to return them in.
	#[test]
	fn installed_archives_come_back_in_a_stable_order() {
		let dir = crate::testing::dir("assets-order");
		let digest = |b: &[u8]| format!("sha256:{:x}", Sha256::digest(b));
		for id in ["noto_sans", "lato", "fira_sans"] {
			accept(&dir, id, id.as_bytes(), &digest(id.as_bytes())).unwrap();
		}
		// Something that is not an archive is not offered as one.
		std::fs::write(dir.join("notes.txt"), b"ignore me").unwrap();

		let found: Vec<String> = installed(&dir)
			.iter()
			.map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
			.collect();
		assert_eq!(found, ["fira_sans.tar.gz", "lato.tar.gz", "noto_sans.tar.gz"]);
	}

	#[test]
	fn nothing_installed_is_an_empty_list_rather_than_an_error() {
		assert!(installed(Path::new("/nonexistent/asset/dir")).is_empty());
	}
}

#[cfg(test)]
mod traversal_tests {
	use super::*;

	/// **The bug this guard was added for.** `remove` takes an id straight from the webview, and
	/// `archive_path` used to join it unchecked - so `../…` named, and `remove` deleted, a
	/// `.tar.gz` outside the asset directory.
	///
	/// The core is Tauri-free precisely so it can be exercised like this ([Q3]): no window, no IPC,
	/// just the call the command layer makes.
	///
	/// [Q3]: ../../../docs/decisions.md
	#[test]
	fn a_family_id_cannot_name_a_file_outside_the_asset_directory() {
		let root = crate::testing::dir("assets-traversal");
		let assets = root.join("fonts");
		std::fs::create_dir_all(&assets).unwrap();

		// A file a caller should not be able to reach, one level above the asset directory.
		let outside = root.join("precious.tar.gz");
		std::fs::write(&outside, b"do not delete").unwrap();

		let error = remove(&assets, "../precious").unwrap_err();
		assert!(format!("{error:#}").contains("path separator"), "{error:#}");
		assert!(outside.exists(), "the file above the asset directory was deleted");

		// And the ordinary case still works.
		std::fs::write(assets.join("noto_sans.tar.gz"), b"x").unwrap();
		assert!(remove(&assets, "noto_sans").unwrap());
	}
}
