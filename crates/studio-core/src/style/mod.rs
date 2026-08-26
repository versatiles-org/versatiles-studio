//! The style, stored as what it is made from (S4.2, S4.7, [Q36]).
//!
//! A project has one style ([Q32]) over every graph it serves. What lives here is **not** a MapLibre
//! style: it is the recipe one is rendered from - a preset, the adjustments applied to it, and
//! whatever individual layers were changed by hand.
//!
//! **Because the rendered style does not fit the stack it would have to live on.** Undo takes whole
//! snapshots, which is exact and cheap for a pipeline of a few hundred bytes; `colorful` renders to
//! 125 kB across 324 layers, so a session's undo history would be 25 MB of it. The recipe is a few
//! hundred bytes and rides the same mechanism ([Q36] has the measurement).
//!
//! **The generator stays in the webview**, where `@versatiles/style` already is. This module never
//! produces a style - it describes one. That is also what makes D8's "export as `@versatiles/style`
//! code" possible at all: the code *is* the recipe, and a design that kept only the rendered output
//! could not have got it back.
//!
//! [Q32]: ../../../docs/decisions.md
//! [Q36]: ../../../docs/decisions.md

pub mod bundle;

use anyhow::{Context, Result};
use std::collections::BTreeMap;
use std::path::Path;

/// What a style may be written as (S4.6, D8).
///
/// `.json` is the style itself, for anything that consumes a MapLibre style. `.ts` is the recipe as
/// code - the thing [Q36] keeps the recipe *for*, and the reason a rendered style alone would not
/// have been enough.
pub const EXPORTABLE: [&str; 2] = ["json", "ts"];

/// Whether Studio will write a style to this path.
///
/// The same shape as [`export::is_writable`](crate::export::is_writable) and for the same reason: a
/// destination the application refuses should be refused in the dialog that chose it, not by a
/// failure afterwards.
#[must_use]
pub fn is_exportable(path: &Path) -> bool {
	path
		.extension()
		.map(|extension| extension.to_string_lossy().to_lowercase())
		.is_some_and(|extension| EXPORTABLE.contains(&extension.as_str()))
}

/// Where a style starts before anything is adjusted.
///
/// The six are `@versatiles/style`'s own builders, named as it names them so the webview needs no
/// translation table - a mapping between two spellings of the same six things is a thing to keep in
/// step for no gain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum Preset {
	#[default]
	Colorful,
	Eclipse,
	Graybeard,
	Neutrino,
	Shadow,
	Satellite,
	/// Built from the layers the tiles actually contain, rather than from a Shortbread assumption
	/// (D2, S4.4). A recipe rather than a fixed style, so it re-derives when the pipeline changes.
	Derived,
}

/// The adjustments applied to every colour in the style at once (D1).
///
/// A mirror of `@versatiles/style`'s `RecolorOptions`, field for field. Mirrored rather than
/// wrapped: these cross the IPC boundary and are handed to the generator unchanged, so a field this
/// end that the generator does not have would be a setting that silently does nothing.
///
/// Every field is optional and `None` means "leave it alone". `skip_serializing_if` on each is what
/// makes that true in the text as well as in the type: without it an untouched recolour serialises
/// as ten `null`s, which is both larger than the recipe it belongs to and a lie about having been
/// configured.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Recolor {
	/// Swap light for dark while keeping the hues - D5's whole feature, in one flag.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub invert_brightness: Option<bool>,
	/// Hue rotation, in degrees.
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
	#[serde(skip_serializing_if = "Option::is_none")]
	pub rotate: Option<f64>,
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
	#[serde(skip_serializing_if = "Option::is_none")]
	pub saturate: Option<f64>,
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
	#[serde(skip_serializing_if = "Option::is_none")]
	pub gamma: Option<f64>,
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
	#[serde(skip_serializing_if = "Option::is_none")]
	pub contrast: Option<f64>,
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
	#[serde(skip_serializing_if = "Option::is_none")]
	pub brightness: Option<f64>,
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
	#[serde(skip_serializing_if = "Option::is_none")]
	pub tint: Option<f64>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub tint_color: Option<String>,
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number>))]
	#[serde(skip_serializing_if = "Option::is_none")]
	pub blend: Option<f64>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub blend_color: Option<String>,
}

