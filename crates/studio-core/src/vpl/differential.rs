//! Studio's parser against the real one, case by case.
//!
//! Reimplementing a grammar is only safe while the reimplementation agrees with the original, and
//! "agrees" has to mean two things at once: the same inputs are accepted, and the accepted ones
//! produce the same tree. A Studio that rejects VPL the CLI runs would send users to the terminal
//! to find out they were right; one that accepts VPL the CLI rejects would let them build a
//! pipeline that only works inside Studio. Both are worse than having no editor.
//!
//! So every case below runs through both parsers. Nothing here asserts what the *right* answer is —
//! upstream defines that, including where it is surprising. Two of these cases document behaviour
//! that reads like a bug and is reproduced deliberately, which is exactly what this file is for.

use super::Document;
use versatiles_pipeline::vpl::parse_vpl;

/// Inputs both parsers must agree on. Valid and invalid together, because agreeing about failure
/// matters as much as agreeing about success.
const CASES: &[&str] = &[
	// -- the ordinary shapes ---------------------------------------------------------------------
	"read",
	"from_container filename=x",
	"from_container filename=\"berlin.versatiles\"",
	"from_container filename='berlin.versatiles'",
	"from_container filename=/data/berlin.versatiles",
	"read | write",
	"read|write",
	"read  |  write",
	"from_container filename=a | vector_filter layer=roads | write",
	// -- parameters ------------------------------------------------------------------------------
	"node a=1 b=2 c=3",
	"node zebra=1 alpha=2", // order differs from sorted order
	"node a=1 a=2",         // repeats concatenate rather than override
	"node a = 1",           // whitespace around '='
	"node a=[1,2,3]",
	"node a=[1, 2, 3]",
	"node a=[ 1 , 2 , 3 ]",
	"node a=[]",
	"node a=['x','y']",
	"node a=[\"x\",\"y\"]",
	"node a=-1.5",
	"node bbox=[-180,-85.05,180,85.05]",
	"node a-b=1",
	"node a_b=1",
	// -- strings ---------------------------------------------------------------------------------
	"node a=\"with space\"",
	"node a='with space'",
	"node a=\"tab\\there\"",
	"node a=\"line\\nbreak\"",
	"node a=\"quote\\\"inside\"",
	"node a=\"back\\\\slash\"",
	"node a='it \"quotes\" fine'",
	"node a=\"\\n\"", // an escape alone is a body; an empty one is not
	"node a=\"\\\\\"",
	"node a=\"Grüße\"", // multi-byte, to catch byte-vs-char span slips
	"node a=\"日本語\"",
	// -- sources ---------------------------------------------------------------------------------
	"merge [ read, read ]",
	"merge [read,read]",
	"merge [ from_container filename=a | write, from_container filename=b ]",
	"merge []",
	"merge [ merge [ read ] ]",
	"outer a=1 [ inner b=2 ]",
	// -- comments --------------------------------------------------------------------------------
	"# leading\nread",
	"read # trailing",
	"read # trailing\n| write",
	"read |# squashed against the pipe\nwrite",
	"from_container # between name and parameter\n filename=a",
	"from_container filename=a # between parameters\n other=b",
	"merge [ # inside a source list\n read ]",
	"#only a comment\nread\n#and another",
	// -- whitespace ------------------------------------------------------------------------------
	"  read  ",
	"\n\nread\n\n",
	"\tread\t",
	"from_container\n  filename=a\n| write",
	// -- inputs both must reject -----------------------------------------------------------------
	"",
	"   ",
	"# just a comment",
	"|",
	"read |",
	"| read",
	"read foo", // a bare word where a parameter belongs
	"read a=",
	"read =1",
	"1read",
	"read a=1 extra",
	"merge [ read",
	"node a=[1,2",
	"node a=\"unterminated",
	"node a='unterminated",
	"node a=''",      // upstream's `is_not` needs one character
	"node a=\"\"",    // and `escaped_transform` needs one too
	"node a=\"\\x\"", // not one of the four escapes
	"read ; write",
	"read !",
];

#[test]
fn both_parsers_accept_and_reject_the_same_inputs() {
	let mut disagreements = Vec::new();
	for case in CASES {
		let mine = Document::parse(*case).is_ok();
		let theirs = parse_vpl(case).is_ok();
		if mine != theirs {
			disagreements.push(format!(
				"{case:?}: studio {}, upstream {}",
				if mine { "accepts" } else { "rejects" },
				if theirs { "accepts" } else { "rejects" }
			));
		}
	}
	assert!(
		disagreements.is_empty(),
		"the two parsers disagree about what is valid VPL:\n  {}",
		disagreements.join("\n  ")
	);
}

#[test]
fn both_parsers_build_the_same_tree() {
	for case in CASES {
		let (Ok(mine), Ok(theirs)) = (Document::parse(*case), parse_vpl(case)) else {
			continue;
		};
		assert_eq!(
			mine.to_pipeline(),
			theirs,
			"{case:?} parsed to different trees\n  studio:   {:?}\n  upstream: {:?}",
			mine.to_pipeline(),
			theirs
		);
	}
}

/// The canonical printing has to survive the *other* parser, not just ours — otherwise Studio can
/// write a file that only Studio can read.
#[test]
fn what_studio_prints_upstream_can_parse_back() {
	for case in CASES {
		let Ok(document) = Document::parse(*case) else {
			continue;
		};
		let printed = document.pipeline().to_string();
		let reparsed = parse_vpl(&printed)
			.unwrap_or_else(|e| panic!("upstream rejected our own output for {case:?}\n  printed: {printed:?}\n  {e:?}"));
		assert_eq!(
			reparsed,
			document.to_pipeline(),
			"printing {case:?} as {printed:?} changed what it means"
		);
	}
}

/// Two behaviours that look like bugs and are matched on purpose.
///
/// Studio is not the place to fix upstream's grammar: diverging quietly would be worse than either
/// behaviour. If these ever start failing, upstream changed and Studio should follow — that is the
/// signal this test exists to give.
#[test]
fn upstream_quirks_are_reproduced_not_corrected() {
	// A repeated key concatenates. Nothing in the syntax hints that `a=1 a=2` means `[1, 2]`.
	let document = Document::parse("node a=1 a=2").unwrap();
	assert_eq!(document.pipeline().nodes[0].property("a"), ["1", "2"]);
	assert_eq!(document.to_pipeline(), parse_vpl("node a=1 a=2").unwrap());

	// **VPL cannot express an empty string.** `''` fails on `is_not`, `""` fails on
	// `escaped_transform`, and there is no third spelling — so a parameter can be absent or
	// non-empty, never blank. `quote_value` returns `None` rather than inventing a syntax.
	for empty in ["node a=''", "node a=\"\""] {
		assert!(Document::parse(empty).is_err(), "{empty} should not parse");
		assert!(parse_vpl(empty).is_err(), "upstream should reject {empty} too");
	}
	assert_eq!(super::quote_value(""), None);
}
