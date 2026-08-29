//! Running the pipeline so the map can show what it produces (S2.7, C3).
//!
//! This is the "instantly" half of M4. The map has been showing opened containers directly; from
//! here it shows the *output of a node*, which is what makes an edit visible - tighten a filter and
//! the tiles change, rather than a number changing in a form.
//!
//! What gets built is a graph's **effective** pipeline ([Q49]): its document minus the nodes whose
//! eyes are off. Truncating a chain at a node lived here until then, under the pin; a bypass is not
//! a truncation, and the document knows how to leave a node out - see
//! [`Document::to_pipeline_without`](crate::vpl::Document::to_pipeline_without).

use anyhow::{Context, Result};
use std::path::Path;
use std::sync::Arc;
use versatiles_container::{SharedTileSource, TilesRuntime};
use versatiles_pipeline::{PipelineFactory, PipelineReader};
// Re-exported so the command layer can name what it hands `build` without taking a dependency on
// `versatiles_pipeline` of its own - the core is the layer that owns pipeline types.
pub use versatiles_pipeline::VPLPipeline;

/// Builds a pipeline into something the embedded server can mount.
///
/// `dir` is what relative paths in the VPL resolve against - the project directory once
/// [Q6](../../docs/decisions.md) has one; until then, wherever Studio was started.
pub async fn build(runtime: &TilesRuntime, pipeline: VPLPipeline, dir: &Path) -> Result<SharedTileSource> {
	let reader = PipelineReader::from_pipeline(pipeline, "preview", dir, runtime.clone())
		.await
		.context("building the pipeline")?;
	Ok(Arc::new(reader))
}

/// A read node that has already been built, kept so the next build need not read the source again.
///
/// Opaque on purpose: a caller stores one and hands it back, and the decision about whether it still
/// applies is made here rather than by whoever is holding it.
#[derive(Clone)]
pub struct BuiltHead {
	/// The read node as written, and the directory it resolved against. Both, because the same text
	/// in another directory names other files ([Q55](../../docs/decisions.md)).
	key: String,
	source: SharedTileSource,
}

