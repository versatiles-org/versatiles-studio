//! What a field *means*, beyond what its Rust type says.
//!
//! [`operations`](super::operations) reads `rust_type` and nothing else, which is right and is why a
//! zoom level renders as a spinner that goes to 255. `VPLFieldMeta` has no slot for meaning: a path,
//! a layer name and an attribution string are all `String`, and a zoom level and an encoder effort
//! are both `u8`.
//!
//! **This table is Studio's, deliberately, and the [ecosystem notes](../../../docs/ecosystem.md)
//! carry the argument.** In short: twelve kinds of meaning across ~80 fields is a large vocabulary
//! to ask operation authors to learn for a benefit that is mostly a generated form's, and a
//! per-field format list upstream is one that starts lying the release it falls behind. What *did*
//! go upstream is the half that is logic rather than fact -
//! [vt#257](https://github.com/versatiles-org/versatiles-rs/issues/257), so `check_pipeline` can see
//! that `color=red` is not hex. Validation belongs next to the parser; presentation belongs here.
//!
//! A [`Role`] is a static fact, which is what makes holding it locally safe. "This field is a zoom
//! level" cannot drift out of agreement with a parser, because it is not one. Studio has refused the
//! other kind twice - the hand-written CSV sniffer deleted after vt#238, and `validate` giving up
//! deciding enum values after vt#224 - and nothing here reimplements a parser.
//!
//! **What keeps it honest are the two tripwires at the bottom, and the second is the important one.**
//! [`every_role_names_a_field_that_exists`] catches what upstream renames, removes or retypes.
//! [`no_unclassified_field_of_a_known_shape`] catches what upstream *adds* - and only the first is
//! the obvious test to write. On its own it would be the vt#229 mistake again: a tripwire that names
//! one acceptable outcome and stays silent when a different one arrives.
//!
//! **Not wired into [`Control`](super::Control) yet.** This module answers what a field is; turning
//! that into a file dialog, a rectangle on the map or a slider is the work it exists for, and it
//! changes the generated TypeScript. Kept separate so the table and its guarantees can land first.

/// Where a field's values come from, when they are names out of the data rather than typed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Names {
	/// A column of the delimited file named by a sibling field.
	ColumnOf(&'static str),
	/// A property of the features in the file named by a sibling field.
	PropertyOf(&'static str),
	/// A layer of the tiles arriving from upstream in the pipeline.
	TileLayer,
	/// A property of the features in the tiles arriving from upstream.
	TileProperty,
}

/// A field holding source text rather than a value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
	Cel,
	Regex,
	Json,
	/// `from_grid`'s id format, with `{x}` and `{y}` placeholders.
	Template,
}

/// What a field means.
///
/// Absent for every field the type already describes fully - an enum, a `bool`, a free-text
/// `attribution`. Absence is the common case and costs nothing: the form falls back to exactly what
/// it renders today.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Role {
	/// A path on disk. `formats` is the extensions to filter a dialog by, empty when upstream
	/// accepts anything it can sniff. `urls` marks the fields that also take `http`/`https`/`sftp`.
	Path {
		formats: &'static [&'static str],
		urls: bool,
	},
	/// An `http(s)` URL, never a path.
	Url,
	/// `[west, south, east, north]` in WGS84 degrees - a rectangle to draw on the map.
	GeoBBox,
	/// `[lon, lat, zoom]` - a point to click on the map.
	GeoPoint,
	/// A zoom level. `u8` by type, `0..=30` by meaning.
	Zoom,
	/// Bounds the type is too wide to express, inclusive.
	///
	/// Exclusive lower bounds do not fit and are left out rather than approximated:
	/// `raster_levels.contrast` and `gamma` are both "above `0`", and they are the only two.
	Range { min: f64, max: f64 },
	/// A short set of accepted values on a numeric type - `tile_size` is "`256` or `512`", which is
	/// a set and not a range, so `Range` would say `256..=512` and admit 400.
	Choice(&'static [&'static str]),
	/// A colour, however it is spelled - hex `String` on `from_color`, `[u8;3]` on `raster_flatten`.
	Color,
	/// An EPSG code, not any `u32`.
	Epsg,
	/// A name taken from the data rather than typed.
	Names(Names),
	/// Source text, which wants an editor rather than a single-line box.
	Code(Lang),
	/// Exactly one character.
	Char,
}

