//! What went wrong this session, kept where the user can copy it out (S6.8).
//!
//! **Errors had five sinks and no reader.** The status bar showed one message at a time and the
//! next failure overwrote it; MapLibre's own errors went to a console a bundled build does not
//! expose; `eprintln!` went to a stderr that a double-clicked `.app` does not have; a panic went
//! nowhere at all. Every one of them was information somebody would have to describe from memory in
//! an issue.
//!
//! **In the core, not the webview**, for the reason [Q16] gives for everything else: a log that
//! lives in the window is empty exactly when it is most wanted — after a reload or a webview crash.
//! The webview reports *into* here and reads back out, the same shape as the job log.
//!
//! **Repeats are folded rather than listed.** A container of `bin` tiles produces one decode error
//! per tile; without folding, five hundred identical lines push out the one entry that explains
//! them. An entry therefore carries a `count`, and a repeat moves its timestamp rather than adding
//! a row.
//!
//! [Q16]: ../../../docs/decisions.md

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

/// How many distinct entries are kept.
///
/// The **oldest** go first, which is the opposite of the per-job log: a job explains its failure in
/// its last lines, while a session explains itself from the first thing that went wrong — but an
/// unbounded list in a process that runs for days is a leak with a nicer name, and five hundred
/// distinct problems is already far past the point where anyone reads them.
const HISTORY: usize = 500;

/// Identifies a problem for the lifetime of the process.
// `u32` for the reason `JobId` is: specta will not emit a 64-bit integer as a plain number.
pub type ProblemId = u32;

/// How much attention an entry deserves.
///
/// Two levels, not five. This is a list of *problems* — anything worth a level below "something did
/// not work" belongs in a job's log or in nothing at all, and a level nobody filters on is a column
/// nobody reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub enum Level {
	/// Something was given up on, and the application carried on without it.
	Warn,
	/// Something the user asked for did not happen.
	Error,
}

/// Which half of the application an entry came from.
///
/// Worth keeping apart because it decides who reads it: `Core` is Rust, `Webview` is the window,
/// and `Map` is MapLibre reporting about tiles and styles — the one that is nobody's code and
/// therefore the easiest to misattribute.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub enum Origin {
	Core,
	Webview,
	Map,
}

/// One problem, as the panel lists it and the report prints it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Problem {
	pub id: ProblemId,
	/// Whole seconds since the Unix epoch.
	///
	/// A wall clock rather than an elapsed time, because the number that matters in an issue is
	/// "before or after the thing I was doing". Seconds rather than milliseconds because specta
	/// renders an `f64` as `number | null` — JSON cannot promise it a NaN — and a time that has to
	/// be null-checked at every use is a worse trade than a second of precision nobody reads. Ties
	/// are broken by `id`, which is monotonic.
	pub at: u32,
	pub level: Level,
	pub origin: Origin,
	/// One line, and the thing repeats are matched on.
	pub message: String,
	/// The rest of it — a stack, an error chain, a panic's location. Often the whole answer.
	pub detail: Option<String>,
	/// How many times this happened. `1` for a problem that happened once.
	pub count: u32,
}

/// A problem on its way in, before the ring gives it an id, a time and a count.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct NewProblem {
	pub level: Level,
	pub origin: Origin,
	pub message: String,
	pub detail: Option<String>,
}

/// The session's problems, shared by every window and by the panic hook.
///
/// `Clone` and internally locked, like [`crate::jobs::Jobs`]: the panic hook holds one and the
/// application state holds another, and a hook that had to reach through Tauri's state map to find
/// this would be a hook that cannot run during start-up.
#[derive(Clone, Default)]
pub struct Diagnostics {
	inner: Arc<Mutex<Inner>>,
}

#[derive(Default)]
struct Inner {
	entries: VecDeque<Problem>,
	next: ProblemId,
}

impl Diagnostics {
	#[must_use]
	pub fn new() -> Self {
		Self::default()
	}

	/// Records a problem, folding it into an identical one if this has happened before.
	///
	/// Returns how many distinct entries are now held — the number the status bar puts on its
	/// button, so that reporting one and asking for the count is a single call rather than two.
	pub fn record(&self, report: NewProblem) -> u32 {
		let mut inner = self.lock();
		let at = now();

		// Matched on everything but the time and the count, and searched across the whole ring
		// rather than only against the last entry: MapLibre's per-tile errors arrive interleaved
		// with whatever else is failing, so "consecutive" would fold almost none of them.
		if let Some(existing) = inner.entries.iter_mut().find(|entry| entry.is(&report)) {
			existing.count = existing.count.saturating_add(1);
			// The entry moves in time rather than in the list. The panel orders by time, so a
			// problem that is happening again rises to the top without its history being rewritten.
			existing.at = at;
			return count(&inner);
		}

		let id = inner.next;
		inner.next = inner.next.wrapping_add(1);
		inner.entries.push_back(Problem {
			id,
			at,
			level: report.level,
			origin: report.origin,
			message: report.message,
			detail: report.detail,
			count: 1,
		});
		while inner.entries.len() > HISTORY {
			inner.entries.pop_front();
		}
		count(&inner)
	}

	/// Everything held, oldest first.
	#[must_use]
	pub fn list(&self) -> Vec<Problem> {
		self.lock().entries.iter().cloned().collect()
	}

	/// How many distinct entries are held.
	#[must_use]
	pub fn count(&self) -> u32 {
		count(&self.lock())
	}

	/// Forgets everything — for reproducing a problem cleanly before copying the report.
	pub fn clear(&self) {
		let mut inner = self.lock();
		inner.entries.clear();
	}

