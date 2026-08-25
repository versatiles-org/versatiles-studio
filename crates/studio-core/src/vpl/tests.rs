//! What the syntax tree keeps that the semantic one throws away.
//!
//! There is no longer anything to agree *with*: 4.8.0's `CstFile` is the parser, and Studio's own -
//! along with the differential test that kept the two honest - is deleted ([Q23]). These prove that
//! what the lossless tree keeps survives a round trip through Studio's editing operations, which is
//! the property the graph and the text editor both rest on.
//!
//! [Q23]: ../../../docs/decisions.md

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

	// And upstream really would have sorted it - this is a live difference, not a hypothetical.
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

	// The document renders from the tree, so the author's quoting comes back verbatim.
	assert_eq!(document.text(), "node a=bare b='single' c=\"double\"");
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

/// C4 wants the error under the right character.
///
/// This used to be Studio's own work, because `parse_vpl` rendered a multi-line trace with no
/// offsets. Since 4.8.0 the position comes from upstream - issue #217 - so what is checked here is
/// that Studio passes it through intact rather than that Studio computed it.
#[test]
fn errors_carry_the_position_of_the_problem() {
	let text = "from_container filename=a | vector_filter zoom";
	let error = Document::parse(text).unwrap_err();
	assert_eq!(error.span.start, text.len(), "the '=' is missing at the very end");
	assert!(
		error.message.contains('='),
		"should say what was expected: {:?}",
		error.message
	);

	let error = Document::parse("merge [ read").unwrap_err();
	assert!(error.message.contains(']'), "got {:?}", error.message);

	// Positioned inside a multi-byte line, the offset still slices cleanly.
	let text = "node a=\"Grüße\" | bad!";
	let error = Document::parse(text).unwrap_err();
	assert!(text.get(error.span.start..error.span.end).is_some());
}

// -- editing ---------------------------------------------------------------------------------

/// A structured edit rewrites one span, so everything around it - comments included - is untouched
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

/// Quoting is the tree's job now, exercised through the values Studio actually writes.
#[test]
fn values_are_quoted_by_the_tree_with_the_least_punctuation_that_parses() {
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
		"",
	] {
		let mut document = Document::parse("node a=old").unwrap();
		let span = document.pipeline().nodes[0].properties[0].value.span();
		document.set_value(span, value).unwrap();
		assert_eq!(
			document.pipeline().nodes[0].property("a"),
			[value.to_string()],
			"{value:?} did not survive being written as {:?}",
			document.text()
		);
		Document::parse(document.text()).unwrap_or_else(|e| panic!("{:?} did not parse back: {e}", document.text()));
	}
}

/// The empty string, which VPL could not express until 4.8.0 closed
/// [#218](https://github.com/versatiles-org/versatiles-rs/issues/218).
///
/// Studio reported this upstream, so the behaviour it now has to match is the one it asked for.
/// Clearing a form field still *removes* the parameter (S2.6) - an empty filename is not a value
/// anyone means - but that is now a decision about the interface rather than a limit of the syntax.
#[test]
fn an_empty_string_is_a_value_like_any_other() {
	for text in ["node a=\"\"", "node a=''", r#"node a=["", x]"#] {
		let document = Document::parse(text).unwrap_or_else(|e| panic!("{text:?} should parse now: {e}"));
		assert!(document.pipeline().nodes[0].property("a").iter().any(String::is_empty));
	}
}

