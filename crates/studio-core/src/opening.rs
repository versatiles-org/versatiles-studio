//! How far opening a container has got, for the status bar (#21).
//!
//! Opening a large remote PMTiles file waits on two things, both inside versatiles-rs: downloading
//! the tile index ([vt#304]) and computing the tile pyramid from it ([vt#305]). Both report progress
//! on the runtime's event bus, as a writer does during an export, and this forwards it.
//!
//! **Its own runtime, not the server's.** The server's runtime is serving tiles and building
//! previews while a container opens, and its bus carries their events too. A progress event says
//! nothing about which open it belongs to, so the only reliable way to know is a bus with nothing
//! else on it. Exports do the same, for the same reason (see [`crate::export::write`]). A second
//! reason: upstream's `EventBus` has no way to unsubscribe, so a listener per open on the shared
//! runtime would never be removed.
//!
//! **The reader keeps that runtime for its whole life**, which outlasts the open: it stays mounted
//! and serves tiles. So the listener is switched off when the [`Opening`] is dropped, rather than
//! forwarding to a status bar that has long moved on.
//!
//! [vt#304]: https://github.com/versatiles-org/versatiles-rs/issues/304
//! [vt#305]: https://github.com/versatiles-org/versatiles-rs/issues/305

use serde::Serialize;
use std::sync::{
	Arc, Mutex,
	atomic::{AtomicBool, Ordering},
};
use versatiles_container::{Event, TilesRuntime};

/// What an open is doing, and how far along it is.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct OpenProgress {
	/// Upstream's own words for the step, such as "reading the tile index".
	pub step: String,
	/// From 0 to 1, or `None` when the step has no known total, as MBTiles' pyramid does not.
	pub fraction: Option<f64>,
}

/// Where an open's progress goes.
pub type ProgressSink = Arc<dyn Fn(OpenProgress) + Send + Sync>;

/// A runtime for one open, whose progress goes to one sink while this is alive.
pub struct Opening {
	runtime: TilesRuntime,
	live: Arc<AtomicBool>,
}

impl Opening {
	/// A fresh runtime, configured as the server's is, that reports to `sink`.
	///
	/// `silent_progress`, because the default draws an ANSI progress bar on stdout, which in a
	/// desktop application is escape codes in a log nobody reads. The events arrive either way.
	#[must_use]
	pub fn new(sink: ProgressSink) -> Self {
		let runtime = versatiles::runtime::create_runtime_builder()
			.silent_progress(true)
			.build();
		let live = Arc::new(AtomicBool::new(true));
		let forwarder = Forwarder {
			sink,
			live: Arc::clone(&live),
			last: Mutex::new(None),
		};
		runtime.events().subscribe(move |event| {
			if let Event::Progress { data } = event {
				forwarder.forward(&data.message, data.position, data.total);
			}
		});
		Self { runtime, live }
	}

	/// The runtime to open the container with.
	#[must_use]
	pub fn runtime(&self) -> &TilesRuntime {
		&self.runtime
	}
}

impl Drop for Opening {
	fn drop(&mut self) {
		self.live.store(false, Ordering::Relaxed);
	}
}

/// Turns upstream's progress events into the few the webview needs.
struct Forwarder {
	sink: ProgressSink,
	live: Arc<AtomicBool>,
	/// The step and whole percentage last sent.
	last: Mutex<Option<(String, Option<u8>)>>,
}

