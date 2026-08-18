//! Writing the pipeline's output to a container file (S3.6, F2).
//!
//! The point at which Studio stops being a viewer. Everything before this produces tiles on demand
//! for a map; this produces a file someone can publish, hand to a colleague, or feed to the CLI.
//!
//! **The first job in the runner's [`Queued`](crate::jobs::Lane::Queued) lane.** A preview is
//! superseded by the next edit; an export is not — it is the thing you started and walked away from,
//! and running two at once would only make both slower ([Q27](../../docs/decisions.md)). That is the
//! lane's whole reason for existing, and until now nothing used it.
//!
//! **Progress is versatiles-rs's own, not invented here.** `TilesRuntime` carries an
//! [`EventBus`](versatiles_container::EventBus) that its writers already emit progress, steps and
//! warnings to; this subscribes to it and forwards each one to a [`JobHandle`]. A percentage made up
//! by counting tiles ourselves would be a second opinion about work we are not doing.
//!
//! **An export is bounded before it starts.** A tile source may declare a pyramid far larger than
//! anything anyone means to write — `from_debug` says levels 0 to 30 and calls the pyramid complete,
//! which is 10^18 tiles. A preview never notices, because it serves only the tiles the map asks
//! for; an export walks the whole thing, and the writer's block index grows with it until the
//! machine dies. So the tile count is computed from the pyramid first and an absurd one is refused
//! with a number and a way forward, rather than started and left to be discovered.
//!
//! **What is not here yet.** The crop rectangle is [S5.4](../../docs/scope-release-1.md) and the
//! cost estimate is S3.7. `max_zoom` is here early because it is the way out of the refusal above —
//! a bound is a safety valve, not a convenience.

use crate::jobs::JobHandle;
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use versatiles_container::{Event, TilesRuntime};
use versatiles_pipeline::VPLPipeline;

/// Container formats that can be written, by extension.
///
/// Taken from `versatiles_container`'s own writer registry rather than declared here — except that
/// the registry is not enumerable, so this list mirrors the module documentation's write column and
/// a test checks each one by writing to it. `.tar` and directories are writable too and are left
/// out deliberately: they are ways of *serving* tiles rather than of handing someone a file, and the
/// save dialog is a file dialog.
pub const WRITABLE: [&str; 3] = ["versatiles", "mbtiles", "pmtiles"];

/// The most tiles Studio will write without being told a zoom range.
///
/// Not a performance limit — a sanity one. 100 million tiles is already an overnight job and tens of
/// gigabytes; the pyramids this catches are a million times larger than that and cannot be written
/// at any price, on any machine. The number only has to sit above every real export and below every
/// impossible one, and there are many orders of magnitude between the two.
pub const MAX_TILES: u64 = 100_000_000;

/// Whether Studio will offer to write this path.
///
/// Checked before the job starts so an unknown extension is a message rather than a job that fails
/// after opening every source.
#[must_use]
/// What an export narrows the pipeline to before writing it.
///
/// Every field is optional and `None` means "as far as the pipeline goes". They are applied as one
/// `filter` node appended to the pipeline ([S3.6](../../../docs/scope-release-1.md)) rather than by
/// clamping numbers we then look at: `filter` is versatiles-rs's own operation for this, so the
/// source really does stop there and the tile count computed afterwards is the count that will be
/// written.
#[derive(Debug, Clone, Copy, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Bounds {
	/// West, south, east, north, in degrees — the four number fields [Q32] asks for.
	#[cfg_attr(feature = "bindings", specta(type = Option<[specta_typescript::Number; 4]>))]
	pub bbox: Option<[f64; 4]>,
	pub min_zoom: Option<u8>,
	pub max_zoom: Option<u8>,
}