impl Recolor {
	/// Whether this changes anything at all.
	#[must_use]
	pub fn is_identity(&self) -> bool {
		*self == Self::default()
	}
}

/// What was changed about one layer by hand (D3).
///
/// **Sparse, and only these three.** [D3](../../../docs/features.md) asks for filter, zoom range and
/// paint, all of which are properties *of* a layer - none of them adds, removes or reorders one,
/// which is what keeps a patch enough and a whole style unnecessary. [Q36] records that limit as
/// accepted rather than overlooked.
///
/// `paint` and `filter` are opaque JSON, declared so for the same reason as
/// `ContainerInfo::tile_json`: specta refuses `serde_json::Value` because a `Number` can hold an
/// `i64`, and there is no shape to describe here beyond "whatever MapLibre accepts". A type for
/// them would be a second, worse copy of the style specification that has to be kept in step.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct LayerOverride {
	/// Painted or not. `None` leaves the preset's own answer alone.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub visible: Option<bool>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub min_zoom: Option<u8>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub max_zoom: Option<u8>,
	/// Paint properties to merge over the layer's own, by MapLibre's names.
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Any>))]
	#[serde(skip_serializing_if = "Option::is_none")]
	pub paint: Option<serde_json::Value>,
	/// A MapLibre filter expression, replacing the layer's own.
	#[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Any>))]
	#[serde(skip_serializing_if = "Option::is_none")]
	pub filter: Option<serde_json::Value>,
}

impl LayerOverride {
	/// Whether this says anything. An override that says nothing is removed rather than stored, so
	/// that resetting a layer leaves no trace to export.
	#[must_use]
	pub fn is_empty(&self) -> bool {
		*self == Self::default()
	}
}

/// What a source's tiles are, as far as drawing them is concerned ([S6.1](../../../docs/history.md)).
///
/// **Studio's vocabulary, not the container's.** A container declares a `tile_schema` - upstream's
/// list, which can grow - and this is the much smaller question the style pane actually switches on:
/// which editor does this source get. Two schemas can land on one kind (`rgb` and `rgba` are both
/// imagery) and a container with no schema at all still has to land somewhere.
///
/// **Derived, and overridable.** The webview works it out from the schema, falling back to the tile
/// format and the layers the probe found. That answer is a guess whenever the schema is absent, so
/// [`Recipe::kind`] exists to let someone correct it - a DEM written before `tile_schema` existed is
/// otherwise indistinguishable from a photograph, and no amount of looking at the pixels decides it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
	/// Vector tiles using Shortbread's layer names, which the six presets are written against.
	VectorShortbread,
	/// Vector tiles of anything else. Styled from the layers actually present (D2).
	VectorOther,
	/// Raster tiles meant to be looked at - imagery, a scan, a rendered map (D11).
	RasterImage,
	/// Raster tiles encoding elevation, to be drawn as hillshade rather than as colour (D12).
	///
	/// The encoding - `mapbox`, `terrarium`, `versatiles` - is deliberately not carried here yet.
	/// Nothing draws a DEM until S6.6, and that is the step that has to decide whether the encoding
	/// belongs on this enum or is re-read from `tile_schema` at the point of use.
	RasterDem,
}

/// How imagery is adjusted when a source is drawn as raster ([S6.3](../../../docs/history.md), D11).
///
/// **Its own type rather than a second reading of [`Recolor`].** The two describe the same five
/// ideas and only two of them share a parameterisation: `rotate` and `saturate` mean what
/// `raster-hue-rotate` and `raster-saturation` mean, while `Recolor`'s contrast is a multiplier
/// around 1 and MapLibre's is an offset around 0, and `Recolor`'s brightness is an offset where
/// MapLibre's is a pair of range endpoints. Reusing the struct would have meant a conversion nobody
/// could read and two controls whose numbers lied about what they did.
///
/// **`None` is "leave it alone", not a neutral value.** The same reason `Recolor` gives: an
/// untouched adjustment must serialise to nothing, or every project file would carry a list of
/// identity values and every recipe would compare unequal to a fresh one.
#[derive(Debug, Clone, Copy, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct RasterAdjust {
	/// Degrees, `-180` to `180`.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub hue: Option<f32>,
	/// `-1` to `1`, where `0` leaves it alone.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub saturation: Option<f32>,
	/// `-1` to `1`, where `0` leaves it alone.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub contrast: Option<f32>,
	/// `-1` to `1`, where `0` leaves it alone.
	///
	/// Studio's own control, converted to `raster-brightness-min`/`-max` when the style is built:
	/// MapLibre remaps the input range onto those two endpoints, which is two numbers for something
	/// people reach for as one.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub brightness: Option<f32>,
	/// `0` to `1`.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub opacity: Option<f32>,
	/// `linear` smooths between pixels, `nearest` keeps them square - which is what a scan of a
	/// printed map or any pixel art wants.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub resampling: Option<Resampling>,
}