/// Extensions, shared so a dialog and [`crate::import`] cannot disagree about a format.
mod formats {
	pub const CONTAINER: &[&str] = &["versatiles", "mbtiles", "pmtiles", "tar"];
	pub const GEO: &[&str] = &[
		"geojson",
		"json",
		"ndjson",
		"geojsonl",
		"ndgeojson",
		"geojsonseq",
		"shp",
	];
	pub const CSV: &[&str] = &["csv"];
	pub const TABULAR: &[&str] = &["csv", "tsv"];
	pub const RASTER: &[&str] = &["tif", "tiff", "vrt", "png", "jpg", "jpeg"];
	pub const GEOJSON: &[&str] = &["geojson", "json"];
	pub const JSON: &[&str] = &["json"];
	/// `from_tile` detects from the extension without publishing the list, so a dialog filters
	/// nothing rather than guessing a set that would be wrong the moment a format is added.
	pub const ANY: &[&str] = &[];
}

use Names::{TileLayer, TileProperty};
use Role::{Char, Choice, Code, Color, Epsg, GeoBBox, GeoPoint, Range, Url, Zoom};
use formats::{ANY, CONTAINER, CSV, GEO, GEOJSON, JSON, RASTER, TABULAR};

// Constructors rather than literals: a `Role::Path { formats: …, urls: … }` written out in the table
// wraps over four lines under rustfmt, which buries seventy-odd one-line facts in punctuation.

const fn path(formats: &'static [&'static str]) -> Role {
	Role::Path { formats, urls: false }
}

/// The one field that also takes `http`, `https` or `sftp`.
const fn path_or_url(formats: &'static [&'static str]) -> Role {
	Role::Path { formats, urls: true }
}

const fn range(min: f64, max: f64) -> Role {
	Range { min, max }
}

/// A column of the delimited file named by a sibling field.
const fn column_of(field: &'static str) -> Role {
	Role::Names(Names::ColumnOf(field))
}

/// A property of the features in the file named by a sibling field.
const fn property_of(field: &'static str) -> Role {
	Role::Names(Names::PropertyOf(field))
}

const TILE_SIZE: Role = Choice(&["256", "512"]);
const LAYER: Role = Role::Names(TileLayer);
const TILE_PROPERTY: Role = Role::Names(TileProperty);

