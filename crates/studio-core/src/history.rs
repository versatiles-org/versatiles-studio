//! One undo stack for the whole document (S2.8, G6).
//!
//! Undo belongs to the *document*, not to any one view of it ([Q11], [Q25]). The text editor, the
//! parameter forms and the graph all change the same pipeline, so a stack per view would mean
//! ⌘Z doing something different depending on where the focus happened to be — and no way at all to
//! undo a form change from the text tab.
//!
//! **Snapshots, not inverse edits.** A pipeline is a few hundred bytes, so a hundred of them costs
//! less than a single map tile. Storing the text is exact by construction; deriving an inverse for
//! every kind of edit is a source of bugs that buys nothing at this size.
//!
//! [Q11]: ../../docs/decisions.md
//! [Q25]: ../../docs/decisions.md

use std::time::{Duration, Instant};

/// How long a run of typing keeps merging into one undo step.
///
/// Long enough that a burst of keystrokes is one step, short enough that a pause between thoughts
/// makes a boundary. Only typing coalesces: a form or graph edit is always its own step, because a
/// user who changes a value and presses ⌘Z means *that* value.
const COALESCE: Duration = Duration::from_millis(600);

/// Beyond this the oldest entries are dropped. Deep enough to cover a session's worth of edits.
const LIMIT: usize = 200;

/// Where an edit came from. Only the origin matters, not the detail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditKind {
	/// A keystroke in the VPL editor. Consecutive ones merge.
	Typing,
	/// A parameter form or the graph — a deliberate, discrete change.
	Structured,
	/// The document was replaced wholesale, e.g. by opening a file.
	Replaced,
}

#[derive(Debug, Clone)]
struct Entry {
	text: String,
	kind: EditKind,
	at: Instant,
}

/// The document's edit history.
#[derive(Debug, Default)]
pub struct History {
	entries: Vec<Entry>,
	/// Index of the current state. Everything after it is redoable.
	cursor: usize,
}

impl History {
	#[must_use]
	pub fn new() -> Self {
		Self::default()
	}

	/// Records a new state, discarding anything that was redoable.
	///
	/// Editing after undoing abandons the branch that was undone — the usual and expected model:
	/// there is one past, and stepping off it forgets the future you stepped away from.
	pub fn push(&mut self, text: impl Into<String>, kind: EditKind) {
		self.push_at(text, kind, Instant::now());
	}

	/// [`push`](Self::push) with the clock supplied, so coalescing can be tested without sleeping.
	pub fn push_at(&mut self, text: impl Into<String>, kind: EditKind, at: Instant) {
		let text = text.into();
		if self.current() == Some(text.as_str()) {
			return; // nothing changed; a re-render is not an edit
		}

		self.entries.truncate(self.cursor + 1);

		let merge = self.should_merge(kind, at);
		if let (true, Some(last)) = (merge, self.entries.last_mut()) {
			last.text = text;
			last.at = at;
			return;
		}

		self.entries.push(Entry { text, kind, at });
		if self.entries.len() > LIMIT {
			self.entries.remove(0);
		}
		self.cursor = self.entries.len() - 1;
	}

	/// A run of typing merges; anything else stands alone.
	fn should_merge(&self, kind: EditKind, at: Instant) -> bool {
		if kind != EditKind::Typing || self.entries.is_empty() {
			return false;
		}
		self
			.entries
			.last()
			.is_some_and(|last| last.kind == EditKind::Typing && at.duration_since(last.at) < COALESCE)
	}

	/// The text as it stands, or `None` before anything has been recorded.
	#[must_use]
	pub fn current(&self) -> Option<&str> {
		self.entries.get(self.cursor).map(|entry| entry.text.as_str())
	}

	#[must_use]
	pub fn can_undo(&self) -> bool {
		self.cursor > 0
	}

	#[must_use]
	pub fn can_redo(&self) -> bool {
		self.cursor + 1 < self.entries.len()
	}

	/// Steps back, returning the state to restore.
	pub fn undo(&mut self) -> Option<&str> {
		if !self.can_undo() {
			return None;
		}
		self.cursor -= 1;
		self.current()
	}

	/// Steps forward again.
	pub fn redo(&mut self) -> Option<&str> {
		if !self.can_redo() {
			return None;
		}
		self.cursor += 1;
		self.current()
	}