/// How a raster is sampled when it is scaled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum Resampling {
	Linear,
	Nearest,
}

/// How elevation is packed into a DEM's pixels.
///
/// **Two, because those are the two MapLibre can decode.** `versatiles_core` also names
/// `dem/versatiles`, and nothing published says how to unpack it - a guess would render plausible
/// hillshade of the wrong mountains, which is worse than saying so. The picker offers these and the
/// pane says when a container declares something it cannot draw.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum DemEncoding {
	Mapbox,
	Terrarium,
}

/// How elevation is drawn as relief ([S6.6](../../../docs/history.md), D12).
///
/// **`None` is "leave it alone"**, as everywhere else here: an untouched setting serialises to
/// nothing, so a fresh recipe and an untouched one compare equal and the undo stack stays quiet.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Hillshade {
	/// `None` takes the container's declared schema, which is right whenever there is one.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub encoding: Option<DemEncoding>,
	/// `0` to `1`, how hard the relief is pushed.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub exaggeration: Option<f32>,
	/// Where the light comes from, in degrees.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub direction: Option<f32>,
	/// How high the light sits, `0` (horizon) to `90` (overhead).
	#[serde(skip_serializing_if = "Option::is_none")]
	pub altitude: Option<f32>,
	/// Hex colours, as MapLibre takes them.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub shadow: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub highlight: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub accent: Option<String>,
}

/// How one source is drawn ([S6.4](../../../docs/history.md)).
///
/// **One variant, chosen by what the tiles are.** Before this, a recipe carried a preset, a
/// recolour, a layer-override map *and* a raster adjustment, and at least half of that was
/// meaningless for any given source - a preset means nothing over a photograph, and a
/// `raster-saturation` means nothing over vector tiles. Adding hillshade (S6.6) to a flat struct
/// would have made it two thirds.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub enum Appearance {
	/// Vector tiles: a preset, the adjustments over it, and whatever layers were changed by hand.
	Vector {
		preset: Preset,
		recolor: Recolor,
		/// By layer id. Empty for a style nobody has edited by hand.
		overrides: BTreeMap<String, LayerOverride>,
	},
	/// Raster tiles drawn as an image, adjusted (D11).
	Raster { adjust: RasterAdjust },
	/// Raster tiles holding elevation, drawn as relief (D12).
	Hillshade { shade: Hillshade },
}

impl Default for Appearance {
	fn default() -> Self {
		Self::Vector {
			preset: Preset::default(),
			recolor: Recolor::default(),
			overrides: BTreeMap::new(),
		}
	}
}

impl Appearance {
	/// The appearance a source of this kind starts with.
	///
	/// Each kind gets the appearance that can actually describe it - giving a DEM a preset it cannot
	/// use would be the old mistake in a new place.
	#[must_use]
	pub fn for_kind(kind: Option<SourceKind>) -> Self {
		match kind {
			Some(SourceKind::RasterImage) => Self::Raster {
				adjust: RasterAdjust::default(),
			},
			Some(SourceKind::RasterDem) => Self::Hillshade {
				shade: Hillshade::default(),
			},
			_ => Self::default(),
		}
	}

	/// Whether this appearance describes vector tiles, which is what a preset and a tree need.
	#[must_use]
	pub fn is_vector(&self) -> bool {
		matches!(self, Self::Vector { .. })
	}
}

/// One source's style: what it is, and how it is drawn.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct SourceStyle {
	/// What someone said these tiles are, when the derived reading was wrong (S6.1).
	pub kind: Option<SourceKind>,
	pub appearance: Appearance,
}

