//! What an export will cost, measured before it is started (S3.7, C6).
//!
//! "~2.3 GB" is the whole feature. An export is the one thing Studio does that can fill a disk, and
//! until now the only way to find out how much was to start it and watch. The number does not have
//! to be exact; it has to separate a file you can send from one you cannot, before the decision
//! rather than after it.
//!
//! **How long it will take is deliberately not answered.** It used to be, from the wall-clock time
//! of the samples below, and it was wrong by a wide margin in both directions: sampling produces
//! tiles one at a time while a write produces them across the runtime's whole worker pool, so a
//! sequential per-tile time multiplied by the tile count over-states the total by roughly the
//! parallelism - and unlike the byte estimate it was never stratified by zoom, so one flat average
//! stood for levels whose tiles differ by orders of magnitude. Both are structural, not tuning: no
//! constant fixes a sequential measurement of parallel work. A number that wrong is worse than no
//! number, because it is read as a promise. The status bar reports the real speed and ETA once the
//! export is running, measured against what it is actually doing.
//!
//! **Measured, not modelled.** There is no formula from tile count to bytes: a vector tile of empty
//! ocean is nothing and one of central Berlin is hundreds of kilobytes, and the pipeline in between
//! can do anything. So this runs the real pipeline over real tiles and multiplies up. The cost of
//! being right is that estimating takes time, which is what [`BUDGET`] bounds.
//!
//! **Stratified by zoom, because zoom is what the variance is about.** A level holds four times the
//! tiles of the one above it, so the deepest level is most of any export - and its tiles are also
//! the smallest, which is exactly the correlation that makes a single overall average wrong. Each
//! level is sampled and multiplied by its own tile count.
//!
//! **The same pipeline the write walks.** Bounds are applied through
//! [`export::bounded`] rather than reimplemented here, so the tiles measured
//! are the tiles written. Two ways of narrowing a pipeline would agree on the day they were written
//! and quietly stop agreeing later.

use crate::export::{self, Bounds, Compression};
use anyhow::{Context, Result};
use std::path::Path;
use std::time::{Duration, Instant};
use versatiles_core::TileBBox;
use versatiles_pipeline::VPLPipeline;

/// How long sampling runs before it stops at the first point the estimate is worth having.
///
/// An estimate is something a dialog waits on, so its cost is a UI decision rather than a
/// statistical one: two seconds is long enough to look like work and short enough not to feel
/// broken.
///
/// **A floor to stop at, not a ceiling to stop on** ([`MIN_SAMPLES`]). It used to end sampling
/// wherever it happened to fall, and on a slow pipeline that was mid-way through the *first* pass
/// over the levels - six tiles, most levels never looked at, and each unsampled level's bytes
/// invented from the average of the ones that were. The deepest level holds three quarters of any
/// pyramid, so an estimate built that way is a number with no measurement behind it. Sampling now
/// runs past this until it has covered every level and taken [`MIN_SAMPLES`], which costs a slow
/// pipeline more than two seconds and is the trade worth making: nobody wants a fast wrong number.
pub const BUDGET: Duration = Duration::from_secs(2);

/// The fewest tiles an estimate is made from, however long they take.
///
/// **Because a handful of tiles is not a sample of a pyramid.** Fifty is not a statistical
/// threshold - the variance between an ocean tile and a city one is far too wide for any small
/// number to be safe - it is the point below which the answer stops being worth showing at all.
///
/// Bounded above by [`MAX_SAMPLES`], so the two together say: always between fifty and sixty-four
/// tiles, and the budget decides where in that range a slow pipeline lands.
pub const MIN_SAMPLES: u32 = 50;

