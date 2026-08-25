//! Job runner — long operations with progress, cancellation and a log (E7, S3.1).
//!
//! Conversions run for minutes to hours, so this exists before any export feature, not after. The
//! status bar ([Q24]) is its face: what is running, how far along, and a log to expand when it
//! fails at minute forty.
//!
//! The core knows nothing about Tauri Channels. It emits [`JobEvent`]s through a plain callback;
//! `src-tauri` adapts that to a Channel at the boundary ([Q3]). That is what keeps the job runner
//! testable with no Tauri runtime — and what would let a CLI or a test drive the same code.
//!
//! **Two lanes, because "the queue" is two different questions.** A conversion and a preview want
//! opposite things from a runner: the conversion wants to be left alone until it finishes, the
//! preview wants to be replaced the moment it is out of date. One FIFO queue serving both would
//! make a preview wait behind a forty-minute export, which is the opposite of M4. See [`Lane`].
//!
//! **One runner, a list per project** ([S7.3](../../../docs/scope-release-3.md), [Q48]). Every job
//! carries the scope that submitted it — a window — and three things follow from it: a window is
//! shown its own project's work and not the machine's, [`Lane::Latest`] supersedes only within a
//! scope, and history is pruned per scope so a busy project cannot age out a quiet one's.
//!
//! **[`Lane::Queued`] deliberately does not follow.** Its argument is about the machine: conversions
//! compete for the same disk and the same cores, so two at once finish later than the same two in
//! sequence — and that is as true across two projects as within one. It serialises application-wide.
//!
//! [Q48]: ../../../docs/decisions.md
//!
//! [Q3]: ../../../docs/decisions.md
//! [Q24]: ../../../docs/decisions.md

use anyhow::Result;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::{
	Arc, Mutex,
	atomic::{AtomicBool, Ordering},
};
use std::time::Instant;

/// Identifies a job for the lifetime of the process.
// `u32` rather than `u64`: a counter of jobs in one session, and it crosses to the webview,
// where specta will not emit a 64-bit integer as a plain number (see `src-tauri/src/bindings.rs`).
pub type JobId = u32;

/// How many finished jobs are kept for the log panel to show.
///
/// The list is history, not a record — a session that converts a hundred files does not need the
/// first one's progress messages, and an unbounded `Vec` in a process that runs for days is a leak
/// with a nicer name.
const HISTORY: usize = 50;

/// How many log lines are kept per job.
///
/// A conversion logging per tile would otherwise hold a million strings. The **last** lines are the
/// ones kept: a failure explains itself at the end, not the beginning.
const LOG_LINES: usize = 1000;

/// How a job relates to the ones already in flight.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub enum Lane {
	/// One at a time, in submission order.
	///
	/// Conversions compete for the same disk and the same cores; two at once finish later than the
	/// same two in sequence, and report progress that means nothing while they do it.
	Queued,
	/// Newest wins — submitting cancels whatever this lane was already running.
	///
	/// For work whose answer stops mattering the moment it is asked again: a preview of a pipeline
	/// that has since been edited is not a result anybody will look at, it is a machine still
	/// warming up over a stale question.
	Latest,
}

/// Where a job is in its life.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub enum JobState {
	/// Submitted, waiting for the lane to free up. Only [`Lane::Queued`] jobs are ever here.
	Queued,
	Running,
	Finished,
	Cancelled,
	Failed {
		error: String,
	},
}

impl JobState {
	/// Whether the job may still do something. The two non-terminal states, named once.
	#[must_use]
	pub fn is_active(&self) -> bool {
		matches!(self, Self::Queued | Self::Running)
	}
}

/// A job as the status bar lists it.
///
/// The log is deliberately **not** here: listing jobs happens on every reload, and shipping a
/// thousand lines per job to draw one progress bar is a cost paid for something nobody is looking
/// at. [`Jobs::log`] fetches it when a row is expanded.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Job {
	pub id: JobId,
	/// What to call it in the bar — "Building preview", "Converting berlin.mbtiles".
	pub label: String,
	pub lane: Lane,
	pub state: JobState,
	/// `0.0..=1.0`, or `None` when the job cannot say — which is honest more often than not.
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
	pub fraction: Option<f64>,
	/// How many units are done and how many there are, when the job counts in units at all.
	///
	/// A fraction alone cannot say how *fast* anything is going: "43% per minute" is not a speed
	/// anybody recognises. These are what make "12,400 tiles/s" possible, and the runtime already
	/// reports them — they used to be divided into a fraction and thrown away.
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
	pub done: Option<u64>,
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
	pub total: Option<u64>,
	/// Units per second, averaged since the first counted update.
	///
	/// Averaged rather than instantaneous, because an ETA that jumps between "2 minutes" and "40
	/// minutes" every second is worse than no ETA. Anchored at the first update rather than at
	/// submission, so the time spent opening sources before any tile moved is not counted as slow
	/// tiles.
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
	pub rate: Option<f64>,
	/// Seconds remaining at that rate, or `None` until there is enough to say.
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
	pub eta_seconds: Option<f64>,
	/// What is happening right now. Empty until the job says something.
	pub message: String,
	/// How many lines the log holds, so a row can offer to expand only when there is something in
	/// it.
	#[cfg_attr(feature = "bindings", specta(type = u32))]
	pub log_lines: usize,
}

/// Everything a running job can tell the outside world.
///
/// `Serialize` so the boundary can forward it verbatim; nothing here is Tauri-specific.
///
/// The webview builds its list from these rather than polling: a progress bar driven by a `list()`
/// call every 200ms is both slower to update and more work than being told.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub enum JobEvent {
	/// A job exists. Carries the whole record, so a listener never has to ask what it just heard
	/// about.
	Added { job: Job },
	/// It left the queue and started running.
	Started { id: JobId },
	/// Fractional progress in `0.0..=1.0` — or `None`, plus what is happening right now.
	Progress {
		id: JobId,
		#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
		fraction: Option<f64>,
		/// Absolute counts when the job has them. The runner turns successive values into a rate
		/// and an ETA; a listener never has to keep its own history to know how fast this is going.
		#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
		done: Option<u64>,
		#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
		total: Option<u64>,
		message: String,
		/// How fast it is going and how long is left — **filled in by the runner on the way out**,
		/// the same as `log_lines` below.
		///
		/// The reporter cannot know either: both are derived from this update *and the ones before
		/// it*, which only the registry has. Left off the event, they were computed on every update
		/// and never left the core — the list a window takes when it subscribes carried them, and
		/// nothing after that did, so a job that started while you were watching showed a bar and a
		/// message and never a speed.
		#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
		rate: Option<f64>,
		#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
		eta_seconds: Option<f64>,
	},
	/// A line for the job log. Failures at minute forty have to be able to say why.
	Log {
		id: JobId,
		line: String,
		/// How many lines the log holds *after* this one — filled in by the runner on the way out.
		///
		/// Carried rather than counted by the listener, because the log is capped: a mirror that
		/// incremented its own counter would keep climbing past [`LOG_LINES`] and claim a size the
		/// log does not have.
		#[cfg_attr(feature = "bindings", specta(type = u32))]
		log_lines: usize,
	},
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
///
/// It reports *progress*; it does not report that it ended. The runner owns the terminal
/// transition, because a job that is aborted mid-await never gets to say anything — and a state
/// machine where some endings are announced by the job and others by the runner has two places to
/// be wrong.
pub struct JobHandle {
	reporter: Reporter,
	cancel: CancelToken,
}