impl Bounds {
	/// The `filter` parameters these bounds mean, or `None` when they narrow nothing.
	///
	/// Checked before it is written rather than after it is parsed: a `NaN` reaching the text would
	/// spell `bbox=[NaN,…]`, which fails as a *parse* error about VPL syntax — an answer about the
	/// wrong thing entirely for someone who typed a number in a form.
	fn clause(&self) -> Result<Option<String>> {
		let mut parts: Vec<String> = Vec::new();

		if let Some([west, south, east, north]) = self.bbox {
			anyhow::ensure!(
				[west, south, east, north].iter().all(|value| value.is_finite()),
				"a bounding box needs four numbers"
			);
			anyhow::ensure!(
				west < east,
				"the west edge ({west}) must be left of the east edge ({east})"
			);
			anyhow::ensure!(
				south < north,
				"the south edge ({south}) must be below the north edge ({north})"
			);
			parts.push(format!("bbox=[{west},{south},{east},{north}]"));
		}

		if let (Some(min), Some(max)) = (self.min_zoom, self.max_zoom) {
			anyhow::ensure!(
				min <= max,
				"zoom {min} to {max} is empty — the minimum is above the maximum"
			);
		}
		if let Some(min) = self.min_zoom {
			parts.push(format!("level_min={min}"));
		}
		if let Some(max) = self.max_zoom {
			parts.push(format!("level_max={max}"));
		}

		Ok((!parts.is_empty()).then(|| parts.join(" ")))
	}
}

pub fn is_writable(path: &Path) -> bool {
	path
		.extension()
		.map(|extension| extension.to_string_lossy().to_lowercase())
		.is_some_and(|extension| WRITABLE.contains(&extension.as_str()))
}

/// Builds `pipeline` and writes everything it produces to `target`.
///
/// `dir` is what relative paths in the VPL resolve against, as everywhere else.
///
/// **Its own runtime**, not the server's. The events on a shared bus would arrive mixed with every
/// preview the window builds while this runs, and a job's log has to be that job's. The cost is
/// re-opening the sources, which a full write does anyway.
pub async fn write(handle: &JobHandle, pipeline: VPLPipeline, dir: &Path, target: &Path, bounds: Bounds) -> Result<()> {
	anyhow::ensure!(
		is_writable(target),
		"cannot write {}: Studio writes {}",
		target.display(),
		WRITABLE.join(", ")
	);

	// `silent_progress`, because the default renders an ANSI progress bar to stdout — correct for
	// the CLI this library also serves, and in a desktop application it is escape codes written into
	// a log nobody is watching. The progress still arrives; it arrives on the event bus, which is
	// where `forward_events` is listening.
	let runtime = versatiles::runtime::create_runtime_builder()
		.silent_progress(true)
		.build();
	forward_events(&runtime, handle);

	// The bounds are applied to the *pipeline*, not to a copy of its pyramid — clamping a number we
	// only look at would refuse an unbounded export and then write one anyway.
	let pipeline = match bounds.clause()? {
		None => pipeline,
		Some(clause) => crate::vpl::Document::parse(format!("{pipeline} | filter {clause}"))
			.context("bounding the pipeline")?
			.to_pipeline(),
	};

	handle.working("building the pipeline");
	let source = crate::preview::build(&runtime, pipeline, dir)
		.await
		.context("building the pipeline")?;

	// Reading the pyramid is bounds arithmetic, not a traversal, so this costs nothing — and it
	// happens before anything is opened for writing, which is the whole point.
	let pyramid = source.tile_pyramid().await.context("reading the tile pyramid")?;
	let tiles = pyramid.count_tiles();
	anyhow::ensure!(
		tiles <= MAX_TILES,
		"this pipeline covers {tiles} tiles up to zoom {}, which cannot be written. \
		 Set a maximum zoom — {} tiles is the limit.",
		pyramid.level_max().unwrap_or(0),
		MAX_TILES
	);
	handle.log(format!(
		"{tiles} tiles, zoom {}–{}",
		pyramid.level_min().unwrap_or(0),
		pyramid.level_max().unwrap_or(0)
	));

	// Written beside the target and renamed on success, so a cancelled or failed export never
	// leaves a half-written file where a whole one used to be. The same reasoning as `Recents::save`
	// — and the same bug is available here, so the temporary name stays inside the target's own
	// directory rather than being `with_extension`ed onto it.
	let scratch = scratch_path(target);
	handle.log(format!("writing {}", target.display()));

	let outcome = runtime.write_to_path(source, &scratch).await;
	if let Err(error) = outcome {
		let _ = std::fs::remove_file(&scratch);
		return Err(error).context("writing the container");
	}

	// A job aborted mid-write leaves the scratch file, which is what the check below is for: by the
	// time we get here the write finished, so cancellation means the *result* is unwanted rather
	// than incomplete.
	if handle.is_cancelled() {
		let _ = std::fs::remove_file(&scratch);
		return Ok(());
	}

	std::fs::rename(&scratch, target)
		.with_context(|| format!("moving the finished container into {}", target.display()))?;
	handle.log(format!("wrote {}", describe_size(target)));
	Ok(())
}

