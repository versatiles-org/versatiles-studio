//! One undo stack for the whole project (S2.8, S4.7, G6).
//!
//! Undo belongs to the *document*, not to any one view of it ([Q11], [Q25]). The text editor, the
//! parameter forms and the graph all change the same pipeline, so a stack per view would mean
//! ⌘Z doing something different depending on where the focus happened to be - and no way at all to
//! undo a form change from the text tab.
//!
//! **The style is on it too**, not on a second one ([Q36]). It is a different document, but it is
//! not a different kind of thing: a small text that a user changes and expects ⌘Z to walk back. The
//! only generalisation it needed was [`Target`] - every rule below already handled documents that
//! interleave, because several graphs do.
//!
//! **Snapshots, not inverse edits.** A pipeline is a few hundred bytes, so a hundred of them costs
//! less than a single map tile. Storing the text is exact by construction; deriving an inverse for
//! every kind of edit is a source of bugs that buys nothing at this size.
//!
//! [Q11]: ../../docs/decisions.md
//! [Q25]: ../../docs/decisions.md
//! [Q36]: ../../docs/decisions.md

use crate::graphs::GraphId;
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
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum EditKind {
	/// A keystroke in the VPL editor. Consecutive ones merge.
	Typing,
	/// A parameter form or the graph - a deliberate, discrete change. The default, because it is
	/// the conservative one: a caller that says nothing gets its own undo step.
	#[default]
	Structured,
	/// The document was replaced wholesale, e.g. by opening a file.
	Replaced,
}

/// What a state belongs to.
///
/// A project holds several graphs ([Q32](../../docs/decisions.md)) *and* one style recipe
/// ([Q36](../../docs/decisions.md)), and G6 wants one ⌘Z across all of them. They are the same kind
/// of thing as far as this module is concerned: a named document whose whole text is small enough to
/// snapshot. Q36 is what makes the second half of that true - the core stores what the style is made
/// from, not the 125 kB it renders to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
	/// One graph's VPL, by id.
	Graph(GraphId),
	/// The project's style recipe. There is one, so it needs no id.
	Style,
}

#[derive(Debug, Clone)]
struct Entry {
	/// Which document this state belongs to.
	target: Target,
	text: String,
	kind: EditKind,
	at: Instant,
}

/// What an undo or redo asks the caller to restore.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
	pub target: Target,
	pub text: String,
}