	/// **Poisoning is recovered from rather than propagated.** The panic hook records through here,
	/// so a panic while this lock was held would otherwise make the hook panic in turn, which
	/// aborts the process and loses the very entry that explains it.
	fn lock(&self) -> MutexGuard<'_, Inner> {
		self.inner.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
	}
}

impl Problem {
	/// Whether a new report is another occurrence of this entry.
	fn is(&self, report: &NewProblem) -> bool {
		self.level == report.level
			&& self.origin == report.origin
			&& self.message == report.message
			&& self.detail == report.detail
	}
}

fn count(inner: &Inner) -> u32 {
	u32::try_from(inner.entries.len()).unwrap_or(u32::MAX)
}

/// Now, in seconds since the epoch. A clock set before 1970, or past 2106, reports what it can
/// rather than refusing to log.
fn now() -> u32 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map_or(0, |since| u32::try_from(since.as_secs()).unwrap_or(u32::MAX))
}

/// Sends panics here on their way to the default hook.
///
/// **The default hook still runs**, so a debug build keeps printing to stderr and `RUST_BACKTRACE`
/// keeps working. This only makes sure the one line that says what happened survives in a build
/// where stderr goes nowhere.
///
/// A release build is stripped, so there are no symbols to walk — but a panic's *location* is
/// compiled in as data by the panic macro itself, and that is the half that usually names the bug.
pub fn catch_panics(diagnostics: &Diagnostics) {
	let sink = diagnostics.clone();
	let previous = std::panic::take_hook();
	std::panic::set_hook(Box::new(move |info| {
		let payload = info.payload();
		let message = payload
			.downcast_ref::<&str>()
			.copied()
			.or_else(|| payload.downcast_ref::<String>().map(String::as_str))
			.unwrap_or("panicked");
		sink.record(NewProblem {
			level: Level::Error,
			origin: Origin::Core,
			message: format!("Panic: {message}"),
			detail: info.location().map(ToString::to_string),
		});
		previous(info);
	}));
}

#[cfg(test)]
mod tests {
	use super::*;

	fn error(message: &str) -> NewProblem {
		NewProblem {
			level: Level::Error,
			origin: Origin::Webview,
			message: message.to_string(),
			detail: None,
		}
	}

	#[test]
	fn keeps_what_it_is_told() {
		let log = Diagnostics::new();
		assert_eq!(log.record(error("no such file")), 1);
		assert_eq!(log.record(error("port in use")), 2);

		let held = log.list();
		assert_eq!(held.len(), 2);
		assert_eq!(held[0].message, "no such file", "oldest first");
		assert_eq!(held[0].count, 1);
		assert_ne!(held[0].id, held[1].id, "ids are distinct");
	}

	/// The `bin` container case: one decode error per tile, and without this the entry that
	/// explains them is pushed out by five hundred copies of the symptom.
	#[test]
	fn folds_a_repeat_into_the_entry_it_repeats() {
		let log = Diagnostics::new();
		log.record(error("could not decode tile"));
		for _ in 0..99 {
			assert_eq!(log.record(error("could not decode tile")), 1, "still one entry");
		}

		let held = log.list();
		assert_eq!(held.len(), 1);
		assert_eq!(held[0].count, 100);
	}

	/// Folded across the list, not only against the last entry: real sessions interleave.
	#[test]
	fn folds_a_repeat_that_something_else_came_between() {
		let log = Diagnostics::new();
		log.record(error("could not decode tile"));
		log.record(error("something else"));
		log.record(error("could not decode tile"));

		let held = log.list();
		assert_eq!(held.len(), 2);
		assert_eq!(held[0].count, 2);
		assert_eq!(held[1].count, 1);
	}

	#[test]
	fn tells_two_reports_apart_by_every_field_it_shows() {
		let log = Diagnostics::new();
		log.record(error("failed"));
		log.record(NewProblem {
			origin: Origin::Core,
			..error("failed")
		});
		log.record(NewProblem {
			level: Level::Warn,
			..error("failed")
		});
		log.record(NewProblem {
			detail: Some("at line 4".to_string()),
			..error("failed")
		});
		assert_eq!(log.list().len(), 4);
	}

	#[test]
	fn drops_the_oldest_rather_than_growing_forever() {
		let log = Diagnostics::new();
		for index in 0..HISTORY + 10 {
			log.record(error(&format!("problem {index}")));
		}

		let held = log.list();
		assert_eq!(held.len(), HISTORY);
		assert_eq!(held[0].message, "problem 10", "the first ten are gone");
	}

	#[test]
	fn forgets_everything_when_asked() {
		let log = Diagnostics::new();
		log.record(error("no such file"));
		log.clear();
		assert_eq!(log.count(), 0);
		assert!(log.list().is_empty());
	}

	/// The hook runs on a panicking thread, which the test catches so the rest of the suite lives.
	#[test]
	fn records_a_panic_with_where_it_happened() {
		let log = Diagnostics::new();
		catch_panics(&log);

		let panicked = std::panic::catch_unwind(|| panic!("held it wrong"));
		assert!(panicked.is_err());

		let held = log.list();
		let entry = held.last().expect("the hook should have recorded something");
		assert_eq!(entry.message, "Panic: held it wrong");
		assert!(entry.origin == Origin::Core);
		assert!(
			entry.detail.as_deref().unwrap_or_default().contains("diagnostics.rs"),
			"the location names the file it happened in, {:?}",
			entry.detail
		);
		let _ = std::panic::take_hook();
	}
}
