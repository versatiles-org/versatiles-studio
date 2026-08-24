# Release 2 Scope

Release 1 shipped a style pane that works for one kind of tileset. This release makes it work for the
kinds people actually open.

The stages continue release 1's numbering rather than restarting — `S6.1` is unambiguous where a
second `S1.1` would not be, and the items are what issues get opened against.

The case for the work, read against the code rather than against the plan, is in
[Style Use Cases](style-use-cases.md); this is only the work list.

---

## S6 · Style modes → the four things people open

A Shortbread container, a raster of imagery, a DEM, and vector tiles that are not Shortbread. Today
the first works and the other three produce a pane whose every control is a no-op — not disabled, not
explained, just inert.

**Built in this order, which is not the numbering.** The numbers are identity and never change; the
order below is the dependency.

**S6.1 to S6.3 are worth landing on their own.** Each is small, none depends on the others, and each
removes a way the pane currently misleads. If the rest of this stage slips, those three still leave
Studio honest about what it is showing.

**S6.4 is the breaking change and belongs before a release, not after one.** It rewrites what
`project.yaml` carries, and the number of projects in the world only goes up. It is deliberately
separated from S6.5 so two large changes do not land together — the recipe changes shape while the
interface stays still, and then the interface moves over a shape that already works.

| Item     | Work                                                                                                                                                                                                                                                                                                                                                                                                         | Feature        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| **S6.1** | ~~Surface `tile_schema` through `ContainerInfo` and say what a source is being drawn as, with a picker that overrides it~~ — **done**; `map/source-kind.ts` reads the declaration, falls back to the format and the probed layers, and says which of the three it did. The sections that cannot apply say so instead of offering controls that move and change nothing                                       | infrastructure |
| **S6.2** | ~~Derive a style where a preset would draw nothing, instead of drawing none~~ — **done**; `styleFor` owns the decision and reports which of four routes produced the style, so the pane says when a preset was substituted. It refuses to derive over a format the map cannot read as vector                                                                                                                 | D2             |
| **S6.3** | ~~The raster imagery editor~~ — **done**; `RasterAdjust` carries hue, saturation, brightness, contrast, opacity and resampling in MapLibre's own units, and `rasterStyle` emits only the properties that were touched. Not a second reading of `Recolor`: only two of the five share a parameterisation                                                                                                      | D11            |
| **S6.4** | ~~Split the recipe's appearance into a tagged union and migrate `project.yaml` to manifest version 2~~ — **done**; `Recipe` is now one `SourceStyle` per source, keyed by graph name, with `Appearance` as a `vector`/`raster` union. A version-1 recipe migrates onto the first graph. Renaming a graph carries its style with it, which `rename_graph` had been waiting for since S4                       | infrastructure |
| **S6.5** | ~~The source stack: one style over several graphs, drawn bottom-up~~ — **done**; `composeStyle` draws N sources and renames colliding layer _and source_ keys only when more than one draws, `Recipe::order` carries positions through renames, and every graph is built when a project opens rather than on every keystroke. Reordering is up/down rather than drag                                         | D1, D11        |
| **S6.6** | ~~The DEM editor~~ — **done**; a `raster-dem` source with the encoding the container declares, a `hillshade` layer, and controls for relief, light direction and height, and the three colours. `dem/versatiles` draws nothing and says so rather than guessing an unpacking nothing documents                                                                                                               | D12            |
| **S6.7** | ~~Settle the override collision within a source~~ — **done, and the premise was wrong**: the presets share one namespace (`neutrino`'s ids are a subset of `colorful`'s), so overrides are meant to be shared and to come back. What needed fixing was that an inert override is invisible, and that D8's export emitted it into a file with no such layer. Both fixed; clearing is offered, never automatic | infrastructure |

`*` was a stretch item: it landed after S6.4 and blocked nothing.

**S6.6 is last because nothing waits on it.** It is the most new code and the least existing
scaffolding — `add-source.ts` has no `raster-dem` branch and `composeStyle` has no `hillshade` one —
while S6.1 to S6.5 each reuse something that is already written and tested.

## What breaks, and where it is caught

**`bindings_are_up_to_date` is the tripwire for S6.1 and S6.4.** It fails the moment the Rust types
move and the generated TypeScript has not, which is the failure mode worth having: loud, immediate,
and in the same commit as the cause.

**Most existing tests survive.** `style.test.ts` asserts things about `renderStyle` that stay true of
the preset branch; `layer-tree.test.ts` and `filter.test.ts` are about the tree and do not care what
kind a source is. `style-code.test.ts` is the one to read carefully at S6.4 — D8's code export only
means anything for a preset source, and a raster or hillshade source has no `@versatiles/style` code
to emit.

**A version-1 project must keep opening.** The migration in S6.4 is the only place in this stage that
can be got wrong quietly. `project.rs` already carries `Manifest::version` with a `version <= 1`
guard and a test that reads a hand-written manifest string — extend that test rather than replacing
it, so the old shape stays exercised after the new one exists.

## Not in this release

**A bundled reference basemap.** S6.5 makes "a basemap under your data" possible by letting a second
graph sit lower in the stack, which is enough when you have one. Shipping tiles to put there is a
different question: it needs a reference tileset, and [G5](features.md) promises Studio works offline
from first launch, so it would have to be bundled or explicitly optional. Worth deciding once someone
has hit the case.

**Terrain.** D12 names 3-D terrain as in scope only if 3-D is; hillshade is the deliverable and stands
on its own.

## What S6.5 settled: every graph is built when a project opens

`preview.refresh` used to mount one graph, and `preview.svelte.ts` said why — building all of them on
every refresh is "a job apiece for tiles nobody draws". Something draws them now, so the cost had to
land somewhere, and it lands **on open**: `mountAll` builds every graph a project has at the moment a
person is already waiting for it, and `refresh` still rebuilds only the graph being edited. Typing
costs exactly what it cost before.

Three paths keep the stack honest afterwards, each because it is keyed by name: adding a graph is
covered by the refresh that follows it, removing one calls `preview.forget` **before** the name is
gone, and renaming drops the old entry and rebuilds under the new one rather than moving it — the
core remounts anyway, and two sources of truth for one mount is how they drift.

**Reordering is up/down, not drag.** It is reachable from a keyboard, it cannot drop a source
somewhere nobody meant, and the list is short enough that two clicks is not a chore. Drag can be
added later without changing anything below it: the command takes the whole order, not a move.