/// The project's edit history - **one stack across every graph**.
///
/// [G6](../../docs/features.md) wants ⌘Z to undo the last thing you did, not the last thing you did
/// *in this graph*; a stack per graph would make undo depend on which graph happens to be selected,
/// which is the same surprise as an editor whose undo depends on which pane has focus.
///
/// That makes stepping back less obvious than it looks. An entry records only the graph that
/// changed, so undoing it means restoring **that graph's previous entry**, not the entry before it
/// in the stack - which may belong to a different graph entirely and must be left alone. Every graph
/// therefore gets a baseline entry when it is added, so a predecessor always exists.
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
	/// Editing after undoing abandons the branch that was undone - the usual and expected model:
	/// there is one past, and stepping off it forgets the future you stepped away from.
	pub fn push(&mut self, target: Target, text: impl Into<String>, kind: EditKind) {
		self.push_at(target, text, kind, Instant::now());
	}

	/// [`push`](Self::push) with the clock supplied, so coalescing can be tested without sleeping.
	pub fn push_at(&mut self, target: Target, text: impl Into<String>, kind: EditKind, at: Instant) {
		let text = text.into();
		if self.current_of(target) == Some(text.as_str()) {
			return; // nothing changed; a re-render is not an edit
		}

		self.entries.truncate(self.cursor + 1);

		let merge = self.should_merge(target, kind, at);
		if let (true, Some(last)) = (merge, self.entries.last_mut()) {
			last.text = text;
			last.at = at;
			return;
		}

		self.entries.push(Entry { target, text, kind, at });
		if self.entries.len() > LIMIT {
			self.entries.remove(0);
		}
		self.cursor = self.entries.len() - 1;
	}

	/// A run of typing merges; anything else stands alone.
	///
	/// **In the same graph.** Typing here, then typing there, is two edits however fast it happened -
	/// merging them would produce one undo step that changes two documents.
	fn should_merge(&self, target: Target, kind: EditKind, at: Instant) -> bool {
		if kind != EditKind::Typing || self.entries.is_empty() {
			return false;
		}
		self.entries.last().is_some_and(|last| {
			last.target == target && last.kind == EditKind::Typing && at.duration_since(last.at) < COALESCE
		})
	}

	/// The text of `graph` as it stands, or `None` if it has nothing recorded up to the cursor.
	#[must_use]
	pub fn current_of(&self, target: Target) -> Option<&str> {
		self.latest(target, self.cursor + 1)
	}

	/// The most recent text for `graph` among the first `upto` entries.
	fn latest(&self, target: Target, upto: usize) -> Option<&str> {
		self.entries[..upto.min(self.entries.len())]
			.iter()
			.rev()
			.find(|entry| entry.target == target)
			.map(|entry| entry.text.as_str())
	}

	#[must_use]
	pub fn can_undo(&self) -> bool {
		self.undo_step().is_some()
	}

	#[must_use]
	pub fn can_redo(&self) -> bool {
		self.cursor + 1 < self.entries.len()
	}

	/// What undoing would restore, without doing it.
	fn undo_step(&self) -> Option<Step> {
		if self.cursor == 0 {
			return None;
		}
		let target = self.entries.get(self.cursor)?.target;
		// The state to go back to is this graph's *previous* entry - not the stack's, which may
		// belong to another graph and must be left where it is.
		self.latest(target, self.cursor).map(|text| Step {
			target,
			text: text.to_string(),
		})
	}

	/// Steps back, returning the graph to restore and the text to restore it to.
	pub fn undo(&mut self) -> Option<Step> {
		let step = self.undo_step()?;
		self.cursor -= 1;
		Some(step)
	}

	/// Steps forward again.
	pub fn redo(&mut self) -> Option<Step> {
		if !self.can_redo() {
			return None;
		}
		self.cursor += 1;
		let entry = self.entries.get(self.cursor)?;
		Some(Step {
			target: entry.target,
			text: entry.text.clone(),
		})
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
	/// The graph these single-graph tests all edit. Multi-graph behaviour has its own tests below.
	const G: Target = Target::Graph(1);

	/// `undo`/`redo` hand back the graph as well as the text; most of these only look at the text.
	trait StepText {
		fn text(&self) -> Option<&str>;
	}
	impl StepText for Option<Step> {
		fn text(&self) -> Option<&str> {
			self.as_ref().map(|step| step.text.as_str())
		}
	}

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
			history.push(G, text, EditKind::Structured);
		}
		assert_eq!(history.current_of(G), Some("c"));
		assert_eq!(history.undo().text(), Some("b"));
		assert_eq!(history.undo().text(), Some("a"));
		assert!(!history.can_undo());
		assert_eq!(history.redo().text(), Some("b"));
		assert_eq!(history.redo().text(), Some("c"));
		assert!(!history.can_redo());
	}

	/// The usual model: there is one past, and editing after an undo forgets the branch you left.
	#[test]
	fn editing_after_an_undo_discards_the_redo_tail() {
		let mut history = History::new();
		for text in ["a", "b", "c"] {
			history.push(G, text, EditKind::Structured);
		}
		history.undo();
		assert!(history.can_redo());

		history.push(G, "d", EditKind::Structured);
		assert!(!history.can_redo(), "the abandoned branch is gone");
		// The history is now a -> b -> d: undoing from d lands on b, the state it was edited from.
		assert_eq!(history.undo().text(), Some("b"));
		assert_eq!(history.undo().text(), Some("a"));
	}

	/// Without this, ⌘Z would step back one character at a time and be useless.
	#[test]
	fn a_run_of_typing_is_one_step() {
		let mut history = History::new();
		let start = Instant::now();
		history.push_at(G, "f", EditKind::Typing, start);
		history.push_at(G, "fr", EditKind::Typing, later(start, 80));
		history.push_at(G, "fro", EditKind::Typing, later(start, 160));
		history.push_at(G, "from", EditKind::Typing, later(start, 240));

		assert_eq!(history.current_of(G), Some("from"));
		assert_eq!(history.undo(), None, "the whole burst collapsed into the first state");
	}

	/// A pause is a boundary - one thought per undo step.
	#[test]
	fn a_pause_in_typing_starts_a_new_step() {
		let mut history = History::new();
		let start = Instant::now();
		history.push_at(G, "a", EditKind::Typing, start);
		history.push_at(G, "ab", EditKind::Typing, later(start, 2000));

		assert_eq!(history.undo().text(), Some("a"));
	}

	/// A user who changes a value and presses ⌘Z means *that* value, not the paragraph before it.
	#[test]
	fn a_structured_edit_never_merges_into_typing() {
		let mut history = History::new();
		let start = Instant::now();
		history.push_at(G, "a", EditKind::Typing, start);
		history.push_at(G, "ab", EditKind::Structured, later(start, 10));
		history.push_at(G, "abc", EditKind::Typing, later(start, 20));

		assert_eq!(history.undo().text(), Some("ab"));
		assert_eq!(history.undo().text(), Some("a"));
	}

	/// A re-render is not an edit. Without this, anything that reports the current text - a reload,
	/// a preview rebuild - would fill the stack with duplicates and undo would appear to do nothing.
	#[test]
	fn recording_the_same_text_twice_changes_nothing() {
		let mut history = History::new();
		history.push(G, "a", EditKind::Structured);
		history.push(G, "a", EditKind::Structured);
		history.push(G, "a", EditKind::Typing);
		assert!(!history.can_undo());
	}

	#[test]
	fn the_stack_stays_bounded() {
		let mut history = History::new();
		for i in 0..(LIMIT + 50) {
			history.push(G, format!("v{i}"), EditKind::Structured);
		}
		assert_eq!(history.entries.len(), LIMIT);
		assert_eq!(history.current_of(G), Some(format!("v{}", LIMIT + 49).as_str()));

		// And it is still coherent: undoing walks the states that remain.
		assert_eq!(history.undo().text(), Some(format!("v{}", LIMIT + 48).as_str()));
	}

	#[test]
	fn clearing_forgets_everything() {
		let mut history = History::new();
		history.push(G, "a", EditKind::Structured);
		history.push(G, "b", EditKind::Structured);
		history.clear();
		assert!(!history.can_undo() && !history.can_redo());
		assert_eq!(history.current_of(G), None);
	}

	// -- several graphs, one stack ([Q32]) -------------------------------------------------------

	const H: Target = Target::Graph(2);

	/// G6: ⌘Z undoes the last thing you did, not the last thing you did *here*. So a stack shared
	/// between graphs has to hand back which graph to restore, not only the text.
	#[test]
	fn undo_crosses_graphs_and_says_which_one() {
		let mut history = History::new();
		history.push(G, "g1", EditKind::Structured);
		history.push(H, "h1", EditKind::Structured);
		history.push(G, "g2", EditKind::Structured);
		history.push(H, "h2", EditKind::Structured);

		assert_eq!(
			history.undo(),
			Some(Step {
				target: H,
				text: "h1".into()
			})
		);
		assert_eq!(
			history.undo(),
			Some(Step {
				target: G,
				text: "g1".into()
			})
		);
		assert_eq!(history.undo(), None, "each graph is back at its first recorded state");
	}

	/// The subtle one, and the reason an entry cannot just step back one slot: the entry before
	/// `g2` in the stack belongs to `H`, and restoring *that* text into `G` would be nonsense.
	#[test]
	fn undoing_restores_the_graphs_own_previous_state() {
		let mut history = History::new();
		history.push(G, "from_debug format=png", EditKind::Structured);
		history.push(H, "from_debug format=webp", EditKind::Structured);
		history.push(G, "from_debug format=png | raster_flatten", EditKind::Structured);

		let step = history.undo().expect("something to undo");
		assert_eq!(step.target, G);
		assert_eq!(
			step.text, "from_debug format=png",
			"restored G's own previous text, not H's"
		);
		assert_eq!(history.current_of(H).unwrap(), "from_debug format=webp", "H untouched");
	}

	#[test]
	fn redo_returns_to_the_graph_it_came_from() {
		let mut history = History::new();
		history.push(G, "g1", EditKind::Structured);
		history.push(H, "h1", EditKind::Structured);
		history.push(G, "g2", EditKind::Structured);

		history.undo();
		assert_eq!(
			history.redo(),
			Some(Step {
				target: G,
				text: "g2".into()
			})
		);
		assert_eq!(history.redo(), None);
	}

	/// Typing in one graph and then in another is two edits however fast it happened - merging
	/// them would make one undo step change two documents.
	#[test]
	fn typing_does_not_merge_across_graphs() {
		let mut history = History::new();
		let start = Instant::now();
		// The baseline every graph gets when it is added.
		history.push(G, "g0", EditKind::Replaced);
		history.push(H, "h0", EditKind::Replaced);

		history.push_at(G, "a", EditKind::Typing, start);
		history.push_at(H, "b", EditKind::Typing, later(start, 20));
		history.push_at(H, "bc", EditKind::Typing, later(start, 40));

		// H's two keystrokes merged into one step; G's is its own, untouched by it.
		assert_eq!(
			history.undo(),
			Some(Step {
				target: H,
				text: "h0".into()
			}),
			"H falls back to its baseline in one step"
		);
		assert_eq!(history.current_of(G).unwrap(), "a");
	}

	/// A graph nobody has touched has nothing to restore, and asking is not an error.
	#[test]
	fn a_graph_with_no_entries_has_no_current_text() {
		let mut history = History::new();
		history.push(G, "g1", EditKind::Structured);
		assert_eq!(history.current_of(H), None);
	}

	/// The contract the baseline exists for, and the one this author got wrong first time. A
	/// graph's *first* recorded state has nothing before it, so undo stops there rather than
	/// reaching back into another graph's edit and restoring it into the wrong document. Adding a
	/// graph pushes its starting text for exactly this reason.
	#[test]
	fn undo_stops_at_a_graphs_first_state_rather_than_borrowing_anothers() {
		let mut history = History::new();
		history.push(G, "g1", EditKind::Structured);
		history.push(H, "h1", EditKind::Structured);

		assert!(!history.can_undo(), "H has no earlier state of its own");
		assert_eq!(history.undo(), None);
		assert_eq!(history.current_of(G).unwrap(), "g1", "and G was not disturbed");
	}
	/// **The claim S4.7 makes**: one ⌘Z across the style and the graphs, not one per document.
	///
	/// Interleaved deliberately. Undo after a style edit must restore the style and leave the graph
	/// where it is, and the step after that must reach back past the style edit to the graph's own
	/// previous state - which is the same rule that already governs two graphs, now that a style is
	/// just another target.
	#[test]
	fn the_style_and_the_graphs_share_one_stack() {
		let mut history = History::new();
		history.push(G, "from_debug", EditKind::Structured);
		history.push(Target::Style, r#"{"preset":"colorful"}"#, EditKind::Structured);
		history.push(G, "from_debug | filter", EditKind::Structured);
		history.push(Target::Style, r#"{"preset":"graybeard"}"#, EditKind::Structured);

		// Back over the style edit.
		let step = history.undo().unwrap();
		assert_eq!(step.target, Target::Style);
		assert_eq!(step.text, r#"{"preset":"colorful"}"#);

		// Back over the graph edit, which the style edits in between must not have disturbed.
		let step = history.undo().unwrap();
		assert_eq!(step.target, G);
		assert_eq!(step.text, "from_debug");

		// And forward again, in the order it happened.
		assert_eq!(history.redo().unwrap().target, G);
		assert_eq!(history.redo().unwrap().target, Target::Style);
	}

	/// Typing in the editor coalesces; a style edit never merges into it, however quickly it
	/// follows. Two documents in one undo step is exactly what the coalescing rule exists to stop.
	///
	/// **The style is given a baseline first, and it has to be.** Undo restores a target's
	/// *previous* entry, so a target whose first edit is also its first entry has nothing to go back
	/// to - the same reason every graph is recorded when it is added. Writing this test without one
	/// is what showed the style needs the same treatment.
	#[test]
	fn a_style_edit_never_merges_into_a_run_of_typing() {
		let mut history = History::new();
		let start = Instant::now();
		history.push_at(Target::Style, r#"{"preset":"colorful"}"#, EditKind::Replaced, start);
		history.push_at(G, "from_", EditKind::Typing, later(start, 10));
		history.push_at(G, "from_d", EditKind::Typing, later(start, 20));
		history.push_at(
			Target::Style,
			r#"{"preset":"shadow"}"#,
			EditKind::Typing,
			later(start, 30),
		);

		let step = history.undo().unwrap();
		assert_eq!(step.target, Target::Style);
		assert_eq!(
			step.text, r#"{"preset":"colorful"}"#,
			"the style goes back to its own last state"
		);
		assert_eq!(
			history.current_of(G),
			Some("from_d"),
			"the run of typing was not swallowed into the style's edit"
		);
	}
}