/// The most tiles to produce, however fast they come.
///
/// The budget alone would let a trivial pipeline sample tens of thousands of tiles for an accuracy
/// nobody can see: the answer is rounded to "~2.3 GB" either way. This is where the remaining time
/// is given back instead.
///
/// The hard end of the range [`MIN_SAMPLES`] opens, and it wins over both the floor and the level
/// coverage: a caller that asks for fewer samples than there are levels gets fewer samples than
/// there are levels, and the unsampled ones fall back to the overall average below.
pub const MAX_SAMPLES: u32 = 64;

/// The two constants have to describe a range, or the floor is unreachable and an estimate quietly
/// goes back to being made of however few tiles the budget bought.
///
/// A compile-time assertion rather than a test: this is a property of the two numbers as written,
/// and the build is the right place to refuse them.
const _: () = assert!(MAX_SAMPLES >= MIN_SAMPLES);

/// What an export is expected to cost.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Estimate {
	/// Tiles the export will write - a count, not an estimate.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub tiles: u64,
	/// Bytes those tiles are expected to come to.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub bytes: u64,
	/// How many tiles were actually produced to arrive at the byte figure above.
	///
	/// Reported because it is the honest measure of how much the estimate is worth, and the only
	/// one the webview could not work out for itself. Four samples of a slow pipeline and sixty of
	/// a fast one deserve different wording.
	pub sampled: u32,
}

/// Runs `pipeline` over a sample of the tiles `bounds` selects, and multiplies up.
///
/// `dir` is what relative paths in the VPL resolve against, as everywhere else.
pub async fn estimate(pipeline: VPLPipeline, dir: &Path, bounds: Bounds, compression: Compression) -> Result<Estimate> {
	sample(pipeline, dir, bounds, compression, BUDGET, MIN_SAMPLES, MAX_SAMPLES).await
}

