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
//!
//! [Q49]: ../../../docs/decisions.md

use anyhow::{Context, Result};
use std::path::Path;
use std::sync::Arc;
use versatiles_container::TilesRuntime;
use versatiles_pipeline::{PipelineFactory, PipelineReader, VPLNode};
// Re-exported so the command layer can name what it hands `build` without taking a dependency on
// `versatiles_pipeline` of its own - the core is the layer that owns pipeline types.
/// What a build produces, named here so a caller that keeps one need not depend on the container crate.
pub use versatiles_container::SharedTileSource;
pub use versatiles_pipeline::VPLPipeline;

/// A source with no tiles, for the command layer's tests to put where a build would be - it cannot
/// name the container crate that makes one.
pub fn stand_in() -> SharedTileSource {
	Arc::new(Nothing {
		metadata: versatiles_container::TileSourceMetadata::new(
			versatiles_core::TileFormat::MVT,
			versatiles_core::TileCompression::Uncompressed,
			versatiles_container::Traversal::ANY,
			None,
		),
		tilejson: versatiles_core::TileJSON::default(),
	})
}

#[derive(Debug)]
struct Nothing {
	metadata: versatiles_container::TileSourceMetadata,
	tilejson: versatiles_core::TileJSON,
}

#[async_trait::async_trait]
impl versatiles_container::TileSource for Nothing {
	fn source_type(&self) -> Arc<versatiles_container::SourceType> {
		versatiles_container::SourceType::new_container("nothing", "stand-in")
	}
	fn metadata(&self) -> &versatiles_container::TileSourceMetadata {
		&self.metadata
	}
	fn tilejson(&self) -> &versatiles_core::TileJSON {
		&self.tilejson
	}
	async fn tile_stream(
		&self,
		_bbox: versatiles_core::TileBBox,
	) -> Result<versatiles_core::TileStream<'static, versatiles_container::Tile>> {
		Ok(versatiles_core::TileStream::from_vec(Vec::new()))
	}
}

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

impl BuiltHead {
	/// Whether `pipeline` starts with this read node, in `dir` - so a build may take it as its head.
	#[must_use]
	pub fn heads(&self, pipeline: &VPLPipeline, dir: &Path) -> bool {
		pipeline
			.pipeline
			.first()
			.is_some_and(|node| self.key == head_key(node, dir))
	}

	/// Whether two heads are the same read node in the same directory, whichever was built first.
	#[must_use]
	pub fn same_node(&self, other: &BuiltHead) -> bool {
		self.key == other.key
	}

	/// The source the read node built, for whoever needs it before any pipeline does.
	#[must_use]
	pub fn source(&self) -> &SharedTileSource {
		&self.source
	}
}

fn head_key(node: &VPLNode, dir: &Path) -> String {
	format!("{}\n{node}", dir.display())
}

/// Builds a read node on its own, as the head of a pipeline that does not exist yet.
///
/// **What opening a container goes through** ([`crate::analysis::open`] is the plain reader). The
/// inspector needs the container mounted the moment it opens, and the preview builds the same
/// `from_container` node a moment later. Built here, the two are one source: the preview takes it
/// as its head, and a remote container's index is read once rather than twice. `from_container`
/// forwards every call to the reader it opens, so serving it is serving the container.
pub async fn build_head(runtime: &TilesRuntime, node: VPLNode, dir: &Path) -> Result<BuiltHead> {
	let key = head_key(&node, dir);
	let factory = PipelineFactory::new_runtime_reader(dir, runtime.clone());
	let built = factory
		.read_operation_from_node(node)
		.await
		.context("building the source")?;
	Ok(BuiltHead {
		key,
		source: SharedTileSource::from(built),
	})
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
	let reusable = reusable.filter(|head| head.heads(&pipeline, dir)).cloned();
	let (node, tail) = pipeline.split().context("splitting the pipeline")?;

	let head = match reusable {
		Some(head) => head,
		None => build_head(runtime, node, dir).await?,
	};

	let reader = PipelineReader::from_parts(head.source.clone(), tail, "preview", dir, runtime.clone())
		.await
		.context("building the pipeline")?;
	Ok((Arc::new(reader), head))
}