/// Every field that means more than its type says, by operation.
///
/// Keyed rather than flat so an operation is named once instead of once per field, and so its
/// parameters read as the block they are. Within a block the order is the operation's own, so this
/// reads alongside `versatiles help pipeline` rather than against it.
///
/// Nesting costs one failure mode a flat list did not have - the same operation could be opened
/// twice, and the second block would be unreachable. [`no_operation_or_field_is_listed_twice`]
/// covers it.
const ROLES: &[(&str, &[(&str, Role)])] = &[
	// ── read ────────────────────────────────────────────────────────────────────────────────────
	("from_color", &[("color", Color), ("size", TILE_SIZE)]),
	(
		"from_container",
		&[("filename", path_or_url(CONTAINER)), ("ssh_identity", path(ANY))],
	),
	(
		"from_csv",
		&[
			("filename", path(CSV)),
			("lon_column", column_of("filename")),
			("lat_column", column_of("filename")),
			("id_column", column_of("filename")),
			("delimiter", Char),
			("min_zoom", Zoom),
			("max_zoom", Zoom),
			("bbox", GeoBBox),
			("properties_include", column_of("filename")),
			("properties_exclude", column_of("filename")),
		],
	),
	(
		"from_gdal_dem",
		&[
			("filename", path(RASTER)),
			("tile_size", TILE_SIZE),
			("level_max", Zoom),
			("level_min", Zoom),
			("cutline", path(GEOJSON)),
		],
	),
	(
		"from_gdal_raster",
		&[
			("filename", path(RASTER)),
			("tile_size", TILE_SIZE),
			("level_max", Zoom),
			("level_min", Zoom),
			("cutline", path(GEOJSON)),
			("crs", Epsg),
		],
	),
	(
		"from_geo",
		&[
			("filename", path(GEO)),
			("min_zoom", Zoom),
			("max_zoom", Zoom),
			("bbox", GeoBBox),
			("properties_include", property_of("filename")),
			("properties_exclude", property_of("filename")),
		],
	),
	(
		"from_grid",
		&[
			("epsg", Epsg),
			("bbox", GeoBBox),
			("max_zoom", Zoom),
			("id_template", Code(Lang::Template)),
		],
	),
	(
		"from_h3",
		&[("resolution", range(0.0, 15.0)), ("bbox", GeoBBox), ("max_zoom", Zoom)],
	),
	("from_tile", &[("filename", path(ANY))]),
	("from_tilejson", &[("url", Url)]),
	// ── transform ───────────────────────────────────────────────────────────────────────────────
	("dem_overview", &[("level", Zoom)]),
	("dem_tile_resize", &[("tile_size", TILE_SIZE)]),
	(
		"filter",
		&[
			("bbox", GeoBBox),
			("level_min", Zoom),
			("level_max", Zoom),
			("filename", path(CONTAINER)),
		],
	),
	(
		"meta_update",
		&[
			("bounds", GeoBBox),
			("center", GeoPoint),
			("fillzoom", Zoom),
			("tilejson", Code(Lang::Json)),
			("tilejson_file", path(JSON)),
			("tilejson_update", Code(Lang::Json)),
			("tilejson_update_file", path(JSON)),
			("vector_layers", Code(Lang::Json)),
			("vector_layers_file", path(JSON)),
		],
	),
	("raster_flatten", &[("color", Color)]),
	// `quality` and `quality_translucent` are `String` upstream while documenting `0`-`100`; the role
	// records the range the documentation gives, and the odd type is why it is worth recording.
	(
		"raster_format",
		&[
			("quality", range(0.0, 100.0)),
			("quality_translucent", range(0.0, 100.0)),
			("effort", range(0.0, 100.0)),
		],
	),
	("raster_levels", &[("brightness", range(-255.0, 255.0))]),
	("raster_mask", &[("geojson", path(GEOJSON))]),
	("raster_overscale", &[("level_base", Zoom), ("level_max", Zoom)]),
	("raster_overview", &[("level", Zoom)]),
	("raster_tile_resize", &[("tile_size", TILE_SIZE)]),
	("vector_filter_features", &[("layer", LAYER), ("expr", Code(Lang::Cel))]),
	("vector_filter_layers", &[("filter", LAYER)]),
	("vector_filter_properties", &[("regex", Code(Lang::Regex))]),
	("vector_overzoom", &[("level_base", Zoom), ("level_max", Zoom)]),
	(
		"vector_update_properties",
		&[
			("data_source_path", path(TABULAR)),
			("layer_name", LAYER),
			("id_field_tiles", TILE_PROPERTY),
			("id_field_data", column_of("data_source_path")),
			("field_separator", Char),
			("decimal_separator", Char),
		],
	),
];