impl Forwarder {
	/// Sends an update when the step or its whole percentage changes, and drops the rest.
	///
	/// Upstream emits up to a hundred events a second. Each one sent here crosses to the webview and
	/// redraws the bar, and a bar one pixel wide per percent has no use for more than a hundred per
	/// step.
	fn forward(&self, step: &str, position: u64, total: u64) {
		if !self.live.load(Ordering::Relaxed) {
			return;
		}
		// A total of zero is upstream's "cannot say", not "nothing to do".
		#[allow(clippy::cast_precision_loss)]
		let fraction = (total > 0).then(|| (position as f64 / total as f64).clamp(0.0, 1.0));
		#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
		let percent = fraction.map(|f| (f * 100.0).floor() as u8);

		{
			let mut last = self.last.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
			if last.as_ref().is_some_and(|(s, p)| s == step && *p == percent) {
				return;
			}
			*last = Some((step.to_string(), percent));
		}
		(self.sink)(OpenProgress {
			step: step.to_string(),
			fraction,
		});
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn recording() -> (ProgressSink, Arc<Mutex<Vec<OpenProgress>>>) {
		let seen = Arc::new(Mutex::new(Vec::new()));
		let into = Arc::clone(&seen);
		let sink: ProgressSink = Arc::new(move |progress| into.lock().unwrap().push(progress));
		(sink, seen)
	}

	#[test]
	fn progress_arrives_once_per_whole_percent() {
		let (sink, seen) = recording();
		let opening = Opening::new(sink);

		let progress = opening.runtime().create_progress("reading the tile index", 1000);
		for _ in 0..1000 {
			progress.inc(1);
		}
		progress.finish();

		let seen = seen.lock().unwrap();
		assert!(seen.len() <= 101, "{} updates for 100 percent", seen.len());
		assert!(seen.iter().all(|p| p.step == "reading the tile index"));
		assert_eq!(seen.last().unwrap().fraction, Some(1.0));
		let fractions: Vec<f64> = seen.iter().filter_map(|p| p.fraction).collect();
		assert!(fractions.is_sorted(), "{fractions:?}");
	}

	/// MBTiles counts its pyramid with no total. That is a step without a percentage, said once.
	#[test]
	fn a_step_with_no_total_has_no_fraction() {
		let (sink, seen) = recording();
		let opening = Opening::new(sink);

		let progress = opening.runtime().create_progress("computing the tile pyramid", 0);
		progress.inc(500);
		progress.inc(500);
		progress.finish();

		let seen = seen.lock().unwrap();
		assert_eq!(
			*seen,
			vec![OpenProgress {
				step: "computing the tile pyramid".to_string(),
				fraction: None
			}]
		);
	}

	#[test]
	fn a_new_step_is_sent_even_at_the_same_percentage() {
		let (sink, seen) = recording();
		let opening = Opening::new(sink);

		opening.runtime().create_progress("reading the tile index", 10).finish();
		opening
			.runtime()
			.create_progress("computing the tile pyramid", 10)
			.finish();

		let steps: Vec<String> = seen.lock().unwrap().iter().map(|p| p.step.clone()).collect();
		assert!(steps.contains(&"reading the tile index".to_string()), "{steps:?}");
		assert!(steps.contains(&"computing the tile pyramid".to_string()), "{steps:?}");
	}

	/// The reader keeps the runtime after the open, so its later events must not reach a status bar
	/// that is saying something else by then.
	#[test]
	fn nothing_is_sent_once_the_open_is_over() {
		let (sink, seen) = recording();
		let opening = Opening::new(sink);
		let runtime = opening.runtime().clone();
		drop(opening);

		runtime.create_progress("computing the tile pyramid", 10).finish();

		assert!(seen.lock().unwrap().is_empty());
	}

	/// The real thing: a PMTiles file reports its pyramid while it is described.
	#[tokio::test]
	async fn opening_a_pmtiles_file_reports_its_pyramid() -> anyhow::Result<()> {
		let Some(path) = crate::analysis::tests::sample_container("berlin.pmtiles") else {
			eprintln!("skipping: set STUDIO_TESTDATA to a directory of sample containers");
			return Ok(());
		};
		let (sink, seen) = recording();
		let opening = Opening::new(sink);

		crate::analysis::open(opening.runtime(), path.to_str().unwrap()).await?;

		let seen = seen.lock().unwrap();
		assert!(
			seen
				.iter()
				.any(|p| p.step == "computing the tile pyramid" && p.fraction == Some(1.0)),
			"{seen:?}"
		);
		Ok(())
	}
}