/// Where the container is assembled before it replaces the target.
///
/// Two constraints, and they pull in different directions:
///
/// * **In the target's own directory**, so the rename is on one filesystem. A cross-device rename
///   fails, and falling back to a copy would double the time on a file that can be tens of
///   gigabytes.
/// * **Keeping the target's extension last.** The writer chooses its format from the extension, so
///   `berlin.versatiles.writing` is not a `.versatiles` being written — it is an unknown format, and
///   the write fails before it starts. The marker goes in the middle instead.
fn scratch_path(target: &Path) -> PathBuf {
	let stem = target.file_stem().unwrap_or_else(|| std::ffi::OsStr::new("export"));
	let mut scratch = stem.to_os_string();
	scratch.push(".writing");
	if let Some(extension) = target.extension() {
		scratch.push(".");
		scratch.push(extension);
	}
	target.with_file_name(scratch)
}

/// Pipes the runtime's own events into the job's progress and log.
///
/// Progress arrives as a position and a total from whichever writer is running, which is the number
/// that means something — tiles written of tiles to write, counted by the thing writing them.
fn forward_events(runtime: &TilesRuntime, handle: &JobHandle) {
	// The handle's reporting half, so the listener does not need the job's cancellation state.
	let sink = handle.reporter();
	runtime.events().subscribe(move |event| match event {
		Event::Progress { data } => {
			if data.total > 0 {
				#[allow(clippy::cast_precision_loss)]
				sink.progress(data.position as f64 / data.total as f64, data.message.clone());
			} else {
				sink.working(data.message.clone());
			}
		}
		Event::Step { message } => sink.working(message.clone()),
		Event::Warning { message } => sink.log(format!("warning: {message}")),
		Event::Error { message } => sink.log(format!("error: {message}")),
		// Log events are the library's own tracing, at every level down to trace. Forwarding them
		// would bury the few lines a person needs in thousands they do not.
		Event::Log { .. } => {}
	});
}

