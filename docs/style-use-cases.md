# Style Use Cases

What someone actually opens, what they want to do with it, and what the style pane does about it
today. Four cases, read against the code rather than against the plan — the gaps below are things
that are true of the build, not things that are merely unfinished.

Not to be confused with [Styling](styling.md), which is Studio's own CSS.

## The finding these four share

**The container already declares what it is, and Studio ignores it.** `versatiles_core` publishes
`tile_schema` in TileJSON (`types/tilejson/lib.rs:160`) with exactly the values this needs —
`rgb`, `rgba`, `dem/mapbox`, `dem/terrarium`, `dem/versatiles`, `openmaptiles`, `shortbread@1.0`,
`other`. It arrives inside `ContainerInfo::tile_json`, which is passed through opaque. Searching the
repository for `tile_schema` returns nothing.

Everything the style pane currently decides, it decides by inference instead: `drawsAnything` asks
whether any of a preset's `source-layer` values happen to appear in the container's `vector_layers`,
and treats "no" as "show no style at all".

## The mechanism, once, because all four turn on it

`renderStyle` (`src/lib/map/style.ts:50`) hands the preset builder the pipeline's own tile URL:

```js
// The first source is what the preset's own layers draw from.
tiles: sources.length > 0 ? [throughQueue(sources[0].tileUrl)] : [],
```

So a preset is not applied _beside_ your data or _under_ it — its layers are aimed **at** it. That is
the right thing when the tiles are Shortbread and no thing at all when they are not, which is what
`drawsAnything` then catches, and why `styled` is null for three of the four cases below.

---

## UC1 — A Shortbread vector container

**Has** `europe.versatiles`, Shortbread layer names. **Wants** a basemap that looks good, and a
`style.json` at the end of it.

1. Open it. Hairlines appear while the probe runs.
2. Style pane → `colorful`. The preset's 324 layers point at these tiles, the names match, it draws.
3. Recolor: hue, saturation, brightness, contrast, gamma across every colour at once (D1).
4. Layer tree: hide `boundaries`, recolour `water`, tighten a zoom range (D3).
5. Export `style.json`, a bundle carrying glyphs and sprites, or the recipe as code (D8).

**Today: this works.** It is the case the pane was designed for, and the only one of the four that
needs nothing.

**Gaps.** 324 rows behind a single filter box.

**And a smaller one than it first looked.** Overrides are keyed by bare layer id, which reads like a
collision waiting to happen — but the six presets share one namespace, and `neutrino`'s 207 ids are a
strict _subset_ of `colorful`'s 324. So an override on `water` applies under both, and one on a layer
only `colorful` draws goes quiet under `neutrino` and comes back on the way over. That is the right
behaviour, not rot. `derived:` ids are namespaced apart, so they cannot collide either.

Two real defects sit underneath it, and S6.7 is both: an override with no layer to land on is
**invisible**, because the tree lists layers rather than overrides; and D8's code export emitted it
anyway, producing a loop that sets a property on a layer the generated file does not contain.

---

## UC2 — A raster container of imagery

**Has** `satellite.versatiles`, jpg tiles. **Wants** to brighten it, drop the saturation, and put
labels over it.

**Today:**

1. Open. `renderableAs('jpg')` → a raster source and a `{name}:raster` layer. **The image draws.**
2. `mountedLayers` is empty — a raster TileJSON has no `vector_layers`.
3. Every preset: `drawsAnything(rendered, [])` fails on the empty-array guard → `styled` is null.
4. `derived`: `layers.length === 0` → null.
5. `styled` is therefore _always_ null here. The map shows the background style with the raster layer
   restored on top of it.

**The pane is inert, and nothing says so.** Seven presets that select and do nothing. Five sliders
that move and change nothing. The layer tree reads "Nothing is being drawn yet." Export cannot
generate code. Every control is live and every one is a no-op, which is indistinguishable from a
broken pane.

**The controls are the right controls, but not the same numbers.** The five sliders name the same
ideas MapLibre's `raster-*` paint properties do, and exactly two share a parameterisation: `rotate`
is `raster-hue-rotate` and `saturate` is `raster-saturation`. `Recolor`'s contrast is a multiplier
around `1` where MapLibre's is an offset around `0`, its brightness is an offset where MapLibre's is
a pair of range endpoints, and gamma has no raster equivalent at all. So the raster editor reuses the
slider _component_ and not the recipe field — S6.3 gives it `RasterAdjust`, in MapLibre's own units,
rather than a conversion table nobody could read.

**What the case wants:** those sliders driving the raster layer, plus opacity and resampling
(`nearest` for pixel art, `linear` otherwise), and an optional label overlay above the imagery —
which is what `satellite`'s own note, "for imagery underneath", is already reaching for without
anywhere to put it.

---

## UC3 — A raster container holding a DEM

Separated from UC2 because it is the case where inference cannot work at all.

**Has** `terrain.versatiles`, png tiles, `tile_schema: dem/mapbox`. **Wants** hillshading.

**Today:** identical to UC2 — a flat `raster` layer. What appears is the RGB-encoded elevation drawn
as colour: red-green noise that reads as a corrupt tileset. Nothing anywhere says it is a DEM.