/// The estimate, with the limits as arguments rather than as constants.
///
/// **Split out for the tests, and the split is load-bearing.** Asserting anything exact about the
/// arithmetic means knowing how many samples were taken, and under the shipped budget that is a
/// question about how fast the machine was that day - the test that checks a complete sample
/// against ground truth passed alone and failed under a loaded test run, which is the definition of
/// a test that measures the wrong thing. Time is an input here, so it can be held still.
async fn sample(
	pipeline: VPLPipeline,
	dir: &Path,
	bounds: Bounds,
	compression: Compression,
	budget: Duration,
	min_samples: u32,
	max_samples: u32,
) -> Result<Estimate> {
	// Its own runtime, for the same reason [`export::write`] builds one: the events of a sampling
	// run have no business on the bus the preview is using.
	let runtime = versatiles::runtime::create_runtime_builder()
		.silent_progress(true)
		.build();

	let pipeline = export::bounded(pipeline, bounds)?;
	let source = crate::preview::build(&runtime, pipeline, dir)
		.await
		.context("building the pipeline")?;
	// **A tile's size is a property of its encoding**, so the samples are measured through the same
	// re-encoding the write applies. Measuring gzip and writing brotli would report a number about a
	// file nobody is going to have.
	let source = export::encoded(source, compression).await?;

	let pyramid = source.tile_pyramid().await.context("reading the tile pyramid")?;
	let tiles = export::writable_count(&pyramid)?;

	// An empty selection is a real answer rather than a division by zero - a bounding box over open
	// ocean, or a zoom range the source does not reach.
	if tiles == 0 {
		return Ok(Estimate {
			tiles: 0,
			bytes: 0,
			sampled: 0,
		});
	}

	let levels: Vec<TileBBox> = pyramid.to_iter_bboxes().filter(|bbox| bbox.count_tiles() > 0).collect();
	let mut measured: Vec<Measured> = levels.iter().map(|_| Measured::default()).collect();

	// **Deepest level first, one tile per level per round.** Round-robin means the first pass alone
	// covers every level; deepest-first means that when sampling does stop mid-pass - which only the
	// cap can now cause - the levels it missed are the ones holding fewest tiles.
	let started = Instant::now();
	let mut taken = 0;
	'sampling: for round in 0.. {
		let mut any = false;
		for (index, bbox) in levels.iter().enumerate().rev() {
			let count = bbox.count_tiles();
			// Nothing left to look at on this level that has not been looked at already.
			if u64::from(round) >= count {
				continue;
			}
			any = true;

			let coord = bbox
				.coord_at_index(spread(round, count))
				.context("choosing a tile to sample")?;

			let sizes = source
				.tile_size_stream(coord.to_tile_bbox())
				.await
				.context("sampling a tile")?
				.to_vec()
				.await;

			// A coordinate with no tile yields nothing and counts as a sampled tile of zero bytes,
			// which is the truth: a pyramid is mostly holes over water, and an estimate that only
			// averaged the tiles that exist would be wrong by however much of it is sea.
			measured[index].tiles += 1;
			measured[index].bytes += sizes.iter().map(|(_, size)| u64::from(*size)).sum::<u64>();

			taken += 1;

			// **The cap is the only unconditional stop.** The budget is a floor to stop *at*, and it
			// may only end sampling once there is something worth stopping on: every level measured
			// rather than borrowed, and enough tiles that the average means something.
			let covered = measured.iter().all(|level| level.tiles > 0);
			if taken >= max_samples || (covered && taken >= min_samples && started.elapsed() >= budget) {
				break 'sampling;
			}
		}
		if !any {
			break;
		}
	}

	let sampled: u64 = measured.iter().map(|level| level.tiles).sum();
	let total: u64 = measured.iter().map(|level| level.bytes).sum();
	// Only reached when the very first sample overran the budget, which is a pipeline slow enough
	// that the caller needs the refusal more than the number.
	anyhow::ensure!(sampled > 0, "could not produce a single tile to measure");
	let overall = total as f64 / sampled as f64;

	let bytes = levels
		.iter()
		.zip(&measured)
		.map(|(bbox, level)| {
			let mean = if level.tiles > 0 {
				level.bytes as f64 / level.tiles as f64
			} else {
				// A level nothing reached, which now means only one thing: the cap ran out before the
				// first pass did, because the caller asked for fewer samples than the pyramid has
				// levels. Its own average is unknown, so it borrows the one across everything
				// sampled. The budget can no longer land here - see the loop above.
				overall
			};
			mean * bbox.count_tiles() as f64
		})
		.sum::<f64>();

	Ok(Estimate {
		tiles,
		bytes: bytes as u64,
		sampled: u32::try_from(sampled).unwrap_or(u32::MAX),
	})
}

/// Which tile to take from a level of `count` tiles, on round `round`.
///
/// **Spread deliberately, and the same way every time.** Sampling the first `n` tiles of a level
/// would measure one corner of the map; sampling at random would give the same export a different
/// estimate on every open, which reads as a broken number rather than an honest one.
///
/// So this walks the level in strides of roughly the golden ratio of its width. Choosing a stride
/// **coprime with the count** is what makes it a permutation: every tile is visited exactly once
/// before any is visited twice, and a level small enough to sample completely *is* sampled
/// completely. The obvious alternative - the fractional part of `round × φ`, scaled - spreads just
/// as evenly in the reals and collides once floored to an index: over four tiles it returns 0, 2, 0,
/// 1, measuring one tile twice and another never.
fn spread(round: u32, count: u64) -> u64 {
	// The fractional part of the golden ratio, which is what makes the gaps even.
	const RATIO: f64 = 0.618_033_988_749_894_9;

	let mut stride = ((count as f64 * RATIO) as u64).max(1);
	// Terminates at 1 in the worst case, which is coprime with everything.
	while gcd(stride, count) != 1 {
		stride -= 1;
	}
	// Widened because `round × stride` outgrows a `u64` long before the count does.
	u64::try_from(u128::from(round) * u128::from(stride) % u128::from(count)).unwrap_or(0)
}

/// Euclid's, for the coprimality [`spread`] rests on.
fn gcd(a: u64, b: u64) -> u64 {
	if b == 0 { a } else { gcd(b, a % b) }
}