/// The written file's size, for the log line that says it worked.
fn describe_size(path: &Path) -> String {
	let Ok(metadata) = std::fs::metadata(path) else {
		return path.display().to_string();
	};
	#[allow(clippy::cast_precision_loss)]
	let mb = metadata.len() as f64 / 1_048_576.0;
	format!("{} ({mb:.1} MB)", path.display())
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::jobs::{CancelToken, JobEvent};
	use crate::vpl::Document;
	use std::sync::{Arc, Mutex};

	fn job() -> (JobHandle, Arc<Mutex<Vec<JobEvent>>>) {
		let events = Arc::new(Mutex::new(Vec::new()));
		let sink_events = Arc::clone(&events);
		let handle = JobHandle::new(
			1,
			Arc::new(move |e| sink_events.lock().unwrap().push(e)),
			CancelToken::new(),
		);
		(handle, events)
	}

	/// Every test writes with an explicit zoom bound.
	///
	/// `from_debug` declares a *complete* pyramid to level 30 — 10^18 tiles — so an unbounded write
	/// of it does not finish, it exhausts the machine's memory. This is not caution; it is the bug
	/// that made this constant exist, found by running the tests without it.
	/// Every write in these tests is bounded, because an unbounded one is a complete pyramid: the
	/// first version of this file wrote `from_debug` to disk and took the machine with it.
	const TEST_BOUNDS: Bounds = Bounds {
		bbox: None,
		min_zoom: None,
		max_zoom: Some(3),
	};

	fn temp(name: &str) -> PathBuf {
		let path = std::env::temp_dir().join(format!("versatiles-studio-export-{name}"));
		let _ = std::fs::remove_file(&path);
		path
	}

	#[test]
	fn only_the_formats_studio_offers_are_writable() {
		assert!(is_writable(Path::new("out.versatiles")));
		assert!(is_writable(Path::new("out.mbtiles")));
		assert!(is_writable(Path::new("out.pmtiles")));
		// Case is the filesystem's business, not the user's.
		assert!(is_writable(Path::new("OUT.MBTiles")));

		assert!(!is_writable(Path::new("out.geojson")));
		assert!(!is_writable(Path::new("out")));
		assert!(
			!is_writable(Path::new("out.tar")),
			"a tar is a way to serve, not a file to hand over"
		);
	}

	/// Every format the save dialog offers has to actually be writable — a list naming one the
	/// registry does not know would fail after opening every source, which on a real export is
	/// minutes in.
	///
	/// A plain raster source, deliberately: **whether a write succeeds is a property of the pair,
	/// not of the extension.** `raster_overview` produces a depth-first traversal that PMTiles
	/// cannot consume, and MBTiles takes gzipped pbf where a pipeline emits uncompressed mvt. That
	/// is upstream's business to report and ours to report *well* — see
	/// `a_format_a_pipeline_cannot_produce_fails_with_a_reason`.
	#[tokio::test]
	async fn every_offered_format_can_be_written() -> Result<()> {
		let (handle, _) = job();
		let document = Document::parse("from_debug format=png")?;

		for extension in WRITABLE {
			let target = temp(&format!("offered.{extension}"));
			write(&handle, document.to_pipeline(), Path::new("."), &target, TEST_BOUNDS).await?;
			assert!(target.exists(), "{extension} was not written");
			assert!(std::fs::metadata(&target)?.len() > 0, "{extension} is empty");
			let _ = std::fs::remove_file(&target);
		}
		Ok(())
	}

	/// What is written has to be readable, or "export" means "produce a file" rather than "produce
	/// tiles" — and the difference only shows up in someone else's hands.
	#[tokio::test]
	async fn what_is_written_reads_back_as_the_same_tiles() -> Result<()> {
		let (handle, _) = job();
		let document = Document::parse("from_debug format=png | raster_overview level=2")?;
		let target = temp("roundtrip.versatiles");

		write(&handle, document.to_pipeline(), Path::new("."), &target, TEST_BOUNDS).await?;

		let runtime = versatiles::runtime::create_runtime();
		let written = runtime.reader_from_str(&target.to_string_lossy()).await?;
		let info = crate::analysis::describe(&written, "written").await?;
		assert_eq!(info.tile_format, "png");
		assert_eq!(info.container, "versatiles");
		assert!(info.max_zoom >= info.min_zoom);

		let _ = std::fs::remove_file(&target);
		Ok(())
	}

	/// An unknown extension is refused before any work happens, rather than after the sources are
	/// open.
	#[tokio::test]
	async fn an_unwritable_extension_is_refused_immediately() {
		let (handle, _) = job();
		let document = Document::parse("from_debug format=png").unwrap();
		let target = temp("nope.geojson");

		let error = write(&handle, document.to_pipeline(), Path::new("."), &target, TEST_BOUNDS)
			.await
			.unwrap_err();
		assert!(
			format!("{error:#}").contains("versatiles, mbtiles, pmtiles"),
			"{error:#}"
		);
		assert!(!target.exists());
	}

	/// A failed export must not destroy the file it was replacing. Writing in place would, and this
	/// is the case that proves it does not.
	#[tokio::test]
	async fn a_failed_write_leaves_the_previous_file_untouched() -> Result<()> {
		let (handle, _) = job();
		let target = temp("previous.versatiles");
		std::fs::write(&target, b"the file that was already there")?;

		// A pipeline that fails on open: `from_container` pointed at nothing. Built through
		// `read_node` rather than written out, because a bare path with slashes in it is not valid
		// VPL — quoting is the core's job everywhere else and it is the core's job here too.
		let vpl = crate::vpl::read_node("from_container", "/nowhere/absent.versatiles");
		let document = Document::parse(&vpl)?;
		let result = write(&handle, document.to_pipeline(), Path::new("."), &target, TEST_BOUNDS).await;

		assert!(result.is_err(), "this pipeline should not have written anything");
		assert_eq!(
			std::fs::read(&target)?,
			b"the file that was already there",
			"a failed export overwrote the file it was replacing"
		);
		assert!(!scratch_path(&target).exists(), "the half-written file was left behind");

		let _ = std::fs::remove_file(&target);
		Ok(())
	}

	/// The scratch file has to be a sibling: a rename across filesystems fails, and the temporary
	/// directory is routinely on a different one.
	#[test]
	fn the_scratch_file_is_beside_its_target() {
		let target = Path::new("/data/tiles/berlin.versatiles");
		let scratch = scratch_path(target);
		assert_eq!(scratch.parent(), target.parent());
		assert_ne!(scratch, target.to_path_buf());
		assert_eq!(
			scratch.file_name().unwrap(),
			"berlin.writing.versatiles",
			"the extension has to stay last — the writer picks its format from it"
		);
	}

	/// Not every pipeline can produce every format, and the reason has to survive to the caller —
	/// a job that says only "failed" leaves someone guessing at a container format.
	#[tokio::test]
	async fn a_format_a_pipeline_cannot_produce_fails_with_a_reason() {
		let (handle, _) = job();
		// Vector tiles, uncompressed: MBTiles wants them gzipped and says so.
		let document = Document::parse("from_debug format=pbf").unwrap();
		let target = temp("mismatch.mbtiles");

		let error = write(&handle, document.to_pipeline(), Path::new("."), &target, TEST_BOUNDS)
			.await
			.unwrap_err();
		let message = format!("{error:#}");
		assert!(message.contains("MBTiles supports only"), "{message}");
		assert!(!target.exists(), "a refused format left a file behind");
	}

	/// The bug that cost a machine: `from_debug` declares a complete pyramid to level 30, and an
	/// unbounded write of it consumes every byte of memory the system has. Refused up front, with
	/// the count and the way out, rather than started and discovered.
	#[tokio::test]
	async fn an_unbounded_pyramid_is_refused_before_anything_is_written() {
		let (handle, _) = job();
		let document = Document::parse("from_debug format=png").unwrap();
		let target = temp("unbounded.versatiles");

		let error = write(
			&handle,
			document.to_pipeline(),
			Path::new("."),
			&target,
			Bounds::default(),
		)
		.await
		.unwrap_err();
		let message = format!("{error:#}");
		assert!(message.contains("cannot be written"), "{message}");
		assert!(message.contains("Set a maximum zoom"), "{message}");
		assert!(!target.exists(), "nothing should have been written");
		assert!(!scratch_path(&target).exists());
	}

	#[test]
	fn bounds_that_narrow_nothing_produce_no_filter() {
		assert_eq!(Bounds::default().clause().unwrap(), None);
	}

	#[test]
	fn each_bound_becomes_one_filter_parameter() {
		let clause = Bounds {
			bbox: Some([13.0, 52.3, 13.8, 52.7]),
			min_zoom: Some(2),
			max_zoom: Some(14),
		}
		.clause()
		.unwrap();

		assert_eq!(
			clause.as_deref(),
			Some("bbox=[13,52.3,13.8,52.7] level_min=2 level_max=14")
		);
	}

	/// The clause is appended to VPL text, so a value that cannot be written as a number would
	/// surface as a parse error about syntax — an answer about the wrong thing for someone who
	/// typed into a form.
	#[test]
	fn a_bounding_box_that_is_not_one_is_refused_with_its_own_words() {
		let nan = Bounds {
			bbox: Some([f64::NAN, 0.0, 1.0, 1.0]),
			..Bounds::default()
		};
		assert!(format!("{:#}", nan.clause().unwrap_err()).contains("four numbers"));

		let inside_out = Bounds {
			bbox: Some([10.0, 0.0, 5.0, 1.0]),
			..Bounds::default()
		};
		let message = format!("{:#}", inside_out.clause().unwrap_err());
		assert!(message.contains("west edge"), "{message}");

		let upside_down = Bounds {
			bbox: Some([0.0, 10.0, 1.0, 5.0]),
			..Bounds::default()
		};
		assert!(format!("{:#}", upside_down.clause().unwrap_err()).contains("south edge"));
	}

	#[test]
	fn an_empty_zoom_range_is_refused_rather_than_written_as_nothing() {
		let backwards = Bounds {
			min_zoom: Some(9),
			max_zoom: Some(3),
			..Bounds::default()
		};
		let message = format!("{:#}", backwards.clause().unwrap_err());
		assert!(message.contains("minimum is above the maximum"), "{message}");
	}

	/// The box has to reach the *file*, for the same reason the zoom bound does.
	///
	/// Asserted as "contains the request, and is far smaller than the world" rather than as exact
	/// numbers: a container's extent covers whole *tiles*, so the grid rounds the request outward —
	/// 13.0..13.8 comes back as 11.25..16.875 at zoom 6. Pinning the snapped figures would be
	/// pinning the tile grid, and would break on any change of zoom.
	#[tokio::test]
	async fn a_bounding_box_reaches_what_is_written() -> Result<()> {
		let (handle, _) = job();
		let document = Document::parse("from_debug format=png")?;
		let target = temp("boxed.versatiles");

		write(
			&handle,
			document.to_pipeline(),
			Path::new("."),
			&target,
			Bounds {
				bbox: Some([13.0, 52.3, 13.8, 52.7]),
				min_zoom: None,
				max_zoom: Some(6),
			},
		)
		.await?;

		let runtime = versatiles::runtime::create_runtime();
		let written = runtime.reader_from_str(&target.to_string_lossy()).await?;
		let info = crate::analysis::describe(&written, "written").await?;
		let [west, south, east, north] = info.bbox.expect("a written container knows its extent");

		assert!(
			west <= 13.0 && east >= 13.8,
			"the written extent must contain what was asked for: {west}..{east}"
		);
		assert!(
			south <= 52.3 && north >= 52.7,
			"the written extent must contain what was asked for: {south}..{north}"
		);
		assert!(
			east - west < 30.0,
			"longitude was not narrowed at all: {west}..{east} of a 360-degree world"
		);
		assert!(
			north - south < 30.0,
			"latitude was not narrowed at all: {south}..{north}"
		);
		Ok(())
	}

	/// And the way out works: the same pipeline, bounded, writes.
	#[tokio::test]
	async fn a_zoom_bound_makes_the_same_pipeline_writable() -> Result<()> {
		let (handle, _) = job();
		let document = Document::parse("from_debug format=png")?;
		let target = temp("bounded.versatiles");

		write(
			&handle,
			document.to_pipeline(),
			Path::new("."),
			&target,
			Bounds {
				max_zoom: Some(2),
				..Bounds::default()
			},
		)
		.await?;

		// The bound has to reach the *file*, not just the check — a pyramid clamped only for
		// counting would refuse an unbounded export and then write one anyway.
		let runtime = versatiles::runtime::create_runtime();
		let written = runtime.reader_from_str(&target.to_string_lossy()).await?;
		let info = crate::analysis::describe(&written, "written").await?;
		assert_eq!(info.max_zoom, 2, "the written container ignored the zoom bound");

		let _ = std::fs::remove_file(&target);
		Ok(())
	}

	/// Progress is the writer's own count, so the job says something a person can act on rather
	/// than a spinner.
	#[tokio::test]
	async fn the_writers_progress_reaches_the_job() -> Result<()> {
		let (handle, events) = job();
		let document = Document::parse("from_debug format=png | raster_overview level=2")?;
		let target = temp("progress.versatiles");

		write(&handle, document.to_pipeline(), Path::new("."), &target, TEST_BOUNDS).await?;

		let events = events.lock().unwrap();
		let measured = events
			.iter()
			.filter(|event| matches!(event, JobEvent::Progress { fraction: Some(_), .. }))
			.count();
		assert!(
			measured > 0,
			"no measured progress arrived from the writer: {:?}",
			events.iter().take(8).collect::<Vec<_>>()
		);
		let _ = std::fs::remove_file(&target);
		Ok(())
	}
}
