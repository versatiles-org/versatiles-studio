//! Job runner — long operations with progress, cancellation and a log (E7).
//!
//! Conversions run for minutes to hours, so this exists before any export feature, not after.
//!
//! The core knows nothing about Tauri Channels. It emits [`JobEvent`]s through a plain callback;
//! `src-tauri` adapts that to a Channel at the boundary ([Q3]). That is what keeps the job runner
//! testable with no Tauri runtime — and what would let a CLI or a test drive the same code.
//!
//! [Q3]: ../../../docs/decisions.md

use serde::Serialize;
use std::sync::{
	Arc,
	atomic::{AtomicBool, Ordering},
};

/// Identifies a job for the lifetime of the process.
// `u32` rather than `u64`: a counter of jobs in one session, and it crosses to the webview,
// where specta will not emit a 64-bit integer as a plain number (see `src-tauri/src/bindings.rs`).
pub type JobId = u32;

/// Everything a running job can tell the outside world.
///
/// `Serialize` so the boundary can forward it verbatim; nothing here is Tauri-specific.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub enum JobEvent {
	/// Fractional progress in `0.0..=1.0`, plus what is happening right now.
	Progress {
		id: JobId,
		#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
		fraction: f64,
		message: String,
	},
	/// A line for the job log. Failures at minute 40 have to be able to say why.
	Log { id: JobId, line: String },
	/// The job finished on its own.
	Finished { id: JobId },
	/// The job stopped because it was cancelled.
	Cancelled { id: JobId },
	/// The job stopped because it failed.
	Failed { id: JobId, error: String },
}

/// Where job events go. `src-tauri` passes a closure that writes to a Tauri Channel.
pub type EventSink = Arc<dyn Fn(JobEvent) + Send + Sync>;

/// A cancellation flag shared with the running job.
///
/// Cheap to clone and safe to poll from a worker loop.
#[derive(Debug, Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
	#[must_use]
	pub fn new() -> Self {
		Self::default()
	}

	/// Asks the job to stop. The job decides when it is safe to do so.
	pub fn cancel(&self) {
		self.0.store(true, Ordering::Relaxed);
	}

	#[must_use]
	pub fn is_cancelled(&self) -> bool {
		self.0.load(Ordering::Relaxed)
	}
}

/// The handle a running job uses to report back.
pub struct JobHandle {
	id: JobId,
	sink: EventSink,
	cancel: CancelToken,
}

impl JobHandle {
	#[must_use]
	pub fn new(id: JobId, sink: EventSink, cancel: CancelToken) -> Self {
		Self { id, sink, cancel }
	}

	#[must_use]
	pub fn id(&self) -> JobId {
		self.id
	}

	#[must_use]
	pub fn is_cancelled(&self) -> bool {
		self.cancel.is_cancelled()
	}

	pub fn progress(&self, fraction: f64, message: impl Into<String>) {
		(self.sink)(JobEvent::Progress {
			id: self.id,
			fraction: fraction.clamp(0.0, 1.0),
			message: message.into(),
		});
	}

	pub fn log(&self, line: impl Into<String>) {
		(self.sink)(JobEvent::Log {
			id: self.id,
			line: line.into(),
		});
	}

	pub fn finished(&self) {
		(self.sink)(JobEvent::Finished { id: self.id });
	}

	pub fn cancelled(&self) {
		(self.sink)(JobEvent::Cancelled { id: self.id });
	}

	pub fn failed(&self, error: impl Into<String>) {
		(self.sink)(JobEvent::Failed {
			id: self.id,
			error: error.into(),
		});
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::sync::Mutex;

	fn collector() -> (EventSink, Arc<Mutex<Vec<JobEvent>>>) {
		let events = Arc::new(Mutex::new(Vec::new()));
		let sink_events = Arc::clone(&events);
		let sink: EventSink = Arc::new(move |e| sink_events.lock().unwrap().push(e));
		(sink, events)
	}

	#[test]
	fn reports_progress_and_completion() {
		let (sink, events) = collector();
		let job = JobHandle::new(1, sink, CancelToken::new());

		job.progress(0.5, "halfway");
		job.log("wrote 1000 tiles");
		job.finished();

		let events = events.lock().unwrap();
		assert_eq!(events.len(), 3);
		assert!(matches!(events[0], JobEvent::Progress { fraction, .. } if fraction == 0.5));
		assert!(matches!(events[2], JobEvent::Finished { id: 1 }));
	}

	#[test]
	fn progress_is_clamped() {
		let (sink, events) = collector();
		let job = JobHandle::new(7, sink, CancelToken::new());

		job.progress(-1.0, "before the start");
		job.progress(99.0, "past the end");

		let events = events.lock().unwrap();
		assert!(matches!(events[0], JobEvent::Progress { fraction, .. } if fraction == 0.0));
		assert!(matches!(events[1], JobEvent::Progress { fraction, .. } if fraction == 1.0));
	}

	#[test]
	fn cancellation_is_visible_to_the_job() {
		let cancel = CancelToken::new();
		let (sink, _) = collector();
		let job = JobHandle::new(2, sink, cancel.clone());

		assert!(!job.is_cancelled());
		cancel.cancel();
		assert!(job.is_cancelled(), "the token is shared, not copied");
	}
}