/// One level's running total.
#[derive(Default)]
struct Measured {
	tiles: u64,
	bytes: u64,
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::vpl::Document;

	fn pipeline(vpl: &str) -> VPLPipeline {
		Document::parse(vpl).unwrap().to_pipeline()
	}

	/// The property the whole sampling scheme rests on: within one level, no tile is measured twice
	/// while another has not been measured at all.
	///
	/// A level of four tiles is the case that caught the first implementation, so the range starts
	/// low deliberately.
	#[test]
	fn every_tile_of_a_level_is_visited_before_any_is_revisited() {
		for count in 1..=64u64 {
			let visited: Vec<u64> = (0..count).map(|round| spread(round as u32, count)).collect();
			let mut sorted = visited.clone();
			sorted.sort_unstable();
			sorted.dedup();
			assert_eq!(
				sorted.len() as u64,
				count,
				"a level of {count} tiles repeats itself: {visited:?}"
			);
			assert!(
				visited.iter().all(|index| *index < count),
				"index out of range: {visited:?}"
			);
		}
	}

	/// The same export must not be estimated differently each time it is opened.
	#[test]
	fn the_sample_is_the_same_on_every_run() {
		let first: Vec<u64> = (0..20).map(|round| spread(round, 37)).collect();
		let again: Vec<u64> = (0..20).map(|round| spread(round, 37)).collect();
		assert_eq!(first, again);
	}

	/// A bounding box that selects nothing is an answer, not a failure - and not a division by zero.
	#[tokio::test]
	async fn an_empty_selection_costs_nothing() {
		let bounds = Bounds {
			bbox: None,
			min_zoom: Some(6),
			max_zoom: Some(6),
		};
		let estimate = estimate(
			pipeline("from_debug format=png | filter level_max=2"),
			Path::new("."),
			bounds,
			Compression::Source,
		)
		.await
		.unwrap();
		assert_eq!(estimate.tiles, 0);
		assert_eq!(estimate.bytes, 0);
		assert_eq!(estimate.sampled, 0);
	}

	/// **The estimate is exact when it can afford to be.** Twenty-one tiles is inside
	/// [`MAX_SAMPLES`], so every one of them is produced and the "estimate" is a measurement - which
	/// makes this a test of the extrapolation arithmetic against ground truth rather than a test
	/// that some number came back.
	#[tokio::test]
	async fn a_fully_sampled_export_is_measured_rather_than_estimated() {
		let vpl = "from_debug format=png";
		let bounds = Bounds {
			bbox: None,
			min_zoom: None,
			max_zoom: Some(2),
		};
		// 1 + 4 + 16, and the sampler visits each exactly once.
		let expected_tiles = 21;

		// A budget far past anything this needs, so the test is about the arithmetic rather than
		// about how loaded the machine is - a debug build renders a debug PNG slowly enough that
		// the shipped two seconds buys six tiles here, and six is not twenty-one.
		let estimate = sample(
			pipeline(vpl),
			Path::new("."),
			bounds,
			Compression::Source,
			Duration::from_secs(600),
			MIN_SAMPLES,
			64,
		)
		.await
		.unwrap();
		assert_eq!(estimate.tiles, expected_tiles);
		assert_eq!(estimate.sampled, expected_tiles as u32);

		// Ground truth: every tile the same bounded pipeline produces, added up.
		let runtime = versatiles::runtime::create_runtime_builder()
			.silent_progress(true)
			.build();
		let bounded = export::bounded(pipeline(vpl), bounds).unwrap();
		let source = crate::preview::build(&runtime, bounded, Path::new(".")).await.unwrap();
		let pyramid = source.tile_pyramid().await.unwrap();
		let mut actual = 0u64;
		for bbox in pyramid.to_iter_bboxes() {
			for (_, size) in source.tile_size_stream(bbox).await.unwrap().to_vec().await {
				actual += u64::from(size);
			}
		}

		assert_eq!(estimate.bytes, actual, "a complete sample must not be extrapolated");
	}