**What the case wants:** a `raster-dem` source whose `encoding` comes straight from the schema, a
`hillshade` layer over it, and controls for exaggeration, illumination direction, and the shadow,
highlight and accent colours. Terrain, if 3-D is ever in scope.

**Why this one settles the argument.** A photograph and a DEM are both `png`, both have no
`vector_layers`, and are identical in every field Studio reads today. `tile_schema` is the only thing
that separates them, so no amount of probing substitutes for the declaration.

---

## UC4 — Vector tiles that are not Shortbread

Pipeline output, or somebody else's tileset. The most common thing the pipeline pane produces.

**Has** a `from_csv` result with one layer, `places`. **Wants** to see the points, on something.

**Today:**

1. The preview mounts; `mountedLayers` is `['places']`.
2. Any preset: no Shortbread name matches → `styled` null → the background.
3. `derived` **works** — polygons under lines under points, each coloured.
4. But there is nothing underneath. The points sit on a hairline grid with no coastline, no roads and
   no context.

**Gaps.** The option that works is offered seventh and described as a curiosity. And Studio already
computes this exact condition at `src/App.svelte:609` — it knows the preset will draw nothing — and
answers by showing no style rather than by deriving one.

---

## What the schema would decide

| `tile_schema`    | What the pane is                                      |
| ---------------- | ----------------------------------------------------- |
| `shortbread@1.0` | The six presets — today's pane                        |
| `openmaptiles`   | Presets where a builder exists, otherwise derived     |
| `rgb` / `rgba`   | Raster adjustment: the sliders, wired to raster paint |
| `dem/*`          | Hillshade and terrain, encoding read from the schema  |
| `other` / absent | Derived, from the probed layers                       |

This replaces a heuristic with a declaration. `drawsAnything` is not wrong — it is doing by
layer-name overlap the job this field states outright — so it stays as the fallback for containers
written before the field existed. `tile_schema` is optional, and an old file will not carry one.

---

# A style pane built around these four

The four cases are not one editor with four skins. Building them that way is what makes "put a
basemap under my data" unanswerable, and it contradicts the model already written down: `project.rs`
calls a graph's name "its source name in the style", and a project has one style over every graph it
serves.

## The mode belongs to the source, not to the pane

The pane is a **stack of sources**, each with its own kind and its own editor:

```
STYLE
────────────────────────────────
  ≡  labels      vector · shortbread   ◉
  ≡  places      vector · derived      ◉
  ≡  hillshade   raster · dem          ◉
  ≡  satellite   raster · imagery      ◉
────────────────────────────────
```

Drag to reorder, toggle to hide. Three problems dissolve at once rather than being solved
separately:

- **"A basemap underneath"** stops being a feature and becomes a source lower in the stack.
- **A project holding a DEM and a vector layer** stops being a contradiction between two recipes
  that share no fields.
- **Overrides scope per source**, so ids from different datasets cannot collide.

It is also what `style.ts:49` already anticipates — _"A preset knows one schema and one source;
naming several is S4.4's problem, not this function's."_

## A source's kind is stated, not guessed

Every source shows what it is being drawn as, and the statement can be corrected:

```
  Interpreted as   [ Raster · DEM (Mapbox) ▾ ]   from the container
```

Default from `tile_schema`, fall back to probing where it is absent, always overridable. **Studio
never has to be right, only honest** — the person whose DEM predates the field says so once, instead
of staring at red-green noise with nothing to act on.

**Kind and appearance are separate.** Kind is what the tiles are; appearance is how they are drawn.
Kind decides what the pane offers, appearance is what was chosen — which keeps "show me this
Shortbread container as derived layers" available, and that is the fastest way to see what a tileset
actually contains.

## Four editors over one skeleton

Every source, whatever its kind, carries **visibility · opacity · zoom range · position in the
stack**. That is the frame. Inside it:

| Kind                   | Appearance                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| **Vector, Shortbread** | Preset picker · recolour (hue, saturation, brightness, contrast, gamma, invert) · layer tree with filter |
| **Vector, other**      | Derived layers · per-layer colour and visibility · small tree                                            |
| **Raster, imagery**    | Hue-rotate · saturation · brightness · contrast · resampling                                             |
| **Raster, DEM**        | Exaggeration · azimuth · altitude · shadow, highlight and accent colours                                 |

The colour-adjustment block is very nearly shared between the two middle rows — four of the five
sliders already in the pane are `raster-*` paint properties under another name, and only gamma has no
raster equivalent. So it is one component with one vector-only control, not four unrelated panels.
DEM does not share it: exaggeration and azimuth are a different axis entirely.

## The recipe this implies

```rust
pub struct Recipe {
    /// Keyed by graph name — already the mount and the source name ([Q32]).
    pub sources: BTreeMap<String, SourceStyle>,
    /// Draw order, bottom first. Names absent from it are appended.
    pub order: Vec<String>,
}

pub struct SourceStyle {
    pub kind: SourceKind,        // defaulted from `tile_schema`, overridable
    pub visible: bool,
    pub opacity: f32,
    pub zoom: Option<(u8, u8)>,
    pub appearance: Appearance,  // tagged union, one variant per kind
}
```