/// The reporting half of a [`JobHandle`], on its own.
///
/// A [`JobHandle`] is the job's, held for as long as the work runs. Some work wants to report from
/// somewhere else — `versatiles_container`'s event bus takes a `Fn(&Event) + Send + Sync + 'static`
/// callback, which cannot borrow the handle — so this is the part that can be cloned and handed
/// over. Cancellation deliberately stays behind: whether to stop is the job's decision, not a
/// listener's.
#[derive(Clone)]
pub struct Reporter {
	id: JobId,
	sink: EventSink,
}

impl JobHandle {
	#[must_use]
	pub fn new(id: JobId, sink: EventSink, cancel: CancelToken) -> Self {
		Self {
			reporter: Reporter { id, sink },
			cancel,
		}
	}

	#[must_use]
	pub fn id(&self) -> JobId {
		self.reporter.id
	}

	/// A cloneable handle to the reporting half, for a callback that cannot borrow this one.
	#[must_use]
	pub fn reporter(&self) -> Reporter {
		self.reporter.clone()
	}

	/// Whether the job has been asked to stop.
	///
	/// Work that spends its time inside `spawn_blocking` has to poll this — dropping a future does
	/// nothing to a thread that is busy encoding tiles.
	#[must_use]
	pub fn is_cancelled(&self) -> bool {
		self.cancel.is_cancelled()
	}

	/// Reports how far along the job is.
	pub fn progress(&self, fraction: f64, message: impl Into<String>) {
		self.reporter.progress(fraction, message);
	}

	/// Reports progress the job can count — what a speed and an ETA are made of.
	pub fn counted(&self, done: u64, total: u64, message: impl Into<String>) {
		self.reporter.counted(done, total, message);
	}

	/// Reports what the job is doing when it cannot say how far along it is.
	pub fn working(&self, message: impl Into<String>) {
		self.reporter.working(message);
	}

	pub fn log(&self, line: impl Into<String>) {
		self.reporter.log(line);
	}
}

impl Reporter {
	/// Reports how far along the job is.
	pub fn progress(&self, fraction: f64, message: impl Into<String>) {
		self.emit(Some(fraction.clamp(0.0, 1.0)), message);
	}

	/// Reports progress the job can count, which is what a speed and an ETA are made of.
	///
	/// `total` of zero is treated as "cannot say": a denominator nobody knows yet is not a job that
	/// is 0% done, and dividing by it would be worse than admitting it.
	pub fn counted(&self, done: u64, total: u64, message: impl Into<String>) {
		if total == 0 {
			self.working(message);
			return;
		}
		#[allow(clippy::cast_precision_loss)]
		let fraction = (done as f64 / total as f64).clamp(0.0, 1.0);
		self.send(Some(fraction), Some(done), Some(total), message);
	}

	/// Reports what the job is doing when it cannot say how far along it is.
	///
	/// Separate from [`progress`](Self::progress) so that not knowing is something a caller states,
	/// rather than something it fakes with a number it made up.
	pub fn working(&self, message: impl Into<String>) {
		self.emit(None, message);
	}

	fn emit(&self, fraction: Option<f64>, message: impl Into<String>) {
		self.send(fraction, None, None, message);
	}

	fn send(&self, fraction: Option<f64>, done: Option<u64>, total: Option<u64>, message: impl Into<String>) {
		(self.sink)(JobEvent::Progress {
			id: self.id,
			fraction,
			done,
			total,
			message: message.into(),
			// Corrected by the runner, which is the only thing that can see the updates before this
			// one. Same arrangement as `log_lines` below.
			rate: None,
			eta_seconds: None,
		});
	}

	pub fn log(&self, line: impl Into<String>) {
		(self.sink)(JobEvent::Log {
			id: self.id,
			line: line.into(),
			// Corrected by the runner, which is the only thing that knows the log's real size.
			log_lines: 0,
		});
	}
}

/// The work a job does: given a handle to report through, produce a result.
///
/// Boxed because the registry holds queued work of many different shapes in one `VecDeque`.
type Work = Box<dyn FnOnce(JobHandle) -> Pin<Box<dyn Future<Output = Result<()>> + Send>> + Send>;

struct Entry {
	job: Job,
	/// Whose job this is — a window label. Not on [`Job`]: it decides who is *shown* the job and
	/// what it can supersede, and a listener that is only ever sent its own has no use for it.
	scope: String,
	log: VecDeque<String>,
	cancel: CancelToken,
	/// Present while running, so cancelling can drop the work at its next await point rather than
	/// waiting for it to notice.
	task: Option<tokio::task::JoinHandle<()>>,
	/// When the job was first seen counting, and at what count — the origin every rate is measured
	/// from. Kept out of [`Job`] because it is bookkeeping rather than something to show, and an
	/// `Instant` does not cross a serialisation boundary anyway.
	anchor: Option<(Instant, u64)>,
}

impl Entry {
	/// Works out how fast the job is going and how long is left, from the counts it has reported.
	///
	/// **Averaged from a fixed anchor**, not from the previous sample. A rate taken between two
	/// consecutive updates swings with every slow tile and every fast one, and an ETA computed from
	/// it alternates between two minutes and forty — which is less useful than saying nothing. The
	/// anchor is the *first* counted update rather than the moment of submission, so time spent
	/// opening sources before a single tile moved is not averaged in as slow work.
	///
	/// Silent until there is something to say: no anchor yet, no time elapsed, or nothing done
	/// since the anchor all leave the rate `None` rather than reporting zero or infinity.
	fn rate_and_eta(&mut self, now: Instant) {
		let (Some(done), Some(total)) = (self.job.done, self.job.total) else {
			self.job.rate = None;
			self.job.eta_seconds = None;
			return;
		};

		let (since, from) = *self.anchor.get_or_insert((now, done));
		let elapsed = now.duration_since(since).as_secs_f64();
		let moved = done.saturating_sub(from);

		if elapsed <= 0.0 || moved == 0 {
			return;
		}

		#[allow(clippy::cast_precision_loss)]
		let rate = moved as f64 / elapsed;
		self.job.rate = Some(rate);
		#[allow(clippy::cast_precision_loss)]
		let remaining = total.saturating_sub(done) as f64;
		self.job.eta_seconds = Some(remaining / rate);
	}
}

