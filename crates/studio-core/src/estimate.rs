//! What an export will cost, measured before it is started (S3.7, C6).
//!
//! "~40 min, ~2.3 GB" is the whole feature. An export is the one thing Studio does that can take
//! hours and fill a disk, and until now the only way to find out which kind it was going to be was
//! to start it and watch. The number does not have to be exact; it has to separate a coffee break
//! from an overnight run, before the decision rather than after it.
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
//! [`export::bounded`](crate::export::bounded) rather than reimplemented here, so the tiles measured
//! are the tiles written. Two ways of narrowing a pipeline would agree on the day they were written
//! and quietly stop agreeing later.

use crate::export::{self, Bounds};
use anyhow::{Context, Result};
use std::path::Path;
use std::time::{Duration, Instant};
use versatiles_core::TileBBox;
use versatiles_pipeline::VPLPipeline;

/// How long sampling may take before the estimate is made from what it has.
///
/// An estimate is something a dialog waits on, so its cost is a UI decision rather than a
/// statistical one: two seconds is long enough to look like work and short enough not to feel
/// broken. Running over budget would also be self-defeating - nobody waits a minute to be told a
/// job takes an hour.
pub const BUDGET: Duration = Duration::from_secs(2);

/// The most tiles to produce, however fast they come.
///
/// The budget alone would let a trivial pipeline sample tens of thousands of tiles for an accuracy
/// nobody can see: the answer is rounded to "~2.3 GB" either way. This is where the remaining time
/// is given back instead.
pub const MAX_SAMPLES: u32 = 64;

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
	/// Seconds the write is expected to take.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub seconds: f64,
	/// How many tiles were actually produced to arrive at the two numbers above.
	///
	/// Reported because it is the honest measure of how much the estimate is worth, and the only
	/// one the webview could not work out for itself. Four samples of a slow pipeline and sixty of
	/// a fast one deserve different wording.
	pub sampled: u32,
}

/// Runs `pipeline` over a sample of the tiles `bounds` selects, and multiplies up.
///
/// `dir` is what relative paths in the VPL resolve against, as everywhere else.
pub async fn estimate(pipeline: VPLPipeline, dir: &Path, bounds: Bounds) -> Result<Estimate> {
	sample(pipeline, dir, bounds, BUDGET, MAX_SAMPLES).await
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
	budget: Duration,
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

	let pyramid = source.tile_pyramid().await.context("reading the tile pyramid")?;
	let tiles = export::writable_count(&pyramid)?;

	// An empty selection is a real answer rather than a division by zero - a bounding box over open
	// ocean, or a zoom range the source does not reach.
	if tiles == 0 {
		return Ok(Estimate {
			tiles: 0,
			bytes: 0,
			seconds: 0.0,
			sampled: 0,
		});
	}

	let levels: Vec<TileBBox> = pyramid.to_iter_bboxes().filter(|bbox| bbox.count_tiles() > 0).collect();
	let mut measured: Vec<Measured> = levels.iter().map(|_| Measured::default()).collect();
	let mut durations: Vec<Duration> = Vec::new();

	// **Deepest level first, one tile per level per round.** Both halves matter. Round-robin means
	// every level is represented after the first pass, so a budget that runs out early still leaves
	// an estimate that saw the whole range; deepest-first means that when it runs out *during* a
	// pass, the tiles it missed are the ones that matter least.
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

			let before = Instant::now();
			let sizes = source
				.tile_size_stream(coord.to_tile_bbox())
				.await
				.context("sampling a tile")?
				.to_vec()
				.await;
			durations.push(before.elapsed());

			// A coordinate with no tile yields nothing and counts as a sampled tile of zero bytes,
			// which is the truth: a pyramid is mostly holes over water, and an estimate that only
			// averaged the tiles that exist would be wrong by however much of it is sea.
			measured[index].tiles += 1;
			measured[index].bytes += sizes.iter().map(|(_, size)| u64::from(*size)).sum::<u64>();

			taken += 1;
			if taken >= max_samples || started.elapsed() >= budget {
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
				// A level the budget never reached. Its own average is unknown, so it borrows the
				// one across everything sampled - wrong in detail, and it is a level that holds a
				// quarter of what the level below it does, three levels above where the budget ran
				// out.
				overall
			};
			mean * bbox.count_tiles() as f64
		})
		.sum::<f64>();

	Ok(Estimate {
		tiles,
		bytes: bytes as u64,
		seconds: per_tile(&durations).as_secs_f64() * tiles as f64,
		sampled: u32::try_from(sampled).unwrap_or(u32::MAX),
	})
}