/// What arrives at the node at `index` in the top-level chain, reusing an already-built read node.
///
/// **The input, not the output.** A `vector_filter_layers` is asked which layers it should keep, and
/// the answer is what reaches it - including the ones it is currently removing, which are exactly the
/// ones someone reconsidering the filter wants to see. So the prefix stops *before* the node.
///
/// `index` is a position in the pipeline as written. `0` is the read node, whose input is nothing, so
/// there is no source to describe and this answers `None`.
///
/// Cheap because of [`build_reusing`]: the transforms before a node parse their parameters and wrap
/// their input, and the read node they wrap is the one already built for the preview.
pub async fn source_before(
	runtime: &TilesRuntime,
	pipeline: VPLPipeline,
	dir: &Path,
	index: usize,
	reusable: Option<&BuiltHead>,
) -> Result<Option<(SharedTileSource, BuiltHead)>> {
	if index == 0 {
		return Ok(None);
	}
	let reusable = reusable.filter(|head| head.heads(&pipeline, dir)).cloned();
	let (node, tail) = pipeline.split().context("splitting the pipeline")?;
	if index > tail.len() {
		return Ok(None);
	}

	let head = match reusable {
		Some(head) => head,
		None => build_head(runtime, node, dir).await?,
	};

	let reader = PipelineReader::from_parts(
		head.source.clone(),
		tail[..index - 1].to_vec(),
		"preview",
		dir,
		runtime.clone(),
	)
	.await
	.context("building the pipeline")?;
	Ok(Some((Arc::new(reader), head)))
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
	/// **`from_debug` rather than a container**, because what this needs is tiles at every zoom and
	/// nothing else. It used to read `berlin.versatiles` from a `versatiles-rs` checkout beside this
	/// one - which every machine that develops Studio has and no CI runner does, so the job failed on
	/// a missing fixture rather than on anything about the code. The other tests in this file read the
	/// repository's own `testdata/`; this one now needs no file at all.
	///
	/// The transform is a `filter`, so coverage differs from the source's own - a fold that dropped
	/// the tail would show up as tiles that should have been clipped away, which comparing `None`
	/// against `None` is what catches. That only holds while the filter really removes something,
	/// which is why the count of what it removed is asserted too.
	#[tokio::test]
	async fn a_reused_head_builds_the_same_tiles_as_a_full_build() -> Result<()> {
		let runtime = versatiles::runtime::create_runtime();
		let dir = std::path::Path::new(".");
		let read = "from_debug format=pbf";
		let vpl = format!("{read} | filter bbox=[13.3,52.4,13.5,52.6]");

		let whole = build(&runtime, parse(&vpl), dir).await?;
		let (_, head) = build_reusing(&runtime, parse(read), dir, None).await?;
		let (reused, _) = build_reusing(&runtime, parse(&vpl), dir, Some(&head)).await?;

		let blob = |t: Option<versatiles_container::Tile>| {
			t.map(|mut tile| tile.as_blob(&versatiles_core::TileCompression::Uncompressed).cloned())
				.transpose()
		};
		let mut covered = 0;
		let mut clipped = 0;
		for z in 0..=6u8 {
			let side = 1u32 << z;
			for x in 0..side {
				for y in 0..side {
					let coord = versatiles_core::TileCoord::new(z, x, y)?;
					let expected = blob(whole.tile(&coord).await?)?;
					covered += usize::from(expected.is_some());
					clipped += usize::from(expected.is_none());
					assert_eq!(blob(reused.tile(&coord).await?)?, expected, "at {z}/{x}/{y}");
				}
			}
		}
		assert!(covered > 0, "the source covered no tile, so only absence was compared");
		// Both halves have to be non-empty or the comparison proves nothing: all-present would pass
		// with the `filter` dropped, and all-absent would pass with the whole pipeline dropped.
		assert!(
			clipped > 0,
			"the filter removed nothing, so the tail was never exercised"
		);
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

	/// **A container opened on its own is the head the pipeline then builds on**, so opening a remote
	/// one reads its index once. A head for another file must not be taken, or the preview would
	/// show the wrong container.
	#[tokio::test]
	async fn an_opened_read_node_is_the_head_its_pipeline_takes() -> Result<()> {
		let (runtime, dir) = (versatiles::runtime::create_runtime(), fixtures());
		let read = "from_debug format=pbf";
		let opened = build_head(&runtime, parse(read).pipeline.remove(0), &dir).await?;

		let pipeline = parse(&format!("{read} | filter bbox=[13.3,52.4,13.5,52.6]"));
		assert!(opened.heads(&pipeline, &dir));
		assert!(!opened.heads(&parse("from_debug format=png"), &dir));

		let (_, head) = build_reusing(&runtime, pipeline, &dir, Some(&opened)).await?;
		assert!(Arc::ptr_eq(opened.source(), head.source()), "the source was read again");
		assert!(head.same_node(&opened));
		Ok(())
	}

	/// **The coloured relief the Sources pane starts from builds**, into imagery rather than elevation:
	/// its schema is what stops the Style pane offering a hillshade of a hillshade.
	#[tokio::test]
	async fn a_coloured_relief_builds_as_imagery() -> Result<()> {
		let (runtime, dir) = (versatiles::runtime::create_runtime(), fixtures());
		let read = r#"from_debug format=png | meta_update schema="dem/mapbox""#;
		let relief = format!("{read} | dem_hillshade ramp=default");

		let source = build(&runtime, parse(&relief), &dir).await?;

		let info = crate::analysis::describe(&source, "preview").await?;
		assert_eq!(info.tile_format, "png");
		assert_ne!(info.tile_schema.as_deref(), Some("dem/mapbox"));
		assert!(source.tile(&versatiles_core::TileCoord::new(3, 1, 2)?).await?.is_some());
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

	/// The same text in another directory names other files (Q55), so it is not the same head.
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
	/// (Q49), so what `Document::to_pipeline_without` hands over has to be runnable and not
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

	/// An emptied `vector_branch` branch is kept in place rather than dropped, which is only right
	/// if upstream builds it - as "unchanged" - and does not refuse it.
	#[tokio::test]
	async fn a_vector_branch_with_an_emptied_branch_builds() -> Result<()> {
		let runtime = versatiles::runtime::create_runtime();
		let document = Document::parse(
			"from_debug format=pbf | vector_branch expr=\"$layer == 'x'\" [ vector_filter_layers filter=a, vector_filter_layers filter=c ]",
		)
		.unwrap();

		for branch in [0, 1] {
			let off = [vec![1, branch, 0]].into_iter().collect();
			let wanted = document.to_pipeline_without(&off).expect("the head is still there");
			assert_eq!(wanted.pipeline[1].sources.len(), 2, "both branches keep their places");
			let source = build(&runtime, wanted, Path::new(".")).await?;
			assert_eq!(crate::analysis::describe(&source, "preview").await?.tile_format, "mvt");
		}
		Ok(())
	}
}