#[derive(Default)]
struct Registry {
	next_id: JobId,
	/// Oldest first, so the newest is what the bar shows and the oldest is what pruning drops.
	entries: Vec<Entry>,
	/// Work submitted to [`Lane::Queued`] that has not started.
	pending: VecDeque<(JobId, Work)>,
	/// Which [`Lane::Queued`] job holds the lane. `None` means the next submission starts at once.
	running_queued: Option<JobId>,
}

impl Registry {
	fn entry(&mut self, id: JobId) -> Option<&mut Entry> {
		self.entries.iter_mut().find(|entry| entry.job.id == id)
	}
}

/// The runner. Cheap to clone — every clone is the same registry.
#[derive(Clone, Default)]
pub struct Jobs {
	inner: Arc<Inner>,
}

#[derive(Default)]
struct Inner {
	registry: Mutex<Registry>,
	/// Where each scope's events go, installed by the boundary once that window has a channel.
	///
	/// Absent before that, and replaced when a reload brings a new channel: events for a job that
	/// started before the window came back are dropped, and the list the webview asks for on startup
	/// is what puts it back in the picture.
	sinks: Mutex<HashMap<String, EventSink>>,
}

impl Jobs {
	#[must_use]
	pub fn new() -> Self {
		Self::default()
	}

	/// Points one scope's job events at a sink. Replaces that scope's previous one — a reload gets
	/// a new channel for the same window.
	pub fn set_sink(&self, scope: impl Into<String>, sink: EventSink) {
		self.inner.sinks.lock().unwrap().insert(scope.into(), sink);
	}

	/// Stops delivering to a scope — for a window that has closed.
	///
	/// The jobs themselves are left alone. An export outlives the window that started it by design
	/// ([Q16]), and cancelling someone's conversion because they closed a window is not this call's
	/// decision to make.
	pub fn forget(&self, scope: &str) {
		self.inner.sinks.lock().unwrap().remove(scope);
	}

	/// Submits a job and returns its id immediately; the work runs in the background.
	///
	/// Needs a Tokio runtime, which is what actually runs the work.
	pub fn submit<F, Fut>(&self, label: impl Into<String>, lane: Lane, scope: impl Into<String>, work: F) -> JobId
	where
		F: FnOnce(JobHandle) -> Fut + Send + 'static,
		Fut: Future<Output = Result<()>> + Send + 'static,
	{
		let work: Work = Box::new(move |handle| Box::pin(work(handle)));
		let label = label.into();
		let scope = scope.into();

		// `Latest` supersedes rather than queues, so the outgoing job is cancelled before the new
		// one is even registered — otherwise a listener briefly sees two of them running.
		//
		// **Within this scope only** (S7.3). Across the application it meant a keystroke in one
		// window cancelling another window's preview build, which is the same rule applied to two
		// answers to two different questions.
		if lane == Lane::Latest {
			for id in self.active_in(lane, &scope) {
				self.cancel(id);
			}
		}

		let (id, job, start_now) = {
			let mut registry = self.inner.registry.lock().unwrap();
			registry.next_id += 1;
			let id = registry.next_id;
			// A `Queued` job that has to wait is *visibly* waiting; everything else starts here.
			let waiting = lane == Lane::Queued && registry.running_queued.is_some();
			registry.entries.push(Entry {
				job: Job {
					id,
					label,
					lane,
					state: if waiting { JobState::Queued } else { JobState::Running },
					fraction: None,
					done: None,
					total: None,
					rate: None,
					eta_seconds: None,
					message: String::new(),
					log_lines: 0,
				},
				scope: scope.clone(),
				log: VecDeque::new(),
				cancel: CancelToken::new(),
				task: None,
				anchor: None,
			});
			let start_now = if waiting {
				registry.pending.push_back((id, work));
				None
			} else {
				if lane == Lane::Queued {
					registry.running_queued = Some(id);
				}
				Some(work)
			};
			prune(&mut registry, &scope);
			// Cloned out so the event goes out without the lock held — a sink that calls back in
			// would deadlock, and the boundary's does not, but that is not a thing to rely on.
			let job = registry.entry(id).expect("just pushed").job.clone();
			(id, job, start_now)
		};

		self.emit(JobEvent::Added { job });
		if let Some(work) = start_now {
			self.spawn(id, work);
		}
		id
	}

	/// Asks a job to stop, and stops waiting for it.
	///
	/// Two mechanisms, because neither covers everything: the task is aborted, which drops async
	/// work at its next await point, and the token is set, which is the only thing a blocking
	/// thread can see. A job doing neither — a tight CPU loop with no polling — runs to completion
	/// while reported as cancelled; that is a property of the work, not of this call.
	pub fn cancel(&self, id: JobId) {
		let mut registry = self.inner.registry.lock().unwrap();
		let Some(entry) = registry.entry(id) else { return };
		if !entry.job.state.is_active() {
			return;
		}
		entry.job.state = JobState::Cancelled;
		entry.cancel.cancel();
		if let Some(task) = entry.task.take() {
			task.abort();
		}
		// Aborting means the completion path never runs, so releasing the lane is this call's job.
		registry.pending.retain(|(pending, _)| *pending != id);
		let freed = registry.running_queued == Some(id);
		if freed {
			registry.running_queued = None;
		}
		drop(registry);

		self.emit(JobEvent::Cancelled { id });
		if freed {
			self.pump();
		}
	}

	/// Every job this scope has run, oldest first.
	///
	/// One project's work, not the machine's (S7.3): an export started in another window is not news
	/// in this one, and a status bar that listed it would be reporting on a project you cannot see.
	#[must_use]
	pub fn list(&self, scope: &str) -> Vec<Job> {
		self
			.inner
			.registry
			.lock()
			.unwrap()
			.entries
			.iter()
			.filter(|entry| entry.scope == scope)
			.map(|entry| entry.job.clone())
			.collect()
	}

