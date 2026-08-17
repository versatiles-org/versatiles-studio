//! What the syntax tree keeps that the semantic one throws away.
//!
//! `differential.rs` proves Studio agrees with upstream. These prove Studio keeps more — which is
//! the entire reason the parser was written twice.

use super::{Document, Quote, Span, Value};

/// A pipeline with something at risk in every direction: comments in three positions, parameters in
/// a deliberately unsorted order, all three quote styles, an array and a nested source.
const SAMPLE: &str = "# Berlin, vector only\n\
	from_container filename=\"berlin.versatiles\" # the input\n\
	| vector_filter zoom=14 layer='roads' bbox=[13.0,52.3,13.8,52.7]\n\
	| write filename=out.versatiles\n";

// -- losslessness ----------------------------------------------------------------------------

/// The whole point: parse then print is the identity, not an approximation of it.
#[test]
fn a_round_trip_changes_nothing() {
	let document = Document::parse(SAMPLE).unwrap();
	assert_eq!(document.text(), SAMPLE);
	assert_eq!(document.to_string(), SAMPLE);
}

#[test]
fn comments_survive_parsing() {
	let document = Document::parse(SAMPLE).unwrap();
	let texts: Vec<_> = document.comments().iter().map(|c| c.text.as_str()).collect();
	assert_eq!(texts, [" Berlin, vector only", " the input"]);

	// Each comment can be found again in the text it came from.
	for comment in document.comments() {
		let slice = document.slice(comment.span).unwrap();
		assert!(slice.starts_with('#'), "the span should cover the '#', got {slice:?}");
		assert!(slice.ends_with(&comment.text));
	}
}

/// The failure this guards is silent: upstream's `BTreeMap` sorts keys, so a document rewritten
/// through it comes back alphabetised, with the author's grouping gone and a noisy diff.
#[test]
fn parameter_order_is_the_authors_not_alphabetical() {
	let document = Document::parse("node zebra=1 alpha=2 middle=3").unwrap();
	let keys: Vec<_> = document.pipeline().nodes[0]
		.properties
		.iter()
		.map(|p| p.key.as_str())
		.collect();
	assert_eq!(keys, ["zebra", "alpha", "middle"], "source order, not sorted");

	// And upstream really would have sorted it — this is a live difference, not a hypothetical.
	let upstream: Vec<_> = document.to_pipeline().pipeline[0].properties.keys().cloned().collect();
	assert_eq!(upstream, ["alpha", "middle", "zebra"]);
}

#[test]
fn quote_style_is_remembered() {
	let document = Document::parse("node a=bare b='single' c=\"double\"").unwrap();
	let styles: Vec<_> = document.pipeline().nodes[0]
		.properties
		.iter()
		.map(|p| match &p.value {
			Value::Single(s) => s.quote,
			Value::Array { .. } => unreachable!(),
		})
		.collect();
	assert_eq!(styles, [Quote::None, Quote::Single, Quote::Double]);

	// Printing keeps each one, so reformatting does not rewrite the author's quoting.
	assert_eq!(document.pipeline().to_string(), "node a=bare b='single' c=\"double\"");
}

// -- spans -----------------------------------------------------------------------------------

#[test]
fn every_span_points_back_at_the_text_it_came_from() {
	let document = Document::parse(SAMPLE).unwrap();
	let node = &document.pipeline().nodes[1];

	assert_eq!(document.slice(node.name_span).unwrap(), "vector_filter");
	assert_eq!(document.slice(node.properties[0].key_span).unwrap(), "zoom");
	assert_eq!(document.slice(node.properties[1].value.span()).unwrap(), "'roads'");
	assert_eq!(
		document.slice(node.properties[2].value.span()).unwrap(),
		"[13.0,52.3,13.8,52.7]"
	);
	assert!(document.slice(node.span).unwrap().starts_with("vector_filter"));
}

/// Multi-byte characters are where a parser that counts characters instead of bytes falls over.
#[test]
fn spans_are_byte_offsets_and_survive_multibyte_text() {
	let document = Document::parse("node a=\"Grüße\" b=\"日本語\"").unwrap();
	let properties = &document.pipeline().nodes[0].properties;
	assert_eq!(document.slice(properties[0].value.span()).unwrap(), "\"Grüße\"");
	assert_eq!(document.slice(properties[1].value.span()).unwrap(), "\"日本語\"");
	assert_eq!(properties[1].value.strings(), ["日本語"]);
}

/// Selection sync (S2.5): a caret anywhere in the text names exactly one node.
#[test]
fn an_offset_resolves_to_the_node_written_around_it() {
	let text = "merge [ read | write, from_container filename=x ] | tile_convert";
	let document = Document::parse(text).unwrap();

	let node_at = |needle: &str| {
		let offset = text.find(needle).unwrap();
		document
			.pipeline()
			.node_at(offset)
			.map(|(path, node)| (path, node.name.clone()))
	};

	assert_eq!(node_at("merge"), Some((vec![0], "merge".to_string())));
	assert_eq!(node_at("read"), Some((vec![0, 0, 0], "read".to_string())));
	assert_eq!(node_at("write"), Some((vec![0, 0, 1], "write".to_string())));
	assert_eq!(
		node_at("from_container"),
		Some((vec![0, 1, 0], "from_container".to_string()))
	);
	assert_eq!(node_at("tile_convert"), Some((vec![1], "tile_convert".to_string())));

	// The path is an address: it finds the same node again.
	let (path, found) = document.pipeline().node_at(text.find("filename").unwrap()).unwrap();
	assert_eq!(document.pipeline().node_at_path(&path).unwrap().name, found.name);
	assert_eq!(found.property("filename"), ["x"]);
}