/// Opening a container is the same thing as putting a read node at the head of the pipeline (Q22),
/// so the node Studio shows has to be VPL that actually parses - including for the awkward paths
/// people really have.
#[test]
fn an_opened_container_becomes_a_read_node() {
	use super::read_node;

	assert_eq!(
		read_node("from_container", "berlin.versatiles"),
		"from_container filename=berlin.versatiles"
	);
	assert_eq!(
		read_node("from_container", "/data/My Tiles/berlin.versatiles"),
		"from_container filename='/data/My Tiles/berlin.versatiles'"
	);
	assert_eq!(
		read_node("from_container", "/data/it's here.versatiles"),
		"from_container filename=\"/data/it's here.versatiles\""
	);

	// The operation is whichever the import catalogue chose, so a GeoJSON reads as one too (S3.2).
	assert_eq!(
		read_node("from_geo", "cities.geojson"),
		"from_geo filename=cities.geojson"
	);

	for source in [
		"berlin.versatiles",
		"/data/My Tiles/berlin.versatiles",
		"/data/it's here.versatiles",
		"https://download.versatiles.org/osm.versatiles",
		"/data/Grüße.versatiles",
	] {
		let vpl = read_node("from_container", source);
		let document = Document::parse(&vpl).unwrap_or_else(|e| panic!("{vpl:?} did not parse: {e}"));
		assert_eq!(
			document.pipeline().nodes[0].property("filename"),
			[source.to_string()],
			"the path must survive the round trip intact"
		);
	}
}

// -- editing values ----------------------------------------------------------------------------

/// What a parameter form does: hand over the string the user typed and let the core quote it.
#[test]
fn setting_a_value_quotes_it_for_the_caller() {
	let cases = [
		("plain", "node a=plain"),
		("with space", "node a='with space'"),
		("/data/My Tiles/x.versatiles", "node a='/data/My Tiles/x.versatiles'"),
		("it's", "node a=\"it's\""),
	];
	for (typed, expected) in cases {
		let mut document = Document::parse("node a=old").unwrap();
		let span = document.pipeline().nodes[0].properties[0].value.span();
		document.set_value(span, typed).unwrap();
		assert_eq!(document.text(), expected);
		assert_eq!(document.pipeline().nodes[0].property("a"), [typed.to_string()]);
	}
}

/// The neighbours, and the comments, are not re-rendered - they are never touched.
#[test]
fn setting_a_value_leaves_the_rest_of_the_line_alone() {
	let mut document = Document::parse("# note\nnode zebra=1 alpha=2 # trailing").unwrap();
	let span = document.pipeline().nodes[0].properties[1].value.span();
	document.set_value(span, "changed").unwrap();

	assert_eq!(document.text(), "# note\nnode zebra=1 alpha=changed # trailing");
	assert_eq!(document.comments().len(), 2);
}

#[test]
fn removing_a_property_takes_its_separator_with_it() {
	// middle, last and only - the three positions where a stray space could survive.
	for (source, index, expected) in [
		("node a=1 b=2 c=3", 1, "node a=1 c=3"),
		("node a=1 b=2", 1, "node a=1"),
		("node a=1", 0, "node"),
	] {
		let mut document = Document::parse(source).unwrap();
		let span = document.pipeline().nodes[0].properties[index].span;
		document.remove_property(span).unwrap();
		assert_eq!(document.text(), expected, "removing property {index} of {source:?}");
	}
}

/// An edit is a splice, so a span taken before it is stale afterwards. Nothing may panic on one.
#[test]
fn spans_from_before_an_edit_are_refused_not_obeyed() {
	let mut document = Document::parse("node a=verylongvalue").unwrap();
	let stale = document.pipeline().nodes[0].properties[0].value.span();
	document.set_value(stale, "x").unwrap();

	// The document is now much shorter; the old span runs past its end.
	assert!(document.set_value(stale, "y").is_err() || document.text().len() >= stale.end);
	assert!(document.slice(Span::new(0, 9999)).is_none());
}

// -- highlighting ------------------------------------------------------------------------------