/// The whole style, as the core holds it.
///
/// **One entry per source, keyed by the graph's name.** The name is what a MapLibre style calls a
/// source and what `project.yaml` already lists graphs by, so persisting under it means the manifest
/// and the style agree without a translation table. It is *not* how the running application refers
/// to a graph - that is [`GraphId`](crate::graphs::GraphId), for the reason `graphs.rs` gives - so a
/// rename has to move the entry, which is [`Recipe::rename_source`]'s whole job.
///
/// Ordered (`BTreeMap`, not `HashMap`) so the text this serialises to depends only on its contents.
/// The undo stack compares snapshots to decide whether anything changed, and a map that iterated
/// differently between two identical states would record an edit every time the style was touched.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Recipe {
	/// By graph name.
	pub sources: BTreeMap<String, SourceStyle>,
	/// Draw order, bottom first ([S6.5](../../../docs/history.md)).
	///
	/// **A list beside the map rather than a number on each entry.** Reordering is a drag, and a
	/// drag that has to renumber every sibling is how two entries end up claiming one position.
	/// Names absent from it are drawn after those in it, in name order - so a source that arrives
	/// while nobody is looking appears on top rather than vanishing.
	pub order: Vec<String>,
}

impl Recipe {
	/// The recipe as the text the undo stack stores.
	///
	/// JSON rather than anything terser because this is also what goes into `project.yaml`, and a
	/// format only this module can read would make the project file opaque for no saving worth
	/// having at this size.
	pub fn text(&self) -> String {
		// Cannot fail: every field is a plain value or a `serde_json::Value` that was parsed.
		serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
	}

	/// Reads back what [`text`](Self::text) wrote.
	pub fn parse(text: &str) -> Result<Self> {
		serde_json::from_str(text).context("reading the style")
	}

