//! The style, stored as what it is made from (S4.2, S4.7, [Q36]).
//!
//! A project has one style ([Q32]) over every graph it serves. What lives here is **not** a MapLibre
//! style: it is the recipe one is rendered from — a preset, the adjustments applied to it, and
//! whatever individual layers were changed by hand.
//!
//! **Because the rendered style does not fit the stack it would have to live on.** Undo takes whole
//! snapshots, which is exact and cheap for a pipeline of a few hundred bytes; `colorful` renders to
//! 125 kB across 324 layers, so a session's undo history would be 25 MB of it. The recipe is a few
//! hundred bytes and rides the same mechanism ([Q36] has the measurement).
//!
//! **The generator stays in the webview**, where `@versatiles/style` already is. This module never
//! produces a style — it describes one. That is also what makes D8's "export as `@versatiles/style`
//! code" possible at all: the code *is* the recipe, and a design that kept only the rendered output
//! could not have got it back.
//!
//! [Q32]: ../../docs/decisions.md
//! [Q36]: ../../docs/decisions.md

use anyhow::{Context, Result};
use std::collections::BTreeMap;

/// Where a style starts before anything is adjusted.
///
/// The six are `@versatiles/style`'s own builders, named as it names them so the webview needs no
/// translation table — a mapping between two spellings of the same six things is a thing to keep in
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
	/// Swap light for dark while keeping the hues — D5's whole feature, in one flag.
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
/// **Sparse, and only these three.** [D3](../../docs/features.md) asks for filter, zoom range and
/// paint, all of which are properties *of* a layer — none of them adds, removes or reorders one,
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

/// The whole style, as the core holds it.
///
/// Ordered by layer id (`BTreeMap`, not `HashMap`) so that the text this serialises to depends only
/// on its contents. The undo stack compares snapshots to decide whether anything changed, and a map
/// that iterated differently between two identical states would record an edit every time the style
/// was touched.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(feature = "bindings", derive(specta::Type))]
pub struct Recipe {
	pub preset: Preset,
	pub recolor: Recolor,
	/// By layer id. Empty for a style nobody has edited by hand.
	pub overrides: BTreeMap<String, LayerOverride>,
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

	/// Replaces one layer's override, or clears it when there is nothing left to say.
	///
	/// Clearing rather than storing an empty patch keeps "reset this layer" and "never touched this
	/// layer" the same state — otherwise a style could export a list of layers that override
	/// nothing, and a user who undid every change would still see the layer marked as edited.
	pub fn set_override(&mut self, layer: impl Into<String>, patch: LayerOverride) {
		let layer = layer.into();
		if patch.is_empty() {
			self.overrides.remove(&layer);
		} else {
			self.overrides.insert(layer, patch);
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn edited() -> Recipe {
		let mut recipe = Recipe {
			preset: Preset::Graybeard,
			recolor: Recolor {
				invert_brightness: Some(true),
				rotate: Some(35.0),
				..Recolor::default()
			},
			overrides: BTreeMap::new(),
		};
		recipe.set_override(
			"water",
			LayerOverride {
				paint: Some(serde_json::json!({ "fill-color": "#204080" })),
				..LayerOverride::default()
			},
		);
		recipe
	}

	#[test]
	fn a_recipe_survives_the_round_trip_the_undo_stack_puts_it_through() {
		let recipe = edited();
		assert_eq!(Recipe::parse(&recipe.text()).unwrap(), recipe);
	}

	/// **The measurement [Q36] rests on.** A rendered `colorful` is 125 kB across 324 layers, which
	/// is why the stack stores this instead. The number below is not a budget — it is three orders
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
	/// produce equal text — which is why the overrides are a `BTreeMap`.
	#[test]
	fn equal_recipes_produce_equal_text() {
		let mut one = Recipe::default();
		let mut two = Recipe::default();
		for layer in ["water", "roads", "buildings", "labels"] {
			let patch = LayerOverride {
				visible: Some(false),
				..LayerOverride::default()
			};
			one.set_override(layer, patch.clone());
			two.set_override(layer, patch);
		}
		// Inserted in one order here and the reverse there; the text must not know.
		let mut three = Recipe::default();
		for layer in ["labels", "buildings", "roads", "water"] {
			three.set_override(
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
		let mut recipe = Recipe::default();
		recipe.set_override(
			"water",
			LayerOverride {
				visible: Some(false),
				..LayerOverride::default()
			},
		);
		assert_eq!(recipe.overrides.len(), 1);

		recipe.set_override("water", LayerOverride::default());
		assert!(recipe.overrides.is_empty(), "a reset layer is not a stored layer");
		assert_eq!(recipe.text(), Recipe::default().text());
	}

	/// An untouched recolour is "leave everything alone", not a list of identity values — otherwise
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