/// The editor paints from the tree, not from a second tokeniser (Q25) - so every token has to line
/// up with the text it claims, and nothing may be left unclassified but whitespace.
#[test]
fn tokens_cover_the_document_and_say_what_each_part_is() {
	use super::TokenKind::{Comment, Key, Operation, Punctuation, Value};

	let text = "# note\nfrom_container filename='a b' | vector_filter zoom=[1,2]";
	let document = Document::parse(text).unwrap();
	let tokens = document.tokens();

	let seen: Vec<_> = tokens
		.iter()
		.map(|t| (t.kind, document.slice(t.span).unwrap()))
		.collect();
	assert_eq!(
		seen,
		[
			(Comment, "# note"),
			(Operation, "from_container"),
			(Key, "filename"),
			(Punctuation, "="),
			(Value, "'a b'"),
			(Punctuation, "|"),
			(Operation, "vector_filter"),
			(Key, "zoom"),
			(Punctuation, "="),
			(Punctuation, "["),
			(Value, "1"),
			(Punctuation, ","),
			(Value, "2"),
			(Punctuation, "]"),
		]
	);

	// Everything the tokens skip must be whitespace - an unclassified character would render
	// unstyled, which is how a highlighter quietly drifts from the parser.
	let mut cursor = 0;
	for token in &tokens {
		assert!(
			text[cursor..token.span.start].trim().is_empty(),
			"unclassified text at byte {cursor}: {:?}",
			&text[cursor..token.span.start]
		);
		cursor = token.span.end;
	}
	assert!(text[cursor..].trim().is_empty());
}

#[test]
fn tokens_survive_multibyte_text_and_nesting() {
	let text = "merge [ from_container filename=\"Grüße.versatiles\" ]";
	let document = Document::parse(text).unwrap();
	for token in document.tokens() {
		assert!(
			document.slice(token.span).is_some(),
			"token {token:?} does not land on a character boundary"
		);
	}
	assert!(
		document
			.tokens()
			.iter()
			.any(|t| document.slice(t.span) == Some("\"Grüße.versatiles\"")),
		"the nested value should be tokenised"
	);
}

// -- setting parameters ------------------------------------------------------------------------

/// What the generated form does when you pick a parameter the operation accepts but the node does
/// not set - the case that cannot be addressed by the property's own span, because there isn't one.
#[test]
fn a_parameter_can_be_added_to_a_node_that_does_not_have_it() {
	let mut document = Document::parse("from_container filename=a").unwrap();
	let span = document.pipeline().nodes[0].name_span;
	document.set_property(span, "filename", &["b".to_string()]).unwrap();
	assert_eq!(document.pipeline().nodes[0].property("filename"), ["b"]);

	document.set_property(span, "other", &["x y".to_string()]).unwrap();
	assert_eq!(document.pipeline().nodes[0].property("other"), ["x y"]);
	assert!(
		document.text().contains("'x y'"),
		"quoting is the tree's job: {:?}",
		document.text()
	);
}

#[test]
fn several_values_become_an_array() {
	let mut document = Document::parse("vector_filter_layers filter=a").unwrap();
	let span = document.pipeline().nodes[0].name_span;
	document
		.set_property(span, "filter", &["roads".to_string(), "water".to_string()])
		.unwrap();

	assert_eq!(document.pipeline().nodes[0].property("filter"), ["roads", "water"]);
	assert!(matches!(
		document.pipeline().nodes[0].properties[0].value,
		super::Value::Array { .. }
	));
	Document::parse(document.text()).expect("the array must parse back");
}

#[test]
fn setting_a_parameter_reaches_a_nested_node() {
	let mut document = Document::parse("from_stacked [ from_container filename=a ]").unwrap();
	let inner = document.pipeline().nodes[0].sources[0].nodes[0].name_span;
	document.set_property(inner, "filename", &["b".to_string()]).unwrap();
	assert_eq!(
		document.pipeline().nodes[0].sources[0].nodes[0].property("filename"),
		["b"]
	);
}

#[test]
fn a_span_that_names_no_operation_is_refused() {
	let mut document = Document::parse("from_container filename=a").unwrap();
	let before = document.clone();
	assert!(document.set_property(Span::new(999, 1000), "x", &["1".into()]).is_err());
	assert_eq!(document, before, "a refusal must not half-apply");
}

