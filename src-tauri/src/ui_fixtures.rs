//! The real core's answers to the questions a page asks at start-up, for the UI suite's fake core.
//!
//! `ui/core.ts` stands in for the core in a browser. Its answers are typed against the bindings,
//! which catches a changed *shape* - but not a changed *value*: an operation added to the catalogue,
//! a pane added to the layout, an import kind renamed. So the answers that are the core's own data
//! rather than a project's are written out here, from the same functions the commands call, and
//! the test below fails when they are stale - the way `bindings.rs` does for the types.

#[cfg(test)]
mod tests {
	const OUTPUT: &str = "../ui/fixtures/core.json";

	/// The project the workbench's tests open: one source, OpenStreetMap read from
	/// download.versatiles.org - the same container the suite's `versatiles serve` draws its tiles from.
	const SOURCE: &str = "from_container filename=\"https://download.versatiles.org/osm.versatiles\"";

	fn generate() -> String {
		let mut graphs = studio_core::graphs::Graphs::new();
		let id = graphs.add(
			"osm",
			studio_core::vpl::Document::parse(SOURCE).expect("the source should parse"),
			None,
		);
		let history = studio_core::history::History::new();
		let graph = graphs.get(id).expect("the graph just added");

		let fixtures = serde_json::json!({
			"importKinds": crate::commands::vpl::import_kinds(),
			"vplOperations": crate::commands::vpl::vpl_operations(),
			"writableFormats": crate::commands::export::writable_formats(),
			"layout": studio_core::store::Layout::default().normalised(),
			"style": studio_core::style::Recipe::default(),
			"osm": {
				"graphs": graphs.list(),
				"graph": crate::commands::vpl::DocumentView::of(graph, &history),
			},
		});
		let mut text = serde_json::to_string_pretty(&fixtures).expect("the fixtures should serialise");
		text.push('\n');
		text
	}

	/// Regenerates the fixtures. Run with `UPDATE_UI_FIXTURES=1 cargo test -p versatiles-studio`.
	#[test]
	fn ui_fixtures_are_up_to_date() {
		let generated = generate();
		let path = std::path::Path::new(OUTPUT);
		let current = std::fs::read_to_string(path).unwrap_or_default();

		if current == generated {
			return;
		}
		if std::env::var_os("UPDATE_UI_FIXTURES").is_some() {
			std::fs::create_dir_all(path.parent().expect("a parent")).expect("creating ui/fixtures");
			std::fs::write(path, &generated).expect("writing the fixtures");
			return;
		}
		panic!(
			"{OUTPUT} is stale - the core's catalogue, layout or style changed.\n\
			 Run `UPDATE_UI_FIXTURES=1 cargo test -p versatiles-studio ui_fixtures` and commit the result."
		);
	}
}
