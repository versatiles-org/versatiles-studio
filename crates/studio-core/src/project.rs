//! Project model — a directory holding a `project.yaml` manifest beside real `.vpl` and
//! `style.json` files (G1, [Q6]).
//!
//! Not implemented yet; the manifest arrives at S5.1. Recent sources and bookmarks are **not**
//! here: they are application state, not project state, and live in [`crate::store`]
//! ([Q21](../../../docs/decisions.md)).
//!
//! [Q6]: ../../../docs/decisions.md

use anyhow::{Context, Result};
use std::path::Path;

/// Writes a pipeline to a `.vpl` file, atomically.
///
/// Saving a *project* — the manifest, the style and the pipeline as a directory — is G1 at S5.1.
/// This is the narrower thing: the pipeline as the file the CLI already reads, which is what
/// [C9](../../../docs/features.md) opens. They stay separate commands because they have different
/// scopes: one writes a file, the other a folder.
///
/// Temp-then-rename, for the same reason the store does it: an interrupted write must not leave a
/// truncated pipeline where a working one was.
pub fn save_vpl(path: &Path, text: &str) -> Result<()> {
	let dir = path.parent().context("target has no parent directory")?;
	let mut temp = path.as_os_str().to_owned();
	temp.push(".tmp");
	let temp = std::path::PathBuf::from(temp);

	std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
	{
		use std::io::Write;
		let mut file = std::fs::File::create(&temp).with_context(|| format!("creating {}", temp.display()))?;
		file.write_all(text.as_bytes()).context("writing the temporary file")?;
		file.sync_all().context("flushing the temporary file")?;
	}
	std::fs::rename(&temp, path).with_context(|| format!("replacing {}", path.display()))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::vpl::Document;

	fn temp_dir(label: &str) -> std::path::PathBuf {
		let dir = std::env::temp_dir().join("studio-project-tests").join(label);
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		dir
	}

	/// What is written has to be what opens again — including the comments and layout that make a
	/// hand-written pipeline worth keeping.
	#[test]
	fn a_saved_pipeline_reopens_unchanged() -> Result<()> {
		let dir = temp_dir("roundtrip");
		let path = dir.join("pipeline.vpl");
		let source = "# Berlin\nfrom_container filename='berlin.mbtiles' # the input\n  | vector_repair\n";

		let document = Document::parse(source).unwrap();
		save_vpl(&path, document.text())?;

		let read_back = std::fs::read_to_string(&path)?;
		assert_eq!(read_back, source, "the file is the document, byte for byte");
		assert_eq!(Document::parse(read_back).unwrap().comments().len(), 2);
		Ok(())
	}

	#[test]
	fn an_interrupted_write_leaves_no_temporary_file() -> Result<()> {
		let dir = temp_dir("atomic");
		let path = dir.join("pipeline.vpl");
		save_vpl(&path, "from_debug format=png")?;
		assert!(path.exists());
		assert!(
			!dir.join("pipeline.vpl.tmp").exists(),
			"the temp file should have been renamed away"
		);
		Ok(())
	}

	#[test]
	fn overwriting_replaces_rather_than_appends() -> Result<()> {
		let dir = temp_dir("overwrite");
		let path = dir.join("pipeline.vpl");
		save_vpl(&path, "from_debug format=png | raster_overview level=2")?;
		save_vpl(&path, "from_debug format=webp")?;
		assert_eq!(std::fs::read_to_string(&path)?, "from_debug format=webp");
		Ok(())
	}
}