/// A selection is a path, so anything asked about the selection has to be able to follow one -
/// and it must agree with what `node_at` hands back from a caret offset (S3.4).
#[test]
fn a_path_reaches_the_node_that_produced_it() {
	let vpl =
		"from_stacked [ from_debug format=png | raster_overview level=2, from_debug format=webp ] | raster_flatten";
	let document = Document::parse(vpl).unwrap();
	let pipeline = document.pipeline();

	assert_eq!(pipeline.at_path(&[0]).unwrap().name, "from_stacked");
	assert_eq!(pipeline.at_path(&[1]).unwrap().name, "raster_flatten");
	assert_eq!(pipeline.at_path(&[0, 0, 1]).unwrap().name, "raster_overview");
	assert_eq!(
		pipeline.at_path(&[0, 1, 0]).unwrap().property("format"),
		["webp".to_string()]
	);

	assert!(pipeline.at_path(&[]).is_none());
	assert!(pipeline.at_path(&[9]).is_none());
	assert!(pipeline.at_path(&[0, 9, 0]).is_none());

	// The round trip: every path `node_at` returns leads back to the node it returned.
	for offset in 0..vpl.len() {
		if let Some((path, found)) = pipeline.node_at(offset) {
			assert_eq!(
				pipeline.at_path(&path).unwrap().name_span,
				found.name_span,
				"offset {offset} gave path {path:?}"
			);
		}
	}
}

// -- structural edits: adding and removing operations ------------------------------------------

fn name_span(document: &Document, index: usize) -> Span {
	document.pipeline().nodes[index].name_span
}

/// The thing that was missing: a pipeline could only gain a transform by typing VPL.
#[test]
fn an_operation_can_be_appended_after_a_node() {
	let mut document = Document::parse("from_container filename=a.versatiles").unwrap();
	let span = name_span(&document, 0);
	document.insert_after(span, "filter").unwrap();

	assert_eq!(document.text(), "from_container filename=a.versatiles | filter");
	assert_eq!(document.pipeline().nodes.len(), 2);
	// No invented parameters - the generated form is where those are set.
	assert!(document.pipeline().nodes[1].properties.is_empty());
}

/// Inserting in the middle puts the node *after* the one selected, not at the end.
#[test]
fn an_operation_lands_where_the_selection_says() {
	let mut document = Document::parse("from_debug format=png | raster_overview level=2").unwrap();
	let span = name_span(&document, 0);
	document.insert_after(span, "raster_flatten").unwrap();

	assert_eq!(
		document.text(),
		"from_debug format=png | raster_flatten | raster_overview level=2"
	);
}

/// A node inside a `[ … ]` block belongs to that chain, so an insertion after it has to land
/// inside the brackets rather than on the outer pipeline.
#[test]
fn an_operation_inserted_in_a_nested_chain_stays_in_it() {
	let vpl = "from_stacked [ from_debug format=png, from_debug format=webp ] | raster_flatten";
	let mut document = Document::parse(vpl).unwrap();
	let inner = document.pipeline().nodes[0].sources[0].nodes[0].name_span;
	document.insert_after(inner, "raster_flatten").unwrap();

	assert_eq!(
		document.text(),
		"from_stacked [ from_debug format=png | raster_flatten, from_debug format=webp ] | raster_flatten"
	);
	assert_eq!(document.pipeline().nodes[0].sources[0].nodes.len(), 2);
	assert_eq!(document.pipeline().nodes.len(), 2, "the outer chain is untouched");
}

/// Q11: the author's comments and spacing survive an edit that happens somewhere else.
#[test]
fn appending_keeps_the_comments_and_layout_around_it() {
	let vpl = "# what this reads\nfrom_debug format=png\n# and then\n| raster_overview level=2";
	let mut document = Document::parse(vpl).unwrap();
	let span = name_span(&document, 1);
	document.insert_after(span, "raster_flatten").unwrap();

	assert!(
		document
			.text()
			.starts_with("# what this reads\nfrom_debug format=png\n# and then\n")
	);
	assert!(document.text().ends_with("| raster_overview level=2 | raster_flatten"));
	assert_eq!(document.comments().len(), 2, "both comments survived");
}

/// A read operation in the middle parses and is then flagged - C4's job, not this one's.
#[test]
fn a_read_operation_in_the_middle_is_a_diagnostic_not_a_refusal() {
	let mut document = Document::parse("from_debug format=png").unwrap();
	let span = name_span(&document, 0);
	document.insert_after(span, "from_debug").unwrap();

	assert_eq!(document.pipeline().nodes.len(), 2);
	assert!(
		!crate::vpl::validate(&document).is_empty(),
		"a read node mid-chain should be marked"
	);
}