	/// The sources to draw, bottom first.
	///
	/// Everything `order` names and still exists, then everything else in name order. Two rules,
	/// because `order` is a preference rather than a register: a graph removed while a project was
	/// closed must not leave a hole, and one added must not be invisible.
	#[must_use]
	pub fn draw_order<'a>(&self, present: impl IntoIterator<Item = &'a str>) -> Vec<String> {
		let present: std::collections::BTreeSet<&str> = present.into_iter().collect();
		let mut out: Vec<String> = self
			.order
			.iter()
			.filter(|name| present.contains(name.as_str()))
			.cloned()
			.collect();
		for name in &present {
			if !out.iter().any(|seen| seen == name) {
				out.push((*name).to_string());
			}
		}
		out
	}

	/// One source's style, as it stands. `None` for a source nobody has styled.
	#[must_use]
	pub fn source(&self, name: &str) -> Option<&SourceStyle> {
		self.sources.get(name)
	}

	/// One source's style, created from `kind` if this is the first time it is touched.
	///
	/// The kind is taken only on creation. Afterwards the entry owns its own answer, so a later
	/// reading that disagrees cannot silently rewrite a choice someone already made.
	pub fn source_mut(&mut self, name: &str, kind: Option<SourceKind>) -> &mut SourceStyle {
		self.sources.entry(name.to_string()).or_insert_with(|| SourceStyle {
			kind: None,
			appearance: Appearance::for_kind(kind),
		})
	}

	/// Drops overrides for layers the current style has no place for
	/// ([S6.7](../../../docs/history.md)).
	///
	/// **Not something to do on a preset change.** The six presets share one namespace - neutrino's
	/// 207 layer ids are a strict subset of colorful's 324 - so an override on `water` is meant to
	/// survive a switch and apply again on the way back. Keeping them is the feature; what is wrong
	/// is only that an override nothing can apply is invisible, since the tree lists layers rather
	/// than overrides. This is the deliberate clear-out, and it returns how many went so a caller can
	/// say so rather than silently changing the file.
	pub fn prune_overrides(&mut self, source: &str, present: &[String]) -> usize {
		let Some(SourceStyle {
			appearance: Appearance::Vector { overrides, .. },
			..
		}) = self.sources.get_mut(source)
		else {
			return 0;
		};
		let before = overrides.len();
		overrides.retain(|id, _| present.iter().any(|layer| layer == id));
		before - overrides.len()
	}

	/// Moves a source's style when its graph is renamed.
	///
	/// **The one place the name-keyed store meets the id-keyed application.** Without it a rename
	/// silently resets the style to defaults, and the previous settings sit in the file forever
	/// under a name nothing refers to. Renaming onto a name that already has a style replaces it,
	/// which matches `graphs::rename` refusing a clash before this is ever called.
	pub fn rename_source(&mut self, from: &str, to: &str) {
		if from == to {
			return;
		}
		if let Some(style) = self.sources.remove(from) {
			self.sources.insert(to.to_string(), style);
		}
		for name in &mut self.order {
			if name == from {
				*name = to.to_string();
			}
		}
	}

	/// Replaces one layer's override on a vector source, or clears it when nothing is left to say.
	///
	/// Clearing rather than storing an empty patch keeps "reset this layer" and "never touched this
	/// layer" the same state - otherwise a style could export a list of layers that override
	/// nothing, and a user who undid every change would still see the layer marked as edited.
	///
	/// Does nothing for a raster source: there are no layers to override, and creating a vector
	/// appearance to hold the patch would silently change what the source is.
	pub fn set_override(&mut self, source: &str, layer: impl Into<String>, patch: LayerOverride) {
		let Some(SourceStyle {
			appearance: Appearance::Vector { overrides, .. },
			..
		}) = self.sources.get_mut(source)
		else {
			return;
		};
		let layer = layer.into();
		if patch.is_empty() {
			overrides.remove(&layer);
		} else {
			overrides.insert(layer, patch);
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	const GRAPH: &str = "basemap";

	fn edited() -> Recipe {
		let mut recipe = Recipe::default();
		recipe.sources.insert(
			GRAPH.to_string(),
			SourceStyle {
				kind: None,
				appearance: Appearance::Vector {
					preset: Preset::Graybeard,
					recolor: Recolor {
						invert_brightness: Some(true),
						rotate: Some(35.0),
						..Recolor::default()
					},
					overrides: BTreeMap::new(),
				},
			},
		);
		recipe.set_override(
			GRAPH,
			"water",
			LayerOverride {
				paint: Some(serde_json::json!({ "fill-color": "#204080" })),
				..LayerOverride::default()
			},
		);
		recipe
	}

	/// Every source starts styled, so a test that means to edit one says so once.
	fn with_source() -> Recipe {
		let mut recipe = Recipe::default();
		recipe.source_mut(GRAPH, None);
		recipe
	}

	#[test]
	fn a_recipe_survives_the_round_trip_the_undo_stack_puts_it_through() {
		let recipe = edited();
		assert_eq!(Recipe::parse(&recipe.text()).unwrap(), recipe);
	}

	/// **The measurement [Q36] rests on.** A rendered `colorful` is 125 kB across 324 layers, which
	/// is why the stack stores this instead. The number below is not a budget - it is three orders
	/// of magnitude of headroom, and a change that ate it would mean the recipe had quietly become
	/// the style.
	#[test]
	fn a_recipe_is_small_enough_to_snapshot() {
		assert!(
			Recipe::default().text().len() < 128,
			"an untouched recipe is {} bytes",
			Recipe::default().text().len()
		);
		let text = edited().text();
		assert!(text.len() < 1024, "an edited recipe is {} bytes: {text}", text.len());
	}

	/// The undo stack decides whether anything changed by comparing text, so two equal recipes must
	/// produce equal text - which is why the overrides are a `BTreeMap`.
	#[test]
	fn equal_recipes_produce_equal_text() {
		let mut one = with_source();
		let mut two = with_source();
		for layer in ["water", "roads", "buildings", "labels"] {
			let patch = LayerOverride {
				visible: Some(false),
				..LayerOverride::default()
			};
			one.set_override(GRAPH, layer, patch.clone());
			two.set_override(GRAPH, layer, patch);
		}
		// Inserted in one order here and the reverse there; the text must not know.
		let mut three = with_source();
		for layer in ["labels", "buildings", "roads", "water"] {
			three.set_override(
				GRAPH,
				layer,
				LayerOverride {
					visible: Some(false),
					..LayerOverride::default()
				},
			);
		}
		assert_eq!(one.text(), two.text());
		assert_eq!(one.text(), three.text());
	}

	/// Resetting a layer must leave the same state as never having touched it, or a style would
	/// export overrides that override nothing.
	#[test]
	fn an_override_that_says_nothing_is_removed() {
		let mut recipe = with_source();
		let baseline = recipe.text();
		recipe.set_override(
			GRAPH,
			"water",
			LayerOverride {
				visible: Some(false),
				..LayerOverride::default()
			},
		);
		assert_eq!(overrides_of(&recipe).len(), 1);

		recipe.set_override(GRAPH, "water", LayerOverride::default());
		assert!(overrides_of(&recipe).is_empty(), "a reset layer is not a stored layer");
		assert_eq!(recipe.text(), baseline);
	}

	/// A raster source has no layers to override, and inventing a vector appearance to hold a patch
	/// would silently change what the source is.
	#[test]
	fn an_override_on_a_raster_source_is_ignored() {
		let mut recipe = Recipe::default();
		recipe.source_mut(GRAPH, Some(SourceKind::RasterImage));
		let before = recipe.text();
		recipe.set_override(
			GRAPH,
			"water",
			LayerOverride {
				visible: Some(false),
				..LayerOverride::default()
			},
		);
		assert_eq!(recipe.text(), before);
	}

	/// A rename must carry the style with it - otherwise renaming a graph silently resets its style
	/// and leaves the old settings in the file under a name nothing refers to.
	#[test]
	fn a_rename_carries_the_style_over() {
		let recipe = edited();
		let mut renamed = recipe.clone();
		renamed.rename_source(GRAPH, "streets");
		assert!(renamed.source(GRAPH).is_none());
		assert_eq!(renamed.source("streets"), recipe.source(GRAPH));
	}

	/// `order` is a preference, not a register: what it names must not be trusted to exist, and what
	/// exists must not be invisible for being unnamed.
	#[test]
	fn the_draw_order_survives_sources_coming_and_going() {
		let recipe = Recipe {
			order: vec!["basemap".into(), "gone".into()],
			..Recipe::default()
		};

		assert_eq!(
			recipe.draw_order(["places", "basemap"]),
			vec!["basemap".to_string(), "places".to_string()],
			"ordered first, then the rest - and `gone` is not conjured up"
		);
		assert!(recipe.draw_order([]).is_empty());
		assert_eq!(
			recipe.draw_order(["zebra", "alpha"]),
			vec!["alpha".to_string(), "zebra".to_string()],
			"unordered sources fall back to a stable order rather than an arbitrary one"
		);
	}

	/// A rename must move the position as well as the style, or renaming sends a source to the top.
	#[test]
	fn a_rename_carries_the_position_over() {
		let mut recipe = edited();
		recipe.order = vec![GRAPH.into(), "other".into()];
		recipe.rename_source(GRAPH, "streets");
		assert_eq!(recipe.order, vec!["streets".to_string(), "other".to_string()]);
	}

	/// Overrides outlive a preset switch on purpose - the presets share a namespace, and one that
	/// went inert must come back when the preset that has that layer does.
	#[test]
	fn pruning_keeps_what_the_style_still_has() {
		let mut recipe = edited();
		recipe.set_override(
			GRAPH,
			"gone",
			LayerOverride {
				visible: Some(false),
				..LayerOverride::default()
			},
		);
		assert_eq!(overrides_of(&recipe).len(), 2);

		let dropped = recipe.prune_overrides(GRAPH, &["water".to_string()]);
		assert_eq!(dropped, 1, "it says how many went");
		assert_eq!(overrides_of(&recipe).keys().collect::<Vec<_>>(), vec!["water"]);
	}

	#[test]
	fn pruning_a_source_with_no_overrides_changes_nothing() {
		let mut recipe = Recipe::default();
		recipe.source_mut(GRAPH, Some(SourceKind::RasterImage));
		let before = recipe.text();
		assert_eq!(recipe.prune_overrides(GRAPH, &[]), 0);
		assert_eq!(recipe.text(), before);
	}

	fn overrides_of(recipe: &Recipe) -> &BTreeMap<String, LayerOverride> {
		match &recipe.source(GRAPH).expect("the source is styled").appearance {
			Appearance::Vector { overrides, .. } => overrides,
			other => panic!("expected a vector appearance, got {other:?}"),
		}
	}

	/// An untouched recolour is "leave everything alone", not a list of identity values - otherwise
	/// the webview would hand the generator ten settings on a style nobody had adjusted.
	#[test]
	fn an_untouched_recolour_says_nothing() {
		assert!(Recolor::default().is_identity());
		assert!(!Recipe::default().text().contains("rotate"));
		assert!(
			!Recolor {
				gamma: Some(1.2),
				..Recolor::default()
			}
			.is_identity()
		);
	}
}