/// Builds a pipeline, reusing an already-built read node when the pipeline still starts with it.
///
/// **The read node is the whole cost.** A transform parses its parameters and wraps its input; a read
/// node loads the source, and that scales with the source. Measured through this function: a
/// 400 000-row CSV takes 21.6 s to read and 0.1 s to put a transform on, so an editor that rebuilds
/// everything after each keystroke spends twenty-one seconds redoing work the edit cannot have
/// changed. Reusing the head makes the cost proportional to what was edited ([vt#259], [vt#262]).
///
/// Returns the head alongside the source so the caller can keep it for next time. Whether it *is*
/// kept, and for how long, is the caller's business - see `Previews`, which holds one per graph and
/// drops it with the window.
///
/// **A head is reused only for the identical read node in the identical directory.** Anything else
/// builds a new one, including a parameter changed on the read node itself - which is the case that
/// would otherwise serve a preview of the previous file.
///
/// The staleness this does not address is the one [Q61](../../docs/decisions.md) already names: a
/// file changed on disk while its node stays as written. That was true before this and is no more
/// true after it; an explicit reload is the answer to both, and there is not one yet.
///
/// [vt#259]: https://github.com/versatiles-org/versatiles-rs/issues/259
/// [vt#262]: https://github.com/versatiles-org/versatiles-rs/issues/262
pub async fn build_reusing(
	runtime: &TilesRuntime,
	pipeline: VPLPipeline,
	dir: &Path,
	reusable: Option<&BuiltHead>,
) -> Result<(SharedTileSource, BuiltHead)> {
	let (node, tail) = pipeline.split().context("splitting the pipeline")?;
	let key = format!("{}\n{node}", dir.display());

	let source = match reusable.filter(|head| head.key == key) {
		Some(head) => head.source.clone(),
		None => {
			let factory = PipelineFactory::new_runtime_reader(dir, runtime.clone());
			let built = factory
				.read_operation_from_node(node)
				.await
				.context("building the source")?;
			SharedTileSource::from(built)
		}
	};

	let reader = PipelineReader::from_parts(source.clone(), tail, "preview", dir, runtime.clone())
		.await
		.context("building the pipeline")?;
	Ok((Arc::new(reader), BuiltHead { key, source }))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::vpl::Document;

	/// The testdata folder, and a pipeline over the aerial GeoTIFF in it.
	fn fixtures() -> std::path::PathBuf {
		std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../testdata")
	}

	fn parse(vpl: &str) -> VPLPipeline {
		Document::parse(vpl).expect("valid vpl").to_pipeline()
	}

	/// **Reusing a head must produce what building everything produces.** The whole point is that an
	/// editor can take the cheap path without the result changing, so this compares the two directly
	/// rather than trusting that the fold is the same fold.
	///
	/// A container rather than the GeoTIFF the other tests use, because this one has to read tiles and
	/// a container has them at every zoom. The transform is a `filter`, so coverage differs from the
	/// source's own - a fold that dropped the tail would show up as tiles that should have been
	/// clipped away, which comparing `None` against `None` is what catches.
	#[tokio::test]
	async fn a_reused_head_builds_the_same_tiles_as_a_full_build() -> Result<()> {
		let runtime = versatiles::runtime::create_runtime();
		let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../versatiles-rs/testdata");
		let read = r#"from_container filename="berlin.versatiles""#;
		let vpl = format!("{read} | filter bbox=[13.3,52.4,13.5,52.6]");

		let whole = build(&runtime, parse(&vpl), &dir).await?;
		let (_, head) = build_reusing(&runtime, parse(read), &dir, None).await?;
		let (reused, _) = build_reusing(&runtime, parse(&vpl), &dir, Some(&head)).await?;

		let blob = |t: Option<versatiles_container::Tile>| {
			t.map(|mut tile| tile.as_blob(&versatiles_core::TileCompression::Uncompressed).cloned())
				.transpose()
		};
		let mut covered = 0;
		for z in 0..=6u8 {
			let side = 1u32 << z;
			for x in 0..side {
				for y in 0..side {
					let coord = versatiles_core::TileCoord::new(z, x, y)?;
					let expected = blob(whole.tile(&coord).await?)?;
					covered += usize::from(expected.is_some());
					assert_eq!(blob(reused.tile(&coord).await?)?, expected, "at {z}/{x}/{y}");
				}
			}
		}
		assert!(covered > 0, "the fixture covered no tile, so only absence was compared");
		Ok(())
	}

	/// **The head is actually reused**, which nothing else here would notice: a build that quietly
	/// re-read the source would pass every other test in this file and only show up as the twenty-one
	/// seconds this exists to remove. Compared by pointer, because that is what "not read again" means.
	#[tokio::test]
	async fn an_edit_after_the_read_node_keeps_the_source_it_had() -> Result<()> {
		let (runtime, dir) = (versatiles::runtime::create_runtime(), fixtures());
		let read = r#"from_gdal_raster filename="aerial.tif""#;

		let (_, first) = build_reusing(&runtime, parse(read), &dir, None).await?;
		let (_, second) = build_reusing(
			&runtime,
			parse(&format!("{read} | raster_levels brightness=20")),
			&dir,
			Some(&first),
		)
		.await?;

		assert!(Arc::ptr_eq(&first.source, &second.source), "the source was read again");
		Ok(())
	}

	/// **And an edit to the read node itself is not reused.** This is the direction that matters: a
	/// head kept for a `filename` that has since changed would serve a preview of the previous file,
	/// which is worse than the slow rebuild it saved.
	#[tokio::test]
	async fn an_edit_to_the_read_node_builds_a_new_source() -> Result<()> {
		let (runtime, dir) = (versatiles::runtime::create_runtime(), fixtures());

		let (_, first) = build_reusing(&runtime, parse(r#"from_gdal_raster filename="aerial.tif""#), &dir, None).await?;
		let (_, second) = build_reusing(
			&runtime,
			parse(r#"from_gdal_raster filename="aerial-northwest.vrt""#),
			&dir,
			Some(&first),
		)
		.await?;

		assert!(
			!Arc::ptr_eq(&first.source, &second.source),
			"a different file reused the source"
		);
		Ok(())
	}

	/// The same text in another directory names other files ([Q55]), so it is not the same head.
	#[tokio::test]
	async fn the_same_read_node_elsewhere_is_a_different_head() -> Result<()> {
		let (runtime, dir) = (versatiles::runtime::create_runtime(), fixtures());
		let read = r#"from_gdal_raster filename="aerial.tif""#;

		let (_, here) = build_reusing(&runtime, parse(read), &dir, None).await?;
		let elsewhere = dir.join("../testdata");
		let (_, there) = build_reusing(&runtime, parse(read), &elsewhere, Some(&here)).await?;

		assert!(
			!Arc::ptr_eq(&here.source, &there.source),
			"another directory reused the source"
		);
		Ok(())
	}

	/// What the preview builds has to be runnable, not merely well-formed.
	/// C9 end to end: a pipeline someone wrote by hand, opened from disk.
	///
	/// `berlin.vpl` names `berlin.mbtiles` and `cities.csv` **relative to itself**, so this also
	/// checks that the directory passed to `build` is the one that makes those resolve - the reason
	/// opening a `.vpl` moves `project_dir` rather than using the working directory.
	#[tokio::test]
	async fn a_pipeline_file_builds_with_paths_relative_to_itself() -> Result<()> {
		let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../versatiles-rs/testdata/berlin.vpl");
		if !path.exists() {
			eprintln!("skipping: set STUDIO_TESTDATA to a directory of sample containers");
			return Ok(());
		}

		let document = Document::parse(std::fs::read_to_string(&path)?)?;
		assert!(
			crate::vpl::validate(&document).is_empty(),
			"a hand-written pipeline should pass validation: {:?}",
			crate::vpl::validate(&document)
		);

		let runtime = versatiles::runtime::create_runtime();
		let source = build(&runtime, document.to_pipeline(), path.parent().unwrap()).await?;
		let info = crate::analysis::describe(&source, "preview").await?;
		assert_eq!(info.tile_format, "mvt");
		assert!(info.max_zoom >= info.min_zoom);
		Ok(())
	}

	/// A pipeline with some of its nodes switched off is the thing that actually gets built now
	/// ([Q49]), so what `Document::to_pipeline_without` hands over has to be runnable and not
	/// merely well-formed.
	#[tokio::test]
	async fn a_pipeline_with_a_node_switched_off_builds_and_serves() -> Result<()> {
		let runtime = versatiles::runtime::create_runtime();
		let document = Document::parse("from_debug format=png | raster_overview level=2").unwrap();
		let off = [vec![1]].into_iter().collect();

		let wanted = document.to_pipeline_without(&off).expect("the head is still there");
		let source = build(&runtime, wanted, Path::new(".")).await?;
		let info = crate::analysis::describe(&source, "preview").await?;

		assert_eq!(info.tile_format, "png", "the preview should report what it produces");
		assert!(info.max_zoom >= info.min_zoom);
		Ok(())
	}
}