**`Recolor` stops being the only vocabulary.** It is `@versatiles/style`'s; raster and hillshade need
their own. `Appearance` becomes a tagged union, which is a `project.yaml` schema change and a specta
binding change — better done while the number of projects in the world is small.

**[Q32] survives, but only just.** "One style per project" was settled when a project meant one map.
It holds here because the style became a stack over sources rather than a single recipe aimed at
whichever graph happened to be previewed. It would not have survived the per-pane-mode reading.

**`renderStyle` becomes `composeStyle`** — walk the stack, emit each source's layers in order. The
preset builder becomes one branch rather than the whole function; `deriveStyle` is already the
template for the others. `drawsAnything` demotes to a fallback for inferring kind where `tile_schema`
is absent.

## The override question, as it turned out

This document originally posed it as a collision — key overrides under the preset, or prune them —
and both answers were wrong because the premise was. The presets share a namespace on purpose, so
overrides _should_ be shared, and one that goes quiet under a smaller preset _should_ come back under
a larger one. Nothing needed re-keying.

What was actually broken was narrower and both halves are fixed in S6.7: an inert override was
invisible, and the code export emitted it into a file with no such layer. Clearing them is offered
and never automatic — an override gone quiet under one preset is work someone may be in the middle of
comparing.

# Implementation plan

Seven steps, tracked as **S6.1 – S6.7** in [Release 2 Scope](scope-release-2.md), which is where the
ordering rationale and the migration risks live. The numbering below matches: step 1 is S6.1.

The first three are small and each one removes a way the pane currently misleads, so they are worth
landing on their own even if the rest waits. Step 4 is the breaking change.

### 1 · Read `tile_schema` and say what a source is

Surface it through `ContainerInfo` rather than leaving callers to dig in the opaque `tile_json`, then
show it in the pane with a picker that overrides it.

- `crates/studio-core/src/analysis.rs` — a `tile_schema: Option<String>` field beside `tile_format`
- `src/lib/panes/style/StylePane.svelte` — the "Interpreted as" row
- Probing stays as the fallback: no schema means the old inference

Nothing else changes yet. On its own this makes UC2 and UC3 stop lying about what they are showing.

### 2 · Derive where a preset would draw nothing

`src/App.svelte:609` already computes the condition and answers "no style". Answer "derive one"
instead.

- One branch in the `styled` derivation; `deriveStyle` already exists and is already tested
- Fixes UC4, which is the most common thing the pipeline pane produces

### 3 · The raster imagery editor

The controls exist and point at the wrong thing.

- `src/lib/map/style.ts` — a raster branch emitting one `raster` layer with `raster-*` paint
- `src/lib/panes/style/StylePane.svelte` — the slider block, minus gamma, plus resampling
- Fixes UC2 without touching the recipe's shape yet, by treating the raster settings as a `Recolor`
  read differently

### 4 · Split `Appearance` into a tagged union — **the breaking change**

- `crates/studio-core/src/style/mod.rs` — `SourceKind`, `Appearance`, `SourceStyle`
- `crates/studio-core/src/project.rs` — bump `Manifest::version` to `2` and migrate a version-1
  recipe into a single-source stack. The version field and its `version <= 1` guard already exist,
  so the mechanism is there
- `src-tauri/src/bindings.rs` — regenerate; `bindings_are_up_to_date` will fail until it is
- `src/lib/state/style.svelte.ts`, `src/lib/ipc/commands.ts` — follow the new shape
- Still single-source: the stack is one entry deep, so nothing in the UI moves yet

Doing this before the stack keeps two large changes from landing together, and doing it before a
release keeps the migration to one hop.

### 5 · The source stack

- `composeStyle` replaces `renderStyle`'s single-source assumption; `sources[0]` disappears
- `src/App.svelte` — pass every mounted graph, not `preview.last` alone
- `StylePane` — the list, drag-to-reorder, per-source expand
- This is where "a basemap underneath" becomes possible without a new concept

### 6 · The DEM editor

- `add-source.ts` — a `raster-dem` source with `encoding` from the kind
- A `hillshade` branch in `composeStyle`, plus its controls
- Most new code, least existing scaffolding, and no other step depends on it

### 7 · Decide the override-collision question

Prune with a notice, or key by preset. Small either way, and it can land any time after step 4.

## What to watch

**`bindings_are_up_to_date`** is the tripwire for steps 1 and 4 — it fails the moment the Rust types
move and the generated TypeScript has not.

**The existing tests are mostly still right.** `style.test.ts` asserts things about `renderStyle`
that stay true of the preset branch; `layer-tree.test.ts` and `filter.test.ts` are about the tree and
do not care about kinds. `style-code.test.ts` is the one to read carefully at step 4, since D8's code
export only means anything for a preset source.

**A version-1 project must keep opening.** The migration in step 4 is the only place that can be got
wrong quietly, and `project.rs` already has a test that reads a hand-written manifest string —
extend it rather than replacing it.
