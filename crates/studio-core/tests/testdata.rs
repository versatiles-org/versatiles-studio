//! Every fixture in `testdata/` still opens, through the door Studio would open it with.
//!
//! **A fixture folder with no reader rots**, and this one did within a day of being written:
//! `farmland.jpg` and `bluemarble.png` were georeferenced by a world file and a `.prj`, which is the
//! ESRI convention and is *not* one GDAL's JPEG and PNG drivers read. They had an extent and no
//! spatial reference, so `gdalinfo` was happy and `from_gdal_raster` refused them with "Unable to get
//! a spatial reference". Nothing in the suite touched them, so nothing said so.
//!
//! **The door, not a hand-written pipeline.** Each file is resolved with `import::kind_for` and
//! turned into a read node by `import::read_node` - the same two calls the webview makes when a file
//! is dropped or chosen. So this fails if a fixture goes bad *or* if the catalogue stops recognising
//! it, and it cannot pass by testing something Studio would never do.
//!
//! Sidecars answer no kind and are skipped by construction: `.aux.xml`, `.jgw`, `.pgw`, `.dbf`,
//! `.shx`, `.cpg`, `.prj` and the README are all `kind_for` → `None`.

use std::path::{Path, PathBuf};

fn testdata() -> PathBuf {
	Path::new(env!("CARGO_MANIFEST_DIR")).join("../../testdata")
}

/// Every file in the folder, sorted so a failure names the same one on every machine.
fn fixtures() -> Vec<PathBuf> {
	let mut found: Vec<PathBuf> = std::fs::read_dir(testdata())
		.expect("testdata/ should be beside the crates")
		.map(|entry| entry.expect("reading testdata/").path())
		.filter(|path| path.is_file())
		.collect();
	found.sort();
	found
}

#[tokio::test]
async fn every_fixture_opens_through_the_catalogue() {
	let runtime = versatiles::runtime::create_runtime();
	let dir = testdata();
	let mut opened = 0;
	let mut refused = Vec::new();

	for path in fixtures() {
		let name = path.file_name().unwrap().to_string_lossy().to_string();
		let full = path.to_string_lossy().to_string();

		// A sidecar names no kind, which is how it is left alone.
		let Some(kind) = studio_core::import::kind_for(&name) else {
			continue;
		};
		// A `.vpl` is a document rather than a source, and has no read node to build.
		if kind.operation.is_none() {
			continue;
		}

		let vpl = studio_core::import::read_node(&kind, &full);
		let document = match studio_core::vpl::Document::parse(vpl.clone()) {
			Ok(document) => document,
			Err(error) => {
				refused.push(format!("{name}: {vpl:?} did not parse: {error}"));
				continue;
			}
		};

		match studio_core::preview::build(&runtime, document.to_pipeline(), &dir).await {
			Ok(_) => opened += 1,
			Err(error) => refused.push(format!("{name} ({}): {error:#}", kind.id)),
		}
	}

	assert!(
		refused.is_empty(),
		"fixtures that would not open:\n  {}",
		refused.join("\n  ")
	);
	// A floor rather than a count, so a folder that stopped being found fails instead of passing
	// quietly with nothing to do - the failure this whole file exists to make impossible.
	assert!(opened >= 6, "only {opened} fixtures opened - has testdata/ moved?");
}