	/// **A spent budget does not stop before every level has been measured**, which is the half of
	/// this that used to be wrong: sampling ended wherever the clock fell, and on a slow pipeline
	/// that was part-way through the first pass, leaving most levels with no measurement and their
	/// bytes borrowed from the average of the ones that had one.
	///
	/// The floor is set to 1 so that coverage is the *only* thing keeping sampling alive - the count
	/// coming back as exactly one per level is what says so. z0-4 is five levels.
	#[tokio::test]
	async fn a_spent_budget_still_covers_every_level() {
		let bounds = Bounds {
			bbox: None,
			min_zoom: None,
			max_zoom: Some(4),
		};
		let estimate = sample(
			pipeline("from_debug format=png"),
			Path::new("."),
			bounds,
			Compression::Source,
			Duration::ZERO,
			1,
			64,
		)
		.await
		.unwrap();

		// 1 + 4 + 16 + 64 + 256: the count is arithmetic on the pyramid and never sampled, so it is
		// exact however little was measured.
		assert_eq!(estimate.tiles, 341);
		assert_eq!(estimate.sampled, 5, "one tile from each of z0-4, and then it may stop");
		assert!(estimate.bytes > 0);
	}

	/// And the other half: the floor outlives the budget too.
	///
	/// **The number the dialog was showing came from six tiles.** A pipeline slow enough to spend two
	/// seconds on a handful of them got an estimate extrapolated from that handful onto millions of
	/// tiles. Fifty is not a statistical guarantee; it is the point below which the answer should not
	/// be shown at all.
	#[tokio::test]
	async fn a_spent_budget_still_takes_the_floor() {
		let bounds = Bounds {
			bbox: None,
			min_zoom: None,
			max_zoom: Some(4),
		};
		let estimate = sample(
			pipeline("from_debug format=png"),
			Path::new("."),
			bounds,
			Compression::Source,
			Duration::ZERO,
			MIN_SAMPLES,
			64,
		)
		.await
		.unwrap();

		assert_eq!(estimate.tiles, 341);
		assert_eq!(
			estimate.sampled, MIN_SAMPLES,
			"a spent budget stops at the floor, not before it"
		);
	}

	/// The sample count is capped as well as timed, so a fast pipeline does not spend the whole
	/// budget buying precision nobody can read.
	///
	/// **The cap is the one stop with no conditions on it.** Asked for fewer samples than the pyramid
	/// has levels, sampling stops short of covering them - which is why the fallback to the overall
	/// average is still there to catch it.
	#[tokio::test]
	async fn the_sample_count_is_capped() {
		let bounds = Bounds {
			bbox: None,
			min_zoom: None,
			max_zoom: Some(6),
		};
		let estimate = sample(
			pipeline("from_debug format=png"),
			Path::new("."),
			bounds,
			Compression::Source,
			Duration::from_secs(600),
			MIN_SAMPLES,
			8,
		)
		.await
		.unwrap();
		assert_eq!(
			estimate.sampled, 8,
			"the cap wins over the floor, and over covering the levels"
		);
		assert!(estimate.tiles > 5000, "the cap must not change what is being estimated");
	}

	/// A pyramid too large to write is refused here, where the zoom field that fixes it is, rather
	/// than after a filename has been chosen. The wording is `export`'s, so there is one refusal.
	#[tokio::test]
	async fn an_unbounded_pyramid_is_refused_with_the_export_s_own_words() {
		let error = estimate(
			pipeline("from_debug format=png"),
			Path::new("."),
			Bounds::default(),
			Compression::Source,
		)
		.await
		.unwrap_err();
		let message = format!("{error:#}");
		assert!(message.contains("Set a maximum zoom"), "{message}");
	}
}
