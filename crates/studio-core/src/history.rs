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
	/// A parameter form or the graph — a deliberate, discrete change. The default, because it is
	/// the conservative one: a caller that says nothing gets its own undo step.
	#[default]
	Structured,
	/// The document was replaced wholesale, e.g. by opening a file.
	Replaced,
}

#[derive(Debug, Clone)]
struct Entry {
	/// Which graph this state belongs to ([Q32](../../docs/decisions.md)).
	graph: GraphId,
	text: String,
	kind: EditKind,
	at: Instant,
}

/// What an undo or redo asks the caller to restore.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
	pub graph: GraphId,
	pub text: String,
}

/// The project's edit history — **one stack across every graph**.
///
/// [G6](../../docs/features.md) wants ⌘Z to undo the last thing you did, not the last thing you did
/// *in this graph*; a stack per graph would make undo depend on which graph happens to be selected,
/// which is the same surprise as an editor whose undo depends on which pane has focus.
///
/// That makes stepping back less obvious than it looks. An entry records only the graph that
/// changed, so undoing it means restoring **that graph's previous entry**, not the entry before it
/// in the stack — which may belong to a different graph entirely and must be left alone. Every graph
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
	/// Editing after undoing abandons the branch that was undone — the usual and expected model:
	/// there is one past, and stepping off it forgets the future you stepped away from.
	pub fn push(&mut self, graph: GraphId, text: impl Into<String>, kind: EditKind) {
		self.push_at(graph, text, kind, Instant::now());
	}

	/// [`push`](Self::push) with the clock supplied, so coalescing can be tested without sleeping.
	pub fn push_at(&mut self, graph: GraphId, text: impl Into<String>, kind: EditKind, at: Instant) {
		let text = text.into();
		if self.current_of(graph) == Some(text.as_str()) {
			return; // nothing changed; a re-render is not an edit
		}

		self.entries.truncate(self.cursor + 1);

		let merge = self.should_merge(graph, kind, at);
		if let (true, Some(last)) = (merge, self.entries.last_mut()) {
			last.text = text;
			last.at = at;
			return;
		}

		self.entries.push(Entry { graph, text, kind, at });
		if self.entries.len() > LIMIT {
			self.entries.remove(0);
		}
		self.cursor = self.entries.len() - 1;
	}

	/// A run of typing merges; anything else stands alone.
	///
	/// **In the same graph.** Typing here, then typing there, is two edits however fast it happened —
	/// merging them would produce one undo step that changes two documents.
	fn should_merge(&self, graph: GraphId, kind: EditKind, at: Instant) -> bool {
		if kind != EditKind::Typing || self.entries.is_empty() {
			return false;
		}
		self.entries.last().is_some_and(|last| {
			last.graph == graph && last.kind == EditKind::Typing && at.duration_since(last.at) < COALESCE
		})
	}

	/// The text of `graph` as it stands, or `None` if it has nothing recorded up to the cursor.
	#[must_use]
	pub fn current_of(&self, graph: GraphId) -> Option<&str> {
		self.latest(graph, self.cursor + 1)
	}

	/// The most recent text for `graph` among the first `upto` entries.
	fn latest(&self, graph: GraphId, upto: usize) -> Option<&str> {
		self.entries[..upto.min(self.entries.len())]
			.iter()
			.rev()
			.find(|entry| entry.graph == graph)
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
		let graph = self.entries.get(self.cursor)?.graph;
		// The state to go back to is this graph's *previous* entry — not the stack's, which may
		// belong to another graph and must be left where it is.
		self.latest(graph, self.cursor).map(|text| Step {
			graph,
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
			graph: entry.graph,
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
	use crate::graphs::GraphId;

	/// The graph these single-graph tests all edit. Multi-graph behaviour has its own tests below.
	const G: GraphId = 1;

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

	/// A pause is a boundary — one thought per undo step.
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

	/// A re-render is not an edit. Without this, anything that reports the current text — a reload,
	/// a preview rebuild — would fill the stack with duplicates and undo would appear to do nothing.
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

	const H: GraphId = 2;

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
				graph: H,
				text: "h1".into()
			})
		);
		assert_eq!(
			history.undo(),
			Some(Step {
				graph: G,
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
		assert_eq!(step.graph, G);
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
				graph: G,
				text: "g2".into()
			})
		);
		assert_eq!(history.redo(), None);
	}

	/// Typing in one graph and then in another is two edits however fast it happened — merging
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
				graph: H,
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
}