#[test]
fn removing_a_node_closes_the_gap() {
	let vpl = "from_debug format=png | raster_overview level=2 | raster_flatten";
	let mut document = Document::parse(vpl).unwrap();
	let span = name_span(&document, 1);
	document.remove_node(span).unwrap();

	assert_eq!(document.text(), "from_debug format=png | raster_flatten");
}

/// Removing the head keeps the rest of the chain intact and its separator with it.
#[test]
fn removing_the_first_node_leaves_the_rest() {
	let mut document = Document::parse("from_debug format=png | raster_flatten").unwrap();
	let span = name_span(&document, 0);
	document.remove_node(span).unwrap();

	assert_eq!(document.text(), "raster_flatten");
}

/// A comment above a node describes it, so removing that node takes the comment too.
#[test]
fn removing_a_node_takes_the_comment_that_introduced_it() {
	let vpl = "from_debug format=png\n# drop the high zooms\n| filter level_max=5\n| raster_flatten";
	let mut document = Document::parse(vpl).unwrap();
	let span = name_span(&document, 1);
	document.remove_node(span).unwrap();

	assert_eq!(document.text(), "from_debug format=png\n| raster_flatten");
	assert!(document.comments().is_empty(), "the comment went with its node");
}

/// An empty pipeline does not parse, so this has to be refused in its own words rather than
/// producing "unexpected character" about a document nobody wrote.
#[test]
fn the_last_operation_cannot_be_removed() {
	let mut document = Document::parse("from_debug format=png").unwrap();
	let span = name_span(&document, 0);

	let error = document.remove_node(span).unwrap_err();
	assert!(error.message.contains("at least one"), "{}", error.message);
	assert_eq!(document.text(), "from_debug format=png", "and nothing changed");
}

/// The same rule inside a `[ … ]` block: siblings there are the nested chain.
#[test]
fn removing_from_a_nested_chain_uses_its_own_siblings() {
	let vpl = "from_stacked [ from_debug format=png | raster_flatten, from_debug format=webp ]";
	let mut document = Document::parse(vpl).unwrap();
	let inner = document.pipeline().nodes[0].sources[0].nodes[1].name_span;
	document.remove_node(inner).unwrap();

	assert_eq!(
		document.text(),
		"from_stacked [ from_debug format=png, from_debug format=webp ]"
	);
}

#[test]
fn a_span_that_names_no_node_is_refused_by_both_structural_edits() {
	let mut document = Document::parse("from_debug format=png").unwrap();
	let nowhere = Span { start: 9999, end: 9999 };

	assert!(document.insert_after(nowhere, "filter").is_err());
	assert!(document.remove_node(nowhere).is_err());
	assert_eq!(document.text(), "from_debug format=png");
}

/// The whole point of asking upstream for a CST formatter (vt#249): a Format command that deletes
/// the notes in a file is a Format command nobody uses twice.
#[test]
fn formatting_keeps_the_comments() {
	let mut document =
		Document::parse("# Berlin\nfrom_container filename='berlin.mbtiles'   |   vector_repair # tidy it").unwrap();
	document.format();

	let text = document.text();
	assert!(text.contains("# Berlin"), "{text}");
	assert!(text.contains("# tidy it"), "{text}");
	assert_eq!(document.comments().len(), 2, "{text}");
	assert!(text.contains("| vector_repair"), "and it did lay it out again: {text}");
}

/// Only whitespace moves, so a value keeps the quoting its author chose and a document that was
/// already tidy comes back unchanged.
#[test]
fn formatting_changes_nothing_but_the_layout() {
	let mut document = Document::parse("from_container filename='a b.mbtiles' | filter level_min=2").unwrap();
	document.format();
	let once = document.text().to_string();

	assert!(once.contains("filename='a b.mbtiles'"), "{once}");

	let mut again = Document::parse(once.clone()).unwrap();
	again.format();
	assert_eq!(again.text(), once, "formatting twice is formatting once");
}