	/// One job, or `None` once it has aged out of the history.
	#[must_use]
	pub fn job(&self, id: JobId) -> Option<Job> {
		self.inner.registry.lock().unwrap().entry(id).map(|e| e.job.clone())
	}

	/// The job's log, oldest line first. Empty for a job that never logged, or that has aged out.
	#[must_use]
	pub fn log(&self, id: JobId) -> Vec<String> {
		self
			.inner
			.registry
			.lock()
			.unwrap()
			.entry(id)
			.map(|entry| entry.log.iter().cloned().collect())
			.unwrap_or_default()
	}

	/// Ids of the jobs in `lane` and `scope` that could still do something.
	fn active_in(&self, lane: Lane, scope: &str) -> Vec<JobId> {
		self
			.inner
			.registry
			.lock()
			.unwrap()
			.entries
			.iter()
			.filter(|entry| entry.job.lane == lane && entry.scope == scope && entry.job.state.is_active())
			.map(|entry| entry.job.id)
			.collect()
	}

	/// Whose job this is, or `None` once it has aged out of the history.
	fn scope_of(&self, id: JobId) -> Option<String> {
		self.inner.registry.lock().unwrap().entry(id).map(|e| e.scope.clone())
	}

	/// Runs the work, and records how it ended.
	fn spawn(&self, id: JobId, work: Work) {
		let cancel = {
			let mut registry = self.inner.registry.lock().unwrap();
			let Some(entry) = registry.entry(id) else { return };
			entry.cancel.clone()
		};
		let handle = JobHandle::new(id, self.sink_for_handle(), cancel);
		let jobs = self.clone();
		let task = tokio::spawn(async move {
			let outcome = work(handle).await;
			jobs.complete(id, outcome);
		});
		// Between the spawn and here the job may already have been cancelled, in which case the
		// entry is terminal and this handle is stale — abort rather than store it.
		let mut registry = self.inner.registry.lock().unwrap();
		match registry.entry(id) {
			Some(entry) if entry.job.state.is_active() => entry.task = Some(task),
			_ => task.abort(),
		}
	}

	fn complete(&self, id: JobId, outcome: Result<()>) {
		let mut registry = self.inner.registry.lock().unwrap();
		let Some(entry) = registry.entry(id) else { return };
		// Cancellation got there first. Its ending is the one that already went out.
		if !entry.job.state.is_active() {
			return;
		}
		let state = match &outcome {
			Ok(()) => JobState::Finished,
			Err(error) => JobState::Failed {
				error: format!("{error:#}"),
			},
		};
		entry.job.state = state.clone();
		entry.task = None;
		let freed = registry.running_queued == Some(id);
		if freed {
			registry.running_queued = None;
		}
		drop(registry);

		self.emit(match state {
			JobState::Failed { error } => JobEvent::Failed { id, error },
			_ => JobEvent::Finished { id },
		});
		if freed {
			self.pump();
		}
	}

	/// Starts the next queued job, if the lane is free and there is one.
	fn pump(&self) {
		let next = {
			let mut registry = self.inner.registry.lock().unwrap();
			if registry.running_queued.is_some() {
				return;
			}
			// Skip anything cancelled while it waited — `cancel` drops the work, so the id alone
			// could still be here in a future where the two get out of step.
			loop {
				let Some((id, work)) = registry.pending.pop_front() else {
					return;
				};
				match registry.entry(id) {
					Some(entry) if entry.job.state.is_active() => {
						entry.job.state = JobState::Running;
						registry.running_queued = Some(id);
						break (id, work);
					}
					_ => continue,
				}
			}
		};
		self.emit(JobEvent::Started { id: next.0 });
		self.spawn(next.0, next.1);
	}

	/// A sink that records into the registry on the way out.
	///
	/// The list and the event stream are the same facts, so they are written in one place: a
	/// listener that missed an event and asks for the list gets the same answer either way.
	fn sink_for_handle(&self) -> EventSink {
		let jobs = self.clone();
		Arc::new(move |event| {
			jobs.emit(jobs.record(event));
		})
	}

	/// Writes the event into the registry, and hands it back as the listener should see it.
	fn record(&self, mut event: JobEvent) -> JobEvent {
		let mut registry = self.inner.registry.lock().unwrap();
		match &mut event {
			JobEvent::Progress {
				id,
				fraction,
				done,
				total,
				message,
				rate,
				eta_seconds,
			} => {
				if let Some(entry) = registry.entry(*id) {
					entry.job.fraction = *fraction;
					entry.job.done = *done;
					entry.job.total = *total;
					entry.job.message.clone_from(message);
					entry.rate_and_eta(Instant::now());
					// Out again on the same event. The listener is not expected to keep a history of
					// its own — and the one that tried would have to keep the runner's anchor rule
					// with it, which is the whole reason that rule lives in one place.
					*rate = entry.job.rate;
					*eta_seconds = entry.job.eta_seconds;
				}
			}
			JobEvent::Log { id, line, log_lines } => {
				if let Some(entry) = registry.entry(*id) {
					if entry.log.len() == LOG_LINES {
						entry.log.pop_front();
					}
					entry.log.push_back(line.clone());
					entry.job.log_lines = entry.log.len();
					*log_lines = entry.job.log_lines;
				}
			}
			_ => {}
		}
		event
	}

	/// Sends an event to the scope whose job it is about, and to no other.
	///
	/// **Routed by the event's own id** rather than by a scope passed down through every caller —
	/// every event names the job it concerns, so the registry already knows the answer. A job that
	/// has aged out has no scope and its event is dropped, which is what a listener would have done
	/// with it anyway.
	fn emit(&self, event: JobEvent) {
		let id = match &event {
			JobEvent::Added { job } => job.id,
			JobEvent::Started { id }
			| JobEvent::Progress { id, .. }
			| JobEvent::Log { id, .. }
			| JobEvent::Finished { id }
			| JobEvent::Cancelled { id }
			| JobEvent::Failed { id, .. } => *id,
		};
		let Some(scope) = self.scope_of(id) else { return };
		let sink = self.inner.sinks.lock().unwrap().get(&scope).cloned();
		if let Some(sink) = sink {
			sink(event);
		}
	}
}

