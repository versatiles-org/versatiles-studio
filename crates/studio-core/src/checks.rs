//! What is wrong with a source's tiles, and what would fix it (S14.8, B3, [Q72]).
//!
//! **Upstream finds the violations** - `validate_tile` against MVT 2.1, and the TileJSON's own
//! checks - and this says them to a person: one sentence per kind, a count, how many tiles, an example
//! to open, and which of the two repairs it needs. `vector_repair` fixes a malformed layer or ring on
//! its own; a feature whose geometry is missing or will not decode cannot be salvaged, only dropped,
//! which is `drop_offenders=true` and is worth saying before anyone presses it.
//!
//! [Q72]: ../../../docs/decisions.md

use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use versatiles_container::{TileSource, describe_issue_kind};
use versatiles_core::TileCoord;
use versatiles_geometry::vector_tile::{DegenerateReason, GeomType, IssueKind, ValidationIssue};

/// What a scan found wrong.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Checks {
	/// Tiles read that carry at least one violation.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub tiles_with_issues: u64,
	/// One entry per kind found, the commonest first.
	pub issues: Vec<Check>,
	/// What the TileJSON gets wrong, or `None` when it passes.
	pub tilejson: Option<String>,
}

/// One kind of violation, across the tiles read.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Check {
	/// Upstream's name for it, `DegenerateRing(Collinear)` - stable, for code to match on.
	pub kind: String,
	/// The same in a sentence, for a person.
	pub label: String,
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub count: u64,
	/// Tiles carrying it.
	#[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number))]
	pub tiles: u64,
	/// Which repair fixes it.
	pub fix: Fix,
	/// The first place it was found, for the tile dialog to open on.
	pub example: Example,
}

/// What it takes to fix a kind of violation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub enum Fix {
	/// `vector_repair` mends it.
	Repair,
	/// Only dropping the feature does: `vector_repair drop_offenders=true`.
	Drop,
}

/// Where a violation is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Example {
	pub z: u8,
	pub x: u32,
	pub y: u32,
	pub layer: String,
	/// The feature, by position in its layer; `None` for a layer-wide violation.
	pub feature: Option<u32>,
}

/// A violation in a sentence.
#[must_use]
pub fn label(kind: &IssueKind) -> String {
	let geometry = |kind: &GeomType| match kind {
		GeomType::MultiPoint => "point",
		GeomType::MultiLineString => "line",
		GeomType::MultiPolygon => "polygon",
		GeomType::Unknown => "feature",
	};
	match kind {
		IssueKind::MissingExtent => "A layer has no extent".to_string(),
		IssueKind::MissingVersion => "A layer has no version".to_string(),
		IssueKind::DuplicateLayerName => "Two layers in one tile share a name".to_string(),
		IssueKind::OrphanInnerRing => "A hole with no outer ring around it".to_string(),
		IssueKind::UnclosedRing => "A ring that does not close".to_string(),
		IssueKind::DegenerateRing(DegenerateReason::TooFewVertices) => {
			"A ring with fewer than three vertices".to_string()
		}
		IssueKind::DegenerateRing(DegenerateReason::SubPixel) => "A ring smaller than one tile unit".to_string(),
		IssueKind::DegenerateRing(DegenerateReason::Collinear) => "A ring whose vertices lie on one line".to_string(),
		IssueKind::UnknownGeometryType => "A feature of unknown type that carries geometry".to_string(),
		IssueKind::EmptyGeometryForType(kind) => format!("A {} with no coordinates", geometry(kind)),
		IssueKind::MalformedCommandStream(_) => "Geometry that does not decode".to_string(),
	}
}

/// Which repair a violation needs.
#[must_use]
pub fn fix(kind: &IssueKind) -> Fix {
	match kind {
		// `UnknownGeometryType` was dropped until versatiles-rs 5.4, which keeps the feature and only
		// strips the data that type 0 gives no shape to.
		IssueKind::EmptyGeometryForType(_) | IssueKind::MalformedCommandStream(_) => Fix::Drop,
		_ => Fix::Repair,
	}
}

