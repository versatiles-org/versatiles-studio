//! Whether the raster fixtures are georeferenced - a question about the files, asked in a process
//! that has not opened a pipeline.
//!
//! **Its own binary on purpose.** `from_gdal_*` once turned GDAL's PAM off process-wide for every
//! dataset it opened rather than only the ones it overrode ([vt#261]), and PAM is what reads the
//! `.aux.xml` sidecar a PNG or JPEG keeps its CRS in. Left beside
//! `every_fixture_opens_through_the_catalogue`, this test raced that one for a global setting and
//! failed depending on which ran first - reporting that the fixtures had no spatial reference when
//! they demonstrably did.
//!
//! 4.12 fixed that, so the race is gone. The isolation stays because it costs one file and the class
//! of bug does not: a process-global set by any dependency, at any depth, on first use. A test that
//! asks GDAL a question about files should not be able to be answered by what ran before it.
//!
//! [vt#261]: https://github.com/versatiles-org/versatiles-rs/issues/261

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

/// The raster fixtures carry a spatial reference, which is the thing that was missing.
///
/// Asserted separately from the build above because the message is what makes it findable: a future
/// PNG added with a `.prj` and no `.aux.xml` fails here saying *which* file and *what* is absent,
/// rather than inside a pipeline error six frames deep.
#[test]
fn every_raster_fixture_declares_its_spatial_reference() {
	let missing: Vec<String> = fixtures()
		.iter()
		.filter(|path| {
			let name = path.file_name().unwrap().to_string_lossy().to_lowercase();
			[".tif", ".tiff", ".vrt", ".png", ".jpg", ".jpeg"]
				.iter()
				.any(|e| name.ends_with(e))
		})
		.filter(|path| {
			let dataset = gdal::Dataset::open(path);
			dataset.is_err() || dataset.map(|d| d.spatial_ref().is_err()).unwrap_or(true)
		})
		.map(|path| path.file_name().unwrap().to_string_lossy().to_string())
		.collect();

	assert!(
		missing.is_empty(),
		"raster fixtures with no spatial reference: {missing:?}\n\
		 A world file carries the extent, not the CRS. GDAL's JPEG and PNG drivers read the CRS from \
		 the `.aux.xml` beside the file, and ignore a `.prj` - so keep the sidecar `gdal_translate \
		 -a_srs` writes."
	);
}