/// Drops one scope's oldest finished jobs once it has more than [`HISTORY`] of them.
///
/// Only finished ones: a queue of sixty conversions is not history, it is the work.
///
/// **Counted per scope** (S7.3), or a project that ran two hundred previews would age out the one
/// finished export another project is still looking at.
fn prune(registry: &mut Registry, scope: &str) {
	let finished = registry
		.entries
		.iter()
		.filter(|e| e.scope == scope && !e.job.state.is_active())
		.count();
	if finished <= HISTORY {
		return;
	}
	let mut excess = finished - HISTORY;
	registry.entries.retain(|entry| {
		if excess > 0 && entry.scope == scope && !entry.job.state.is_active() {
			excess -= 1;
			return false;
		}
		true
	});
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The window every case below speaks for. Scopes are S7.3's; these cases are about the lanes,
	/// the history and the reporting, and one window is what each of them is describing.
	const WINDOW: &str = "window-1";
	use std::sync::atomic::AtomicU32;
	use std::time::Duration;
	use tokio::sync::oneshot;

	fn collector(jobs: &Jobs) -> Arc<Mutex<Vec<JobEvent>>> {
		let events = Arc::new(Mutex::new(Vec::new()));
		let sink_events = Arc::clone(&events);
		jobs.set_sink(WINDOW, Arc::new(move |e| sink_events.lock().unwrap().push(e)));
		events
	}

	/// A flag a job sets when its body actually begins.
	///
	/// Necessary because [`JobState::Running`] is set *synchronously in `submit`*, before the task
	/// has been polled even once — so waiting for `Running` and then cancelling would abort a job
	/// that never ran, and prove nothing about cancelling one that did.
	#[derive(Clone, Default)]
	struct Started(Arc<AtomicBool>);

	impl Started {
		fn mark(&self) {
			self.0.store(true, Ordering::SeqCst);
		}
		fn happened(&self) -> bool {
			self.0.load(Ordering::SeqCst)
		}
	}

	/// Waits for a condition the background tasks are expected to reach.
	///
	/// Polling rather than a fixed sleep: the work happens on other tasks, and a sleep long enough
	/// to be reliable on a loaded CI machine is long enough to make the suite tedious.
	async fn until(mut condition: impl FnMut() -> bool) {
		for _ in 0..2000 {
			if condition() {
				return;
			}
			tokio::time::sleep(std::time::Duration::from_millis(1)).await;
		}
		panic!("the condition was never reached");
	}

	#[tokio::test]
	async fn a_job_reports_progress_and_finishes() {
		let jobs = Jobs::new();
		let events = collector(&jobs);

		let id = jobs.submit("counting", Lane::Queued, WINDOW, |handle| async move {
			handle.progress(0.5, "halfway");
			handle.log("wrote 1000 tiles");
			Ok(())
		});

		until(|| matches!(jobs.job(id).unwrap().state, JobState::Finished)).await;
		let job = jobs.job(id).unwrap();
		assert_eq!(job.fraction, Some(0.5), "the list carries what the events said");
		assert_eq!(job.message, "halfway");
		assert_eq!(jobs.log(id), ["wrote 1000 tiles"]);

		let events = events.lock().unwrap();
		assert!(matches!(events[0], JobEvent::Added { .. }));
		assert!(matches!(events.last().unwrap(), JobEvent::Finished { .. }));
	}

	/// The runner announces the ending, so a failure reaches the bar without the job remembering
	/// to say so.
	#[tokio::test]
	async fn a_job_that_returns_an_error_fails_with_it() {
		let jobs = Jobs::new();
		jobs.set_sink(WINDOW, Arc::new(|_| {}));

		let id = jobs.submit("doomed", Lane::Queued, WINDOW, |_| async move {
			anyhow::bail!("no such file");
		});

		until(|| !jobs.job(id).unwrap().state.is_active()).await;
		assert_eq!(
			jobs.job(id).unwrap().state,
			JobState::Failed {
				error: "no such file".into()
			}
		);
	}

	/// Progress that cannot be measured is reported as unmeasured, not as a made-up number.
	#[tokio::test]
	async fn indeterminate_progress_stays_indeterminate() {
		let jobs = Jobs::new();
		jobs.set_sink(WINDOW, Arc::new(|_| {}));

		let id = jobs.submit("thinking", Lane::Latest, WINDOW, |handle| async move {
			handle.working("building the pipeline");
			Ok(())
		});

		until(|| !jobs.job(id).unwrap().state.is_active()).await;
		let job = jobs.job(id).unwrap();
		assert_eq!(job.fraction, None);
		assert_eq!(job.message, "building the pipeline");
	}

	#[tokio::test]
	async fn progress_is_clamped() {
		let jobs = Jobs::new();
		jobs.set_sink(WINDOW, Arc::new(|_| {}));

		let id = jobs.submit("out of range", Lane::Queued, WINDOW, |handle| async move {
			handle.progress(99.0, "past the end");
			Ok(())
		});

		until(|| !jobs.job(id).unwrap().state.is_active()).await;
		assert_eq!(jobs.job(id).unwrap().fraction, Some(1.0));
	}

	/// `rate_and_eta` is driven directly here rather than through a job, so the clock is an
	/// argument instead of something the test has to sleep through.
	fn counting(done: u64, total: u64) -> Entry {
		let mut entry = Entry {
			job: Job {
				id: 1,
				label: "writing".into(),
				lane: Lane::Queued,
				state: JobState::Running,
				fraction: None,
				done: Some(done),
				total: Some(total),
				rate: None,
				eta_seconds: None,
				message: String::new(),
				log_lines: 0,
			},
			scope: WINDOW.to_string(),
			log: VecDeque::new(),
			cancel: CancelToken::new(),
			task: None,
			anchor: None,
		};
		entry.rate_and_eta(Instant::now());
		entry
	}

	#[test]
	fn a_speed_needs_two_points_and_says_nothing_before_it_has_them() {
		let entry = counting(0, 1000);
		assert_eq!(entry.job.rate, None, "one sample is a position, not a speed");
		assert_eq!(entry.job.eta_seconds, None);
	}

	#[test]
	fn the_speed_is_measured_from_the_first_count_it_saw() {
		let mut entry = counting(100, 1100);
		let start = entry.anchor.expect("the first update anchors the average").0;

		// Two seconds later, 300 units further on: 150 per second, 800 left, so about 5.3 seconds.
		entry.job.done = Some(400);
		entry.rate_and_eta(start + Duration::from_secs(2));

		let rate = entry.job.rate.expect("two counts two seconds apart is a speed");
		assert!((rate - 150.0).abs() < 0.001, "{rate}");
		let eta = entry.job.eta_seconds.expect("a speed and a remainder is an ETA");
		assert!((eta - 700.0 / 150.0).abs() < 0.001, "{eta}");
	}

	/// The anchor is the first *count*, not the submission: a job that spent a minute opening
	/// sources before writing a tile is not writing tiles at one a minute.
	#[test]
	fn time_before_the_first_count_is_not_averaged_in() {
		let mut entry = counting(0, 100);
		let start = entry.anchor.expect("anchored").0;

		entry.job.done = Some(50);
		entry.rate_and_eta(start + Duration::from_secs(1));

		assert_eq!(entry.job.rate, Some(50.0), "50 in the second since the first count");
	}

	#[test]
	fn a_job_that_has_not_moved_reports_no_speed_rather_than_zero() {
		let mut entry = counting(10, 100);
		let start = entry.anchor.expect("anchored").0;

		entry.rate_and_eta(start + Duration::from_secs(5));

		assert_eq!(entry.job.rate, None, "nothing moved, so nothing can be said — not 0/s");
		assert_eq!(entry.job.eta_seconds, None, "and an infinite ETA is not an ETA");
	}

	/// A total of zero is a denominator nobody knows yet, not a job that is 0% done.
	#[tokio::test]
	async fn counting_towards_an_unknown_total_is_reported_as_not_knowing() {
		let jobs = Jobs::new();
		jobs.set_sink(WINDOW, Arc::new(|_| {}));

		let id = jobs.submit("unknown", Lane::Queued, WINDOW, |handle| async move {
			handle.counted(0, 0, "counting what exactly");
			Ok(())
		});

		until(|| !jobs.job(id).unwrap().state.is_active()).await;
		let job = jobs.job(id).unwrap();
		assert_eq!(job.fraction, None);
		assert_eq!(job.total, None);
		assert_eq!(job.message, "counting what exactly");
	}

	#[tokio::test]
	async fn counted_progress_reaches_the_job_as_both_a_fraction_and_counts() {
		let jobs = Jobs::new();
		jobs.set_sink(WINDOW, Arc::new(|_| {}));

		let id = jobs.submit("writing", Lane::Queued, WINDOW, |handle| async move {
			handle.counted(25, 100, "writing tiles");
			Ok(())
		});

		until(|| !jobs.job(id).unwrap().state.is_active()).await;
		let job = jobs.job(id).unwrap();
		assert_eq!(job.fraction, Some(0.25));
		assert_eq!((job.done, job.total), (Some(25), Some(100)));
	}

	/// The whole reason [`Lane::Queued`] exists: two conversions do not run at once.
	#[tokio::test]
	async fn queued_jobs_run_one_at_a_time_in_order() {
		let jobs = Jobs::new();
		jobs.set_sink(WINDOW, Arc::new(|_| {}));
		let concurrent = Arc::new(AtomicU32::new(0));
		let peak = Arc::new(AtomicU32::new(0));
		let order = Arc::new(Mutex::new(Vec::new()));

		let ids: Vec<_> = (0..4)
			.map(|n| {
				let (concurrent, peak, order) = (concurrent.clone(), peak.clone(), order.clone());
				jobs.submit(format!("job {n}"), Lane::Queued, WINDOW, move |_| async move {
					let now = concurrent.fetch_add(1, Ordering::SeqCst) + 1;
					peak.fetch_max(now, Ordering::SeqCst);
					order.lock().unwrap().push(n);
					tokio::time::sleep(std::time::Duration::from_millis(5)).await;
					concurrent.fetch_sub(1, Ordering::SeqCst);
					Ok(())
				})
			})
			.collect();

		// Only the first starts; the rest are visibly waiting rather than quietly running.
		assert_eq!(jobs.job(ids[3]).unwrap().state, JobState::Queued);

		until(|| jobs.list(WINDOW).iter().all(|job| !job.state.is_active())).await;
		assert_eq!(peak.load(Ordering::SeqCst), 1, "the lane holds one job");
		assert_eq!(*order.lock().unwrap(), [0, 1, 2, 3], "and holds it in order");
	}

	/// The bug this exists for: the speed and the ETA were computed on every update and never left
	/// the core.
	///
	/// The list a window takes when it subscribes carried them; nothing after that did. So an export
	/// started while you were watching showed a bar and "processing tiles" and never a speed — and
	/// one already running when the window opened showed whatever it had at that instant, frozen.
	#[tokio::test]
	async fn a_progress_event_carries_the_speed_the_runner_worked_out() {
		let jobs = Jobs::new();
		let events = collector(&jobs);

		let id = jobs.submit("writing", Lane::Queued, WINDOW, |handle| async move {
			handle.counted(0, 100, "processing tiles");
			// Far enough apart that the anchor has elapsed time to divide by.
			tokio::time::sleep(Duration::from_millis(20)).await;
			handle.counted(50, 100, "processing tiles");
			Ok(())
		});
		until(|| !jobs.job(id).unwrap().state.is_active()).await;

		let paced: Vec<(Option<f64>, Option<f64>)> = events
			.lock()
			.unwrap()
			.iter()
			.filter_map(|event| match event {
				JobEvent::Progress { rate, eta_seconds, .. } => Some((*rate, *eta_seconds)),
				_ => None,
			})
			.collect();

		assert_eq!(paced.len(), 2);
		assert_eq!(
			paced[0],
			(None, None),
			"nothing has moved yet, and a rate from one sample is not a rate"
		);
		let (rate, eta) = paced[1];
		assert!(rate.is_some_and(|rate| rate > 0.0), "no speed on the second update");
		assert!(eta.is_some_and(|eta| eta > 0.0), "no ETA on the second update");
	}

	/// A job that cannot count says so, rather than reporting a speed of zero.
	#[tokio::test]
	async fn an_uncounted_job_reports_no_speed_at_all() {
		let jobs = Jobs::new();
		let events = collector(&jobs);

		let id = jobs.submit("thinking", Lane::Queued, WINDOW, |handle| async move {
			handle.working("building the pipeline");
			Ok(())
		});
		until(|| !jobs.job(id).unwrap().state.is_active()).await;

		let held = events.lock().unwrap();
		let progress = held
			.iter()
			.find(|event| matches!(event, JobEvent::Progress { .. }))
			.expect("the message went out as progress");
		assert!(matches!(
			progress,
			JobEvent::Progress {
				rate: None,
				eta_seconds: None,
				..
			}
		));
	}

	// -- one runner, a list per project (S7.3) --------------------------------------------------

	/// The bug S7.3 exists for.
	///
	/// `Latest` means "newest wins", which is right for a preview of a document that has since been
	/// edited and catastrophic across projects: every keystroke in one window cancelled the other
	/// window's build, and neither window could tell why its map had stopped updating.
	#[tokio::test]
	async fn a_latest_job_supersedes_only_within_its_own_scope() {
		let jobs = Jobs::new();
		let theirs = jobs.submit("preview", Lane::Latest, "window-2", |_| async move {
			tokio::time::sleep(Duration::from_secs(30)).await;
			Ok(())
		});

		let mine = jobs.submit("preview", Lane::Latest, "window-1", |_| async move { Ok(()) });
		until(|| !jobs.job(mine).unwrap().state.is_active()).await;

		assert_eq!(
			jobs.job(theirs).unwrap().state,
			JobState::Running,
			"another window's build is not this window's to cancel"
		);
		jobs.cancel(theirs);
	}

	#[tokio::test]
	async fn a_latest_job_still_supersedes_the_one_before_it_in_the_same_scope() {
		let jobs = Jobs::new();
		let first = jobs.submit("preview 1", Lane::Latest, WINDOW, |_| async move {
			tokio::time::sleep(Duration::from_secs(30)).await;
			Ok(())
		});
		jobs.submit("preview 2", Lane::Latest, WINDOW, |_| async move { Ok(()) });
		assert_eq!(jobs.job(first).unwrap().state, JobState::Cancelled);
	}

	/// A status bar reports on the project in front of you, not on the machine.
	#[tokio::test]
	async fn a_window_is_listed_its_own_work_and_no_other() {
		let jobs = Jobs::new();
		jobs.submit("mine", Lane::Queued, "window-1", |_| async move { Ok(()) });
		jobs.submit("theirs", Lane::Queued, "window-2", |_| async move { Ok(()) });

		let mine: Vec<String> = jobs.list("window-1").into_iter().map(|job| job.label).collect();
		assert_eq!(mine, ["mine"]);
		let theirs: Vec<String> = jobs.list("window-2").into_iter().map(|job| job.label).collect();
		assert_eq!(theirs, ["theirs"]);
		assert!(jobs.list("window-3").is_empty());
	}

	/// Events follow the same rule as the list, or a window would hear about work it cannot see.
	#[tokio::test]
	async fn events_reach_only_the_window_whose_job_it_is() {
		let jobs = Jobs::new();
		let mine = Arc::new(Mutex::new(Vec::new()));
		let theirs = Arc::new(Mutex::new(Vec::new()));
		let (a, b) = (mine.clone(), theirs.clone());
		jobs.set_sink("window-1", Arc::new(move |e| a.lock().unwrap().push(e)));
		jobs.set_sink("window-2", Arc::new(move |e| b.lock().unwrap().push(e)));

		let id = jobs.submit("mine", Lane::Queued, "window-1", |handle| async move {
			handle.log("a line");
			Ok(())
		});
		until(|| !jobs.job(id).unwrap().state.is_active()).await;

		assert!(!mine.lock().unwrap().is_empty());
		assert!(
			theirs.lock().unwrap().is_empty(),
			"a window heard about a job belonging to a project it cannot see"
		);
	}

	/// **The one thing that stays shared**, and deliberately: the argument for `Queued` is about the
	/// machine — two conversions compete for the same disk and the same cores — which is as true
	/// across two projects as within one.
	#[tokio::test]
	async fn queued_jobs_still_run_one_at_a_time_across_projects() {
		let jobs = Jobs::new();
		let first = jobs.submit("theirs", Lane::Queued, "window-2", |_| async move {
			tokio::time::sleep(Duration::from_millis(50)).await;
			Ok(())
		});
		let second = jobs.submit("mine", Lane::Queued, "window-1", |_| async move { Ok(()) });

		assert_eq!(jobs.job(first).unwrap().state, JobState::Running);
		assert_eq!(
			jobs.job(second).unwrap().state,
			JobState::Queued,
			"a second project's conversion waits its turn like any other"
		);
		until(|| !jobs.job(second).unwrap().state.is_active()).await;
	}

	/// A closed window has nowhere to hear about its work — but the work is not cancelled by it.
	#[tokio::test]
	async fn forgetting_a_window_stops_the_reporting_and_not_the_job() {
		let jobs = Jobs::new();
		let heard = Arc::new(Mutex::new(Vec::new()));
		let sink = heard.clone();
		jobs.set_sink(WINDOW, Arc::new(move |e| sink.lock().unwrap().push(e)));

		let id = jobs.submit("writing", Lane::Queued, WINDOW, |_| async move {
			tokio::time::sleep(Duration::from_millis(20)).await;
			Ok(())
		});
		jobs.forget(WINDOW);
		let so_far = heard.lock().unwrap().len();

		until(|| !jobs.job(id).unwrap().state.is_active()).await;
		assert_eq!(jobs.job(id).unwrap().state, JobState::Finished, "the export ran on");
		assert_eq!(
			heard.lock().unwrap().len(),
			so_far,
			"and nothing was sent to a window that is gone"
		);
	}

	/// [`Lane::Latest`] is the preview's lane: an answer to a question that has been asked again is
	/// not worth finishing.
	#[tokio::test]
	async fn a_latest_job_supersedes_the_one_before_it() {
		let jobs = Jobs::new();
		jobs.set_sink(WINDOW, Arc::new(|_| {}));
		let (tx, rx) = oneshot::channel();
		let finished_anyway = Arc::new(AtomicBool::new(false));

		let started = Started::default();

		let (flag, mark) = (finished_anyway.clone(), started.clone());
		let first = jobs.submit("preview 1", Lane::Latest, WINDOW, move |_| async move {
			mark.mark();
			let _ = rx.await;
			flag.store(true, Ordering::SeqCst);
			Ok(())
		});
		until(|| started.happened()).await;

		let second = jobs.submit("preview 2", Lane::Latest, WINDOW, |_| async move { Ok(()) });

		assert_eq!(jobs.job(first).unwrap().state, JobState::Cancelled);
		until(|| jobs.job(second).unwrap().state == JobState::Finished).await;

		// Aborted at its await point, so it never reached the line after it.
		let _ = tx.send(());
		tokio::time::sleep(std::time::Duration::from_millis(20)).await;
		assert!(
			!finished_anyway.load(Ordering::SeqCst),
			"the superseded work was dropped"
		);
	}

	/// A preview must not wait behind an export — the reason there are two lanes rather than one
	/// queue.
	#[tokio::test]
	async fn a_latest_job_does_not_wait_for_a_queued_one() {
		let jobs = Jobs::new();
		jobs.set_sink(WINDOW, Arc::new(|_| {}));
		let (tx, rx) = oneshot::channel();

		let started = Started::default();

		let mark = started.clone();
		let long = jobs.submit("export", Lane::Queued, WINDOW, move |_| async move {
			mark.mark();
			let _ = rx.await;
			Ok(())
		});
		until(|| started.happened()).await;

		let preview = jobs.submit("preview", Lane::Latest, WINDOW, |_| async move { Ok(()) });
		until(|| jobs.job(preview).unwrap().state == JobState::Finished).await;
		assert_eq!(
			jobs.job(long).unwrap().state,
			JobState::Running,
			"and the export is untouched"
		);
		let _ = tx.send(());
	}

	/// Cancelling a job that has not started drops the work and frees nothing — the lane was never
	/// its to hold.
	#[tokio::test]
	async fn cancelling_a_queued_job_removes_it_without_running_it() {
		let jobs = Jobs::new();
		jobs.set_sink(WINDOW, Arc::new(|_| {}));
		let ran = Arc::new(AtomicBool::new(false));
		let (tx, rx) = oneshot::channel();

		let started = Started::default();

		let mark = started.clone();
		let blocker = jobs.submit("blocker", Lane::Queued, WINDOW, move |_| async move {
			mark.mark();
			let _ = rx.await;
			Ok(())
		});
		until(|| started.happened()).await;

		let flag = ran.clone();
		let waiting = jobs.submit("waiting", Lane::Queued, WINDOW, move |_| async move {
			flag.store(true, Ordering::SeqCst);
			Ok(())
		});
		jobs.cancel(waiting);
		let _ = tx.send(());

		until(|| jobs.job(blocker).unwrap().state == JobState::Finished).await;
		tokio::time::sleep(std::time::Duration::from_millis(20)).await;
		assert_eq!(jobs.job(waiting).unwrap().state, JobState::Cancelled);
		assert!(!ran.load(Ordering::SeqCst), "cancelled before it ever started");
	}

	/// Cancellation the job can see, for work that a dropped future does not stop.
	#[tokio::test]
	async fn a_blocking_job_can_poll_for_cancellation() {
		let jobs = Jobs::new();
		jobs.set_sink(WINDOW, Arc::new(|_| {}));
		let noticed = Arc::new(AtomicBool::new(false));

		let started = Started::default();

		let (flag, mark) = (noticed.clone(), started.clone());
		let id = jobs.submit("grinding", Lane::Queued, WINDOW, move |handle| async move {
			tokio::task::spawn_blocking(move || {
				mark.mark();
				while !handle.is_cancelled() {
					std::thread::sleep(std::time::Duration::from_millis(1));
				}
				flag.store(true, Ordering::SeqCst);
			})
			.await?;
			Ok(())
		});

		until(|| started.happened()).await;
		jobs.cancel(id);
		until(|| noticed.load(Ordering::SeqCst)).await;
	}

	/// A finished job's ending is announced once, by whichever came first.
	#[tokio::test]
	async fn cancelling_a_finished_job_does_nothing() {
		let jobs = Jobs::new();
		let events = collector(&jobs);

		let id = jobs.submit("quick", Lane::Queued, WINDOW, |_| async move { Ok(()) });
		until(|| jobs.job(id).unwrap().state == JobState::Finished).await;

		let before = events.lock().unwrap().len();
		jobs.cancel(id);
		assert_eq!(jobs.job(id).unwrap().state, JobState::Finished);
		assert_eq!(events.lock().unwrap().len(), before, "no second ending");
	}

	/// The log is the last lines, because that is where a failure explains itself.
	#[tokio::test]
	async fn the_log_keeps_the_most_recent_lines() {
		let jobs = Jobs::new();
		let events = collector(&jobs);

		let id = jobs.submit("chatty", Lane::Queued, WINDOW, |handle| async move {
			for n in 0..LOG_LINES + 10 {
				handle.log(format!("line {n}"));
			}
			Ok(())
		});

		until(|| !jobs.job(id).unwrap().state.is_active()).await;
		let log = jobs.log(id);
		assert_eq!(log.len(), LOG_LINES);
		assert_eq!(log[0], "line 10", "the oldest were dropped, not the newest");
		assert_eq!(jobs.job(id).unwrap().log_lines, LOG_LINES);

		// The count the listener is told never exceeds what the log actually holds — a mirror that
		// counted for itself would be claiming a thousand and ten lines by now.
		let events = events.lock().unwrap();
		let counts: Vec<usize> = events
			.iter()
			.filter_map(|e| match e {
				JobEvent::Log { log_lines, .. } => Some(*log_lines),
				_ => None,
			})
			.collect();
		assert_eq!(counts.len(), LOG_LINES + 10);
		assert_eq!(*counts.last().unwrap(), LOG_LINES);
		assert!(counts.iter().all(|&n| n <= LOG_LINES));
	}

	/// History is bounded, but only history — a long queue is work, not backlog.
	#[tokio::test]
	async fn finished_jobs_age_out_but_waiting_ones_do_not() {
		let jobs = Jobs::new();
		jobs.set_sink(WINDOW, Arc::new(|_| {}));

		for _ in 0..HISTORY + 20 {
			let id = jobs.submit("brief", Lane::Latest, WINDOW, |_| async move { Ok(()) });
			until(|| !jobs.job(id).unwrap().state.is_active()).await;
		}
		// One more submission is what triggers pruning, so ask after it.
		let last = jobs.submit("brief", Lane::Latest, WINDOW, |_| async move { Ok(()) });
		until(|| !jobs.job(last).unwrap().state.is_active()).await;
		assert!(
			jobs.list(WINDOW).len() <= HISTORY + 1,
			"got {}",
			jobs.list(WINDOW).len()
		);
	}

	#[tokio::test]
	async fn events_before_a_sink_is_installed_are_dropped_not_queued() {
		let jobs = Jobs::new();
		let id = jobs.submit("early", Lane::Queued, WINDOW, |handle| async move {
			handle.log("said into the void");
			Ok(())
		});
		until(|| !jobs.job(id).unwrap().state.is_active()).await;

		// Dropped for the listener, kept for the list — which is what makes a reload recoverable.
		assert_eq!(jobs.log(id), ["said into the void"]);
		assert_eq!(jobs.job(id).unwrap().state, JobState::Finished);
	}

	#[tokio::test]
	async fn cancellation_is_visible_to_the_job() {
		let cancel = CancelToken::new();
		let job = JobHandle::new(2, Arc::new(|_| {}), cancel.clone());

		assert!(!job.is_cancelled());
		cancel.cancel();
		assert!(job.is_cancelled(), "the token is shared, not copied");
	}
}