#[test]
fn line_and_column_are_one_based_and_counted_in_characters() {
	let document = Document::parse("read\n| write filename=\"Grüße\"").unwrap();
	assert_eq!(document.line_col(0).line, 1);
	assert_eq!(document.line_col(0).column, 1);

	let offset = document.text().find("write").unwrap();
	let position = document.line_col(offset);
	assert_eq!((position.line, position.column), (2, 3));

	// After the multi-byte characters the column must not have run ahead of the character count.
	let end = document.line_col(document.text().len());
	assert_eq!(end.line, 2);
	assert_eq!(end.column, document.text().lines().nth(1).unwrap().chars().count() + 1);
}

// -- errors ----------------------------------------------------------------------------------

/// C4 wants the error under the right character. Upstream returns a rendered multi-line trace with
/// no offsets at all, which an editor cannot place.
#[test]
fn errors_carry_the_position_of_the_problem() {
	let text = "from_container filename=a | vector_filter zoom";
	let error = Document::parse(text).unwrap_err();
	assert_eq!(error.span.start, text.len(), "the '=' is missing at the very end");
	assert!(error.message.contains("zoom"), "got {:?}", error.message);

	let error = Document::parse("merge [ read").unwrap_err();
	assert!(error.message.contains(']'), "got {:?}", error.message);

	// Positioned inside a multi-byte line, the offset still slices cleanly.
	let text = "node a=\"Grüße\" | bad!";
	let error = Document::parse(text).unwrap_err();
	assert!(text.get(error.span.start..error.span.end).is_some());
}

// -- editing ---------------------------------------------------------------------------------

/// A structured edit rewrites one span, so everything around it — comments included — is untouched
/// because it was never re-rendered.
#[test]
fn an_edit_touches_only_its_own_span() {
	let mut document = Document::parse(SAMPLE).unwrap();
	let span = document.pipeline().nodes[1].properties[0].value.span();
	document.replace(span, "12").unwrap();

	assert!(document.text().contains("zoom=12"));
	assert!(document.text().contains("# Berlin, vector only"));
	assert!(document.text().contains("# the input"));
	assert!(document.text().contains("layer='roads'"), "the neighbour is unchanged");
	assert_eq!(document.comments().len(), 2);
	assert_eq!(document.pipeline().nodes[1].property("zoom"), ["12"]);
}

/// The same discipline as `Bookmarks::load`: a refused change leaves the document alone.
#[test]
fn a_rejected_edit_leaves_the_document_exactly_as_it_was() {
	let mut document = Document::parse(SAMPLE).unwrap();
	let before = document.clone();
	let span = document.pipeline().nodes[1].properties[0].value.span();

	let error = document.replace(span, "=\"broken").unwrap_err();
	assert!(!error.message.is_empty());
	assert_eq!(document, before, "a failed edit must not half-apply");
	assert_eq!(document.text(), SAMPLE);
}

#[test]
fn a_stale_span_is_refused_rather_than_panicking() {
	let mut document = Document::parse("read").unwrap();
	assert!(document.replace(Span::new(0, 9999), "write").is_err());
	assert!(document.slice(Span::new(0, 9999)).is_none());
	assert_eq!(document.text(), "read");
}

// -- printing synthesised trees ----------------------------------------------------------------

/// Values built by the graph editor have no original text, so quoting has to be derived. The rule
/// is "least punctuation that parses back", and the grammar forces two exceptions.
#[test]
fn synthesised_values_get_the_least_quoting_that_still_parses() {
	use super::quote_value;

	let quoted = |v: &str| quote_value(v).expect("expressible");
	assert_eq!(quoted("plain"), "plain");
	assert_eq!(quoted("13.405"), "13.405");
	assert_eq!(quoted("a-b_c.d"), "a-b_c.d");
	assert_eq!(quoted("with space"), "'with space'");
	assert_eq!(quoted("/path/to/file"), "'/path/to/file'");

	// Single quotes need no escaping, so they stay the cheaper option even for a value full of
	// double quotes. Only an apostrophe forces the expensive form.
	assert_eq!(quoted("say \"hi\""), "'say \"hi\"'");
	assert_eq!(quoted("it's"), "\"it's\"");
	assert_eq!(quoted("it's \"both\""), "\"it's \\\"both\\\"\"");
	assert_eq!(quoted("line\nbreak"), "'line\nbreak'");

	// Every one of them parses back to exactly what went in — which is the only property that
	// actually matters here.
	for value in [
		"plain",
		"with space",
		"it's",
		"say \"hi\"",
		"it's \"both\"",
		"line\nbreak",
		"tab\there",
		"a\\b",
		"Grüße",
	] {
		let text = format!("node a={}", quoted(value));
		let document =
			Document::parse(&text).unwrap_or_else(|e| panic!("{value:?} printed as {text:?} did not parse back: {e}"));
		assert_eq!(document.pipeline().nodes[0].property("a"), [value.to_string()]);
	}
}

/// The one value VPL has no syntax for at all.
///
/// This is a real limitation with a real consequence for the parameter forms (S2.6): clearing a
/// field cannot mean "set it to empty", because that state does not exist. It has to mean "remove
/// the parameter". `None` is how the printer refuses to guess.
#[test]
fn the_empty_string_has_no_spelling_and_is_reported_rather_than_faked() {
	use super::quote_value;

	assert_eq!(quote_value(""), None);
	assert!(Document::parse("node a=\"\"").is_err());
	assert!(Document::parse("node a=''").is_err());
}