/// What one tile costs, from the times it took to make the samples.
///
/// **The first is thrown away when there is anything else.** A pipeline opens its sources lazily, so
/// the first tile pays for reading a container's index - or an HTTP round trip to a remote one -
/// which the second and the millionth do not. Charging that to every tile in the export turns a
/// remote source into an estimate of days.
fn per_tile(durations: &[Duration]) -> Duration {
	let timed = if durations.len() > 1 {
		&durations[1..]
	} else {
		durations
	};
	timed.iter().sum::<Duration>() / u32::try_from(timed.len().max(1)).unwrap_or(1)
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
		let estimate = sample(pipeline(vpl), Path::new("."), bounds, Duration::from_secs(600), 64)
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

	/// **The budget is a promise to the dialog waiting on it.** A pipeline can be arbitrarily slow
	/// per tile, so the guarantee cannot be about tiles - it has to be that sampling stops. An
	/// unmeasurably small budget still yields an answer, from however little it managed.
	#[tokio::test]
	async fn a_spent_budget_still_answers() {
		let bounds = Bounds {
			bbox: None,
			min_zoom: None,
			max_zoom: Some(4),
		};
		let estimate = sample(
			pipeline("from_debug format=png"),
			Path::new("."),
			bounds,
			Duration::ZERO,
			64,
		)
		.await
		.unwrap();

		// 1 + 4 + 16 + 64 + 256: the count is arithmetic on the pyramid and never sampled, so it is
		// exact however little was measured.
		assert_eq!(estimate.tiles, 341);
		assert_eq!(
			estimate.sampled, 1,
			"a zero budget stops after the first tile, not before it"
		);
		assert!(estimate.bytes > 0, "one sample is still enough to extrapolate from");
	}

	/// The sample count is capped as well as timed, so a fast pipeline does not spend the whole
	/// budget buying precision nobody can read.
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
			Duration::from_secs(600),
			8,
		)
		.await
		.unwrap();
		assert_eq!(estimate.sampled, 8);
		assert!(estimate.tiles > 5000, "the cap must not change what is being estimated");
	}

	/// A pyramid too large to write is refused here, where the zoom field that fixes it is, rather
	/// than after a filename has been chosen. The wording is `export`'s, so there is one refusal.
	#[tokio::test]
	async fn an_unbounded_pyramid_is_refused_with_the_export_s_own_words() {
		let error = estimate(pipeline("from_debug format=png"), Path::new("."), Bounds::default())
			.await
			.unwrap_err();
		let message = format!("{error:#}");
		assert!(message.contains("Set a maximum zoom"), "{message}");
	}

	/// The measured duration is per tile, not per sample-run - a slow first tile is the pipeline
	/// opening its sources and must not be charged to every tile in the export.
	#[test]
	fn the_first_tile_pays_for_opening_the_sources_and_the_rest_do_not() {
		let durations = [
			Duration::from_millis(500),
			Duration::from_millis(10),
			Duration::from_millis(10),
		];
		assert_eq!(per_tile(&durations), Duration::from_millis(10));
		// With nothing to compare it against, the one sample is all there is to go on.
		assert_eq!(per_tile(&durations[..1]), Duration::from_millis(500));
	}
}