/// What a field means, or `None` when its type is the whole story.
#[must_use]
pub fn role_of(operation: &str, field: &str) -> Option<Role> {
	ROLES
		.iter()
		.find(|(name, _)| *name == operation)?
		.1
		.iter()
		.find(|(name, _)| *name == field)
		.map(|(_, role)| *role)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::vpl::operations::registry;

	/// Whether a role can sit on a field of this Rust type.
	///
	/// Matched on the shape rather than on the exact string, so wrapping a field in `Option<>` - or
	/// upstream widening a `u8` - does not churn the table, while a `String` that becomes a
	/// `Vec<f64>` still fails.
	fn fits(role: &Role, rust_type: &str) -> bool {
		let has = |needle: &str| rust_type.contains(needle);
		match role {
			Role::Path { .. } | Url | Code(_) | Char => has("String"),
			Role::Names(_) => has("String"),
			GeoBBox => has("[f64;4]"),
			GeoPoint => has("[f64;3]"),
			Zoom => has("u8"),
			Epsg => has("u32"),
			Color => has("String") || has("[u8;3]"),
			Choice(_) => has("u16") || has("u32"),
			// `String` is allowed because `raster_format.quality` is one; see the table.
			Range { .. } => ["u8", "u16", "u32", "f32", "f64", "String"].iter().any(|t| has(t)),
		}
	}

	/// Catches what upstream renames, removes or retypes.
	#[test]
	fn every_role_names_a_field_that_exists() {
		let registry = registry();
		for (operation, field, role) in ROLES
			.iter()
			.flat_map(|(op, fields)| fields.iter().map(move |(f, r)| (op, f, r)))
		{
			let meta = registry
				.get(*operation)
				.unwrap_or_else(|| panic!("`{operation}` is not an operation upstream registers"));
			let found = meta
				.fields
				.iter()
				.find(|f| f.name == *field)
				.unwrap_or_else(|| panic!("`{operation}` has no field `{field}`"));
			assert!(
				fits(role, &found.rust_type),
				"{operation}.{field} is {} upstream, which {role:?} does not fit",
				found.rust_type
			);
		}
	}

	/// Catches what upstream *adds*.
	///
	/// The half that matters. A table checked only against itself degrades silently the first time a
	/// new operation arrives carrying a bbox, and a silent tripwire is worse than none because it is
	/// trusted - which is what [vt#229] taught. Each rule below is a claim about a shape whose
	/// meaning is never in doubt, so a new field of that shape is a gap and not a judgement call.
	///
	/// [vt#229]: https://github.com/versatiles-org/versatiles-rs/issues/229
	#[test]
	fn no_unclassified_field_of_a_known_shape() {
		let mut missing: Vec<String> = Vec::new();

		for meta in registry().values() {
			for field in &meta.fields {
				let name = field.name.as_str();
				let ty = field.rust_type.as_str();

				let expected = if ty.contains("[f64;4]") {
					// Every four-element degree array in the operation set is a WGS84 bbox.
					Some("a bbox")
				} else if ty.contains("u8") && (name.contains("zoom") || name.contains("level")) {
					Some("a zoom level")
				} else if ty.contains("String") && name.contains("file") {
					// `field` does not contain `file`, so `id_field_data` is not caught here.
					Some("a path")
				} else {
					None
				};

				if let Some(what) = expected
					&& role_of(&meta.tag_name, name).is_none()
				{
					missing.push(format!("{}.{name} looks like {what} ({ty})", meta.tag_name));
				}
			}
		}

		assert!(
			missing.is_empty(),
			"upstream has fields with no role, so a form renders them plainly:\n  {}",
			missing.join("\n  ")
		);
	}

	/// The failure mode nesting introduced: a second block for an operation already listed is
	/// unreachable, because `role_of` stops at the first. A flat list could not express it.
	#[test]
	fn no_operation_or_field_is_listed_twice() {
		let mut seen = std::collections::HashSet::new();
		for (operation, fields) in ROLES {
			assert!(
				seen.insert(*operation),
				"`{operation}` opens a second block, which is unreachable"
			);
			let mut names = std::collections::HashSet::new();
			for (field, _) in *fields {
				assert!(names.insert(*field), "`{operation}.{field}` is listed twice");
			}
		}
	}

	#[test]
	fn a_field_with_nothing_to_add_has_no_role() {
		// The common case, and the one that costs nothing: an enum and a bool are fully described by
		// their type, so the table stays out of the way.
		assert_eq!(role_of("from_debug", "format"), None);
		assert_eq!(role_of("remap_coords", "flip_x"), None);
		assert_eq!(role_of("from_geo", "layer_name"), None);
	}

	#[test]
	fn the_two_spellings_of_a_colour_carry_the_same_role() {
		// `from_color` writes hex into a `String` and `raster_flatten` writes three channels into a
		// `[u8;3]`. A form should offer one picker; only the table can say they are the same thing.
		assert_eq!(role_of("from_color", "color"), Some(Color));
		assert_eq!(role_of("raster_flatten", "color"), Some(Color));
	}
}
