# The layer stack

What the map paints is one ordered list of layers, contributed by several sources at once. This
document is the model behind the Layers pane, `Recipe::order`, and the code that puts a reorder onto
a live map.

It exists because that model is spread across five modules and is only correct in all of them at
once: the core stores an order it cannot render, the webview renders an order it does not store, and
the pane drags a tree over layers neither of them owns.

## The one rule

**The stack is an interleaving of per-source sequences.** Within a source, the relative order of its
layers is the style's, not the user's - `colorful` draws its labels above its roads because that is
what `colorful` is. What a reorder changes is only how the sources interleave.

Everything else here is a consequence:

- A run may be dropped **between the neighbouring runs of its own source**, and nowhere else - which
  is what makes `osm ▸ Labels` below `osm ▸ Roads & rails` unreachable rather than merely unusual.
- A project with one source has nothing to move, because there is nothing to interleave with.
- Every graph that has tiles contributes layers, and one that is switched off contributes none
  ([Q49](decisions.md)) - so the stack is a fact about what is built, not about what exists.

## How an order is stored

`Recipe::order` is a list of segments, bottom first. Each names a source and where its run begins:

```rust
pub struct Segment {
    pub source: String,        // the graph's name
    pub from: Option<String>,  // the layer id it starts at, or the source's first layer
}
```

**A list beside the map, not a number on each entry.** Reordering is a drag, and a drag that has to
renumber every sibling is how two entries end up claiming one position.

**Segments rather than names**, because a source may appear more than once - which is what lets
another source be drawn between two of its parts. One entry per source with no boundary is what
every recipe written before segments existed said, and is what such a file still deserialises to.

**Where a run ends is never stored.** The next segment of the same source begins there, and the last
one runs to the end. Storing both would be two facts to keep in step about one boundary.

**The segments are derived from the result, not edited towards it.** `move()` produces the rows in
their new order and `segmentsFrom()` reads the runs back off them, so the boundaries are ascending
by construction. Editing the segment list directly would be a second place the invariant could
break.

### The core stores it and cannot check it

The core never renders a style ([Q36](decisions.md)), so `from` is an opaque layer id to it: it
cannot know which of two ids comes first, and therefore cannot tell a valid order from a broken one.
`set_style_order` takes the whole list and writes it down.

That makes the webview the only side that can enforce the invariant, which `segmentRanges()` does
when it turns boundaries into ranges. Three rules, and each of them is a file that should still
open:

- **The first run always starts at the beginning.** A source's runs partition its layers, so
  whatever the first one names, the layers before it have to be drawn somewhere and there is nowhere
  earlier.
- **A boundary naming a layer this style does not have collapses**, and its run draws nothing - the
  layers stay with the run before it. That is a preset switch that dropped the layer somebody cut
  at, and the arrangement comes back if the preset does ([Q51](decisions.md)).
- **A boundary that does not move forward collapses too.** Segments of one source are ascending by
  construction, so a file saying otherwise was hand-edited or written by a bug, and a run that went
  backwards would draw the same layers twice.

### A source the order does not name

Two rules, applied at both ends - `Recipe::draw_order` and `Recipe::segments` in Rust,
`ordered()` and `segmentsOf()` in `map/stack.ts`:

- A source the order names but **nothing built** is left out. The order is a preference, not a
  register, and a graph that will not build must not leave a hole.
- A source **nothing names** is drawn whole, on top, in name order. One that arrives while nobody is
  looking should appear above the rest rather than vanish.

The Sources pane lists every graph in this same order, built or not ([Q50](decisions.md)), so a
graph that will not build keeps its place in the one control that can move it.

## The tree the pane draws

The Layers pane shows the stack as a tree, three levels under each run of a source: the **category**
a layer is about, the path in its own id, and the layer. `osm ▸ Labels ▸ label ▸ place ▸ city`.

**Runs, not buckets.** Every node is a run of _consecutive_ layers, so a name may legitimately
appear twice with something else between - honestly, because those layers really are painted at
different depths. In `colorful`, `label` spans positions 291-323 with `marking-oneway` and seven
`symbol-transit-*` inside that span; a tree built over prefixes taken globally would describe a map
that is not on screen.

That is also what makes the tree draggable: **every node is a contiguous range**, so moving one is
moving a range, and the boundary it would become is the own id of its first layer.

### Categories

The id level is unreadable on its own. `colorful` is 324 layers whose top-level prefixes form 22
runs, six of them repeated names - `street` three times, `bridge` once as a single layer and once as
ninety-one - because those prefixes encode z-order: the same roads underground, on the surface and
on a bridge. That is the style's engineering, and it is not a category anyone thinks in.

