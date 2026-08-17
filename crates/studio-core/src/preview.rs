//! Running the pipeline so the map can show what it produces (S2.7, C3).
//!
//! This is the "instantly" half of M4. The map has been showing opened containers directly; from
//! here it shows the *output of a node*, which is what makes an edit visible — tighten a filter and
//! the tiles change, rather than a number changing in a form.
//!
//! Previewing a node means running the pipeline **up to and including it**. A node further down the
//! chain has not been applied yet, and the point of selecting one is to see what the data looks like
//! at that step.

use anyhow::{Context, Result};
use std::path::Path;
use std::sync::Arc;
use versatiles_container::{SharedTileSource, TilesRuntime};
use versatiles_pipeline::PipelineReader;
// Re-exported so the command layer can name what `up_to` hands it without taking a dependency on
// `versatiles_pipeline` of its own — the core is the layer that owns pipeline types.
pub use versatiles_pipeline::VPLPipeline;

/// The pipeline truncated at `path`, or `None` if the path names nothing.
///
/// Nesting recurses: previewing a node inside a `[ … ]` block means previewing that block's chain,
/// truncated at the node, rather than the outer pipeline that consumes it. The path is the one
/// [`Pipeline::node_at`](crate::vpl::Pipeline::node_at) produces — a node index, then pairs of
/// source and node index.
#[must_use]
pub fn up_to(pipeline: VPLPipeline, path: &[usize]) -> Option<VPLPipeline> {
	let (&head, rest) = path.split_first()?;
	if rest.is_empty() {
		let mut nodes = pipeline.pipeline;
		if head >= nodes.len() {
			return None;
		}
		nodes.truncate(head + 1);
		return Some(VPLPipeline::new(nodes));
	}

	let (&source, tail) = rest.split_first()?;
	let node = pipeline.pipeline.into_iter().nth(head)?;
	up_to(node.sources.into_iter().nth(source)?, tail)
}

/// Builds a pipeline into something the embedded server can mount.
///
/// `dir` is what relative paths in the VPL resolve against — the project directory once
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

	fn truncate(vpl: &str, path: &[usize]) -> Option<String> {
		let document = Document::parse(vpl).unwrap();
		up_to(document.to_pipeline(), path).map(|p| p.to_string())
	}

	/// The point of selecting a node is to see the data *at that step*, so what comes after it is
	/// not run.
	#[test]
	fn a_preview_stops_at_the_selected_node() {
		let vpl = "from_debug format=png | raster_overview level=2 | raster_tile_resize tile_size=512";
		assert_eq!(truncate(vpl, &[0]).unwrap(), "from_debug format=png");
		assert_eq!(
			truncate(vpl, &[1]).unwrap(),
			"from_debug format=png | raster_overview level=2"
		);
		assert_eq!(truncate(vpl, &[2]).unwrap(), vpl);
	}

	/// Previewing a node inside a source block runs *that* chain, not the pipeline consuming it —
	/// which is the whole reason to select one.
	#[test]
	fn a_nested_node_previews_its_own_chain() {
		let vpl = "from_stacked [ from_debug format=png | raster_overview level=2, from_debug format=webp ]";
		assert_eq!(truncate(vpl, &[0, 0, 0]).unwrap(), "from_debug format=png");
		assert_eq!(
			truncate(vpl, &[0, 0, 1]).unwrap(),
			"from_debug format=png | raster_overview level=2"
		);
		assert_eq!(truncate(vpl, &[0, 1, 0]).unwrap(), "from_debug format=webp");
	}

	#[test]
	fn a_path_that_names_nothing_previews_nothing() {
		let vpl = "from_debug format=png";
		assert_eq!(truncate(vpl, &[]), None);
		assert_eq!(truncate(vpl, &[9]), None);
		assert_eq!(truncate(vpl, &[0, 9, 0]), None);
	}

	/// What the preview builds has to be runnable, not merely well-formed.
	/// C9 end to end: a pipeline someone wrote by hand, opened from disk.
	///
	/// `berlin.vpl` names `berlin.mbtiles` and `cities.csv` **relative to itself**, so this also
	/// checks that the directory passed to `build` is the one that makes those resolve — the reason
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

	#[tokio::test]
	async fn a_truncated_pipeline_builds_and_serves() -> Result<()> {
		let runtime = versatiles::runtime::create_runtime();
		let document = Document::parse("from_debug format=png | raster_overview level=2").unwrap();

		for path in [vec![0], vec![1]] {
			let truncated = up_to(document.to_pipeline(), &path).expect("path should resolve");
			let source = build(&runtime, truncated, Path::new(".")).await?;
			let info = crate::analysis::describe(&source, "preview").await?;
			assert_eq!(info.tile_format, "png", "the preview should report what it produces");
			assert!(info.max_zoom >= info.min_zoom);
		}
		Ok(())
	}
}