	/// Forgets everything. For a document that is no longer the same document.
	pub fn clear(&mut self) {
		self.entries.clear();
		self.cursor = 0;
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn later(base: Instant, ms: u64) -> Instant {
		base + Duration::from_millis(ms)
	}

	#[test]
	fn nothing_to_undo_at_the_start() {
		let mut history = History::new();
		assert!(!history.can_undo() && !history.can_redo());
		assert_eq!(history.undo(), None);
		assert_eq!(history.redo(), None);
	}

	#[test]
	fn steps_back_and_forward_through_the_states() {
		let mut history = History::new();
		for text in ["a", "b", "c"] {
			history.push(text, EditKind::Structured);
		}
		assert_eq!(history.current(), Some("c"));
		assert_eq!(history.undo(), Some("b"));
		assert_eq!(history.undo(), Some("a"));
		assert!(!history.can_undo());
		assert_eq!(history.redo(), Some("b"));
		assert_eq!(history.redo(), Some("c"));
		assert!(!history.can_redo());
	}

	/// The usual model: there is one past, and editing after an undo forgets the branch you left.
	#[test]
	fn editing_after_an_undo_discards_the_redo_tail() {
		let mut history = History::new();
		for text in ["a", "b", "c"] {
			history.push(text, EditKind::Structured);
		}
		history.undo();
		assert!(history.can_redo());

		history.push("d", EditKind::Structured);
		assert!(!history.can_redo(), "the abandoned branch is gone");
		// The history is now a -> b -> d: undoing from d lands on b, the state it was edited from.
		assert_eq!(history.undo(), Some("b"));
		assert_eq!(history.undo(), Some("a"));
	}

	/// Without this, ⌘Z would step back one character at a time and be useless.
	#[test]
	fn a_run_of_typing_is_one_step() {
		let mut history = History::new();
		let start = Instant::now();
		history.push_at("f", EditKind::Typing, start);
		history.push_at("fr", EditKind::Typing, later(start, 80));
		history.push_at("fro", EditKind::Typing, later(start, 160));
		history.push_at("from", EditKind::Typing, later(start, 240));

		assert_eq!(history.current(), Some("from"));
		assert_eq!(history.undo(), None, "the whole burst collapsed into the first state");
	}

	/// A pause is a boundary — one thought per undo step.
	#[test]
	fn a_pause_in_typing_starts_a_new_step() {
		let mut history = History::new();
		let start = Instant::now();
		history.push_at("a", EditKind::Typing, start);
		history.push_at("ab", EditKind::Typing, later(start, 2000));

		assert_eq!(history.undo(), Some("a"));
	}

	/// A user who changes a value and presses ⌘Z means *that* value, not the paragraph before it.
	#[test]
	fn a_structured_edit_never_merges_into_typing() {
		let mut history = History::new();
		let start = Instant::now();
		history.push_at("a", EditKind::Typing, start);
		history.push_at("ab", EditKind::Structured, later(start, 10));
		history.push_at("abc", EditKind::Typing, later(start, 20));

		assert_eq!(history.undo(), Some("ab"));
		assert_eq!(history.undo(), Some("a"));
	}

	/// A re-render is not an edit. Without this, anything that reports the current text — a reload,
	/// a preview rebuild — would fill the stack with duplicates and undo would appear to do nothing.
	#[test]
	fn recording_the_same_text_twice_changes_nothing() {
		let mut history = History::new();
		history.push("a", EditKind::Structured);
		history.push("a", EditKind::Structured);
		history.push("a", EditKind::Typing);
		assert!(!history.can_undo());
	}

	#[test]
	fn the_stack_stays_bounded() {
		let mut history = History::new();
		for i in 0..(LIMIT + 50) {
			history.push(format!("v{i}"), EditKind::Structured);
		}
		assert_eq!(history.entries.len(), LIMIT);
		assert_eq!(history.current(), Some(format!("v{}", LIMIT + 49).as_str()));

		// And it is still coherent: undoing walks the states that remain.
		assert_eq!(history.undo(), Some(format!("v{}", LIMIT + 48).as_str()));
	}

	#[test]
	fn clearing_forgets_everything() {
		let mut history = History::new();
		history.push("a", EditKind::Structured);
		history.push("b", EditKind::Structured);
		history.clear();
		assert!(!history.can_undo() && !history.can_redo());
		assert_eq!(history.current(), None);
	}
}
