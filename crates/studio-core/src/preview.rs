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
use versatiles_pipeline::PipelineReader;
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
	Ok(Arc::new(Box::new(reader) as Box<dyn versatiles_container::TileSource>))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::vpl::Document;

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
