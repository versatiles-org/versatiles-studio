//! Event plane - Tauri Channels carrying job progress, warnings and log lines (Q3, E7).
//!
//! This module is the entire adapter between the core's Tauri-free [`JobEvent`] and a Tauri
//! `Channel`. Keeping it this small is the point: the core stays testable, and swapping the
//! transport would touch one function.

use std::sync::Arc;
use studio_core::jobs::{EventSink, JobEvent};
use tauri::ipc::Channel;

/// Wraps a Tauri `Channel` as an [`EventSink`] the core can call.
///
/// Send failures are dropped deliberately: a closed channel means the window went away, and a job
/// should keep running - or be cancelled explicitly - rather than fail because nobody is listening.
#[must_use]
pub fn channel_sink(channel: Channel<JobEvent>) -> EventSink {
	Arc::new(move |event| {
		let _ = channel.send(event);
	})
}