/// What the TileJSON gets wrong, by upstream's checks for the kind of tiles it describes.
pub fn tilejson(source: &dyn TileSource) -> Option<String> {
	let tilejson = source.tilejson();
	let checked = if source.metadata().tile_format().is_vector() {
		tilejson.check_vector()
	} else {
		tilejson.check_raster()
	};
	checked.err().map(|error| format!("{error:#}"))
}

/// Violations counted as tiles are read.
#[derive(Debug, Default)]
pub struct Tally {
	tiles_with_issues: u64,
	/// By upstream's name: the label, the fix, the count, the tiles and the first example.
	kinds: BTreeMap<String, (String, Fix, u64, u64, Example)>,
}

impl Tally {
	/// Counts one tile's violations.
	pub fn add(&mut self, coord: TileCoord, issues: &[ValidationIssue]) {
		if issues.is_empty() {
			return;
		}
		self.tiles_with_issues += 1;
		let mut seen = BTreeSet::new();
		for issue in issues {
			let kind = describe_issue_kind(&issue.kind);
			let entry = self.kinds.entry(kind.clone()).or_insert_with(|| {
				(
					label(&issue.kind),
					fix(&issue.kind),
					0,
					0,
					Example {
						z: coord.level,
						x: coord.x,
						y: coord.y,
						layer: issue.layer.clone(),
						feature: issue.feature_index.and_then(|i| u32::try_from(i).ok()),
					},
				)
			});
			entry.2 += 1;
			if seen.insert(kind) {
				entry.3 += 1;
			}
		}
	}

	/// The checks, the commonest first, with what the TileJSON says.
	#[must_use]
	pub fn finish(self, tilejson: Option<String>) -> Checks {
		let mut issues: Vec<Check> = self
			.kinds
			.into_iter()
			.map(|(kind, (label, fix, count, tiles, example))| Check {
				kind,
				label,
				count,
				tiles,
				fix,
				example,
			})
			.collect();
		issues.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.kind.cmp(&b.kind)));
		Checks {
			tiles_with_issues: self.tiles_with_issues,
			issues,
			tilejson,
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn issue(layer: &str, feature: Option<usize>, kind: IssueKind) -> ValidationIssue {
		ValidationIssue {
			layer: layer.to_string(),
			feature_index: feature,
			kind,
		}
	}

	#[test]
	fn counts_each_kind_once_per_tile_and_keeps_the_first_example() {
		let mut tally = Tally::default();
		let collinear = || IssueKind::DegenerateRing(DegenerateReason::Collinear);
		tally.add(
			TileCoord::new(14, 1, 2).unwrap(),
			&[
				issue("water", Some(3), collinear()),
				issue("water", Some(9), collinear()),
			],
		);
		tally.add(TileCoord::new(14, 1, 3).unwrap(), &[]);
		tally.add(
			TileCoord::new(14, 1, 4).unwrap(),
			&[
				issue("land", Some(1), collinear()),
				issue("roads", None, IssueKind::MissingExtent),
			],
		);
		let checks = tally.finish(None);

		assert_eq!(checks.tiles_with_issues, 2);
		let first = &checks.issues[0];
		assert_eq!((first.count, first.tiles), (3, 2), "the commonest first");
		assert_eq!(first.label, "A ring whose vertices lie on one line");
		assert_eq!(first.fix, Fix::Repair);
		assert_eq!(
			first.example,
			Example {
				z: 14,
				x: 1,
				y: 2,
				layer: "water".to_string(),
				feature: Some(3)
			}
		);
		assert_eq!(checks.issues[1].example.feature, None);
	}

	#[test]
	fn says_which_violations_only_dropping_the_feature_fixes() {
		assert_eq!(fix(&IssueKind::OrphanInnerRing), Fix::Repair);
		assert_eq!(fix(&IssueKind::EmptyGeometryForType(GeomType::MultiPoint)), Fix::Drop);
		assert_eq!(
			label(&IssueKind::EmptyGeometryForType(GeomType::MultiPolygon)),
			"A polygon with no coordinates"
		);
	}
}