Sixteen prefixes mapped onto nine categories collapse it to nine rows, and `neutrino` to seven,
**without breaking a single run** - which matters more than the tidiness. A category that was not
contiguous in paint order could not be dragged as one thing.

A prefix the table does not know is not a failure: it is a third-party preset, a derived style, or a
preset that has grown a prefix. The tree falls back to the raw first component, which degrades to a
level of the id rather than to a category that would be a guess.

### The eyes

An eye is stored as a path within one source - `Labels/label/place` - and hides everything under it.
`hiddenBy()` answers which eye closed a given layer, nearest first, so the pane can offer to open
the one that did rather than the one that was pressed.

A hidden layer is **still a row**, marked rather than missing: the tree lists what a source draws so
that the eye can be found again, and a row that vanished would be a switch with no way back. The
style handed to MapLibre is the other answer, and those layers are left out of it.

## Two spellings of a layer id

**Ids are prefixed only when more than one source is drawn.** Two vector sources on the same preset
produce identical layer ids, and MapLibre keeps the first - so the upper source would silently
vanish. Prefixing unconditionally would instead rename every layer in the single-source case, which
is what every exported `style.json` and every override written before this already refers to.

So a layer has two names, and which one is meant is never a matter of taste:

| Name                                     | Where it is used                                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Own id** - `label-place-city`          | Overrides, hidden paths, and segment boundaries. Keyed on the style one source drew, before composition renamed anything ([Q51](decisions.md)). |
| **Composed id** - `osm/label-place-city` | The style MapLibre is given, and the rows the tree lists.                                                                                       |

**More than one _source_, not more than one run.** Splitting a source in two does not make its ids
ambiguous, and prefixing on that would rewrite every id the moment somebody dragged a category -
invalidating every override in the recipe for a change that moved nothing.

The source key collides the same way: `@versatiles/style` names its source `versatiles-shortbread`
whatever it was pointed at, so two preset sources would merge into one.

## Putting a reorder on a live map

**`setStyle` cannot express a reorder.** The style specification's own diff has no `moveLayer`
command - `diffLayers` emits `removeLayer` and `addLayer` in pairs - so lifting one category of
`colorful` past a three-layer source comes out as 66 commands, and the whole category of roads as 462.

Worse than the count: re-adding a layer that was just removed makes MapLibre set
`_updatedSources[source] = "reload"` and pause the tile manager, so every loaded tile of that source
is sent back to the worker and re-tessellated. No refetch - the source never changed - but a full
rebuild of everything on screen for a change that moved nothing.

`moveLayer` does none of that: it splices the layer's place in the order and asks for one placement
pass.

**And the fewest moves are not the layers that were dragged.** Moving a run is the same picture as
moving everything it passed, so the cheaper of the two is what should be done. The layers that have
to move are exactly the ones outside a longest increasing subsequence of the old order read through
the new one; everything in that subsequence is already in the right relative place. Measured against
the real presets: 3 calls where the diff would issue 66, and 51 where it would issue 462.

The moves are planned **right to left and applied in that order**. `moveLayer` takes the id to
insert _before_, so each move has to name a layer that is already where it will finally be; walking
backwards makes that true by construction. Sorting the result into any other order would break
exactly that, which is what makes the direction part of the plan rather than a detail of how it was
computed.

**When in doubt, full.** `planReorder` returns `null` for anything that is not exactly the same set
of layers in a different order - a layer added, removed or changed, a source touched, a paint
property adjusted. Those go to `setStyle`, which is what the caller does when this declines. Getting
the answer wrong in that direction costs a flash; the other direction would cost a wrong map.

## Where each part lives

| Question                                                | Answered in                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| What an order is, and how it survives a reload          | `crates/studio-core/src/style/mod.rs` - `Recipe::order`, `Segment` |
| Writing one down                                        | `src-tauri/src/commands/style.rs` - `set_style_order`              |
| Which sources are in the stack, and in what order       | `src/lib/map/stack.ts` - `ordered`, `segmentsOf`, `drawOrder`      |
| Turning boundaries into ranges, and composing the style | `src/lib/map/style.ts` - `segmentRanges`, `composeStyle`           |
| What a layer is _about_                                 | `src/lib/map/categories.ts`                                        |
| The tree, and what a node covers                        | `src/lib/panes/layers/tree.ts`                                     |
| Whether a move is legal, and what it produces           | `src/lib/panes/layers/move.ts`                                     |
| Getting the new order onto the map cheaply              | `src/lib/map/reorder.ts`                                           |
| The pane itself                                         | `src/lib/panes/layers/LayersPane.svelte`, `LayerRow.svelte`        |
