# Vision & Scope

> Draft. Everything here is open for discussion.

VersaTiles Studio is a desktop application that makes the whole life cycle of map tiles — creating,
inspecting, transforming, styling and publishing them — accessible without a terminal and without a
full GIS.

## The problem

Working with vector and raster tiles today means assembling a toolchain by hand. **Inspecting** a
tile set means CLI tools or `sqlite3` on an `.mbtiles` file; questions like _"why are my z14 tiles
so large?"_ are surprisingly hard to answer. **Producing** tiles means learning `tippecanoe`,
`planetiler`, `gdal` or the VersaTiles CLI, each with its own mental model. **Styling** means
hand-editing a `style.json` of several thousand lines, or paying for a hosted studio that locks the
result into one vendor. And **nothing shows you the effect of a change while you make it** — every
iteration is edit → run → reload → squint.

The people who most need maps — journalists, NGOs, public administrations — are the least likely to
get through that toolchain. The people who do get through it still lack good instrumentation.

## What Studio should be

**A workbench, not a wizard.** It should make the underlying concepts visible rather than hide them.
A user who spends a month in Studio should come out understanding tiles better, and should be able
to reproduce on a server what they built on their desktop.

Four properties to hold on to:

1. **Immediate feedback.** Every change — a pipeline parameter, a style colour, a filter — shows its
   effect on the map without an explicit build step.
2. **No lock-in, in either direction.** Everything Studio produces is a plain, documented artefact:
   `.vpl` files, `style.json`, standard tile containers. Everything it consumes can come from
   elsewhere. A project can be handed to a colleague who only uses the CLI.
3. **Local and offline by default.** No account, no cloud round-trip, no telemetry. This is what
   makes Studio usable inside public administrations.
4. **Honest about cost.** Tile work involves operations that take hours and produce gigabytes.
   Studio should estimate before it runs, show progress while it runs, and stay cancellable.

## What Studio is not

Saying no early keeps the scope buildable.

| Not this             | Because                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A QGIS replacement   | No general geoprocessing, no attribute-table editing, no projections zoo. Studio is about _tiles_, not _geodata in general_                                                             |
| A geodata editor     | Drawing features is [`versatiles-map-editor`](https://github.com/versatiles-org/versatiles-map-editor) and iD. Studio consumes geodata, it does not author it                           |
| A new tile generator | The VPL pipeline covers the transformations we own. Planet-scale OSM builds stay with `planetiler` and `tilemaker` on a server ([Q7](decisions.md)); Studio opens and styles the result |
| A hosting product    | Studio can upload somewhere, and can run a local server for testing. It is not a server and not a subscription                                                                          |
| A web app            | It touches large local files and runs long jobs. That is a desktop job ([Q1](decisions.md))                                                                                             |

## Success, concretely

Scenarios that should feel easy. These double as acceptance tests for the concept:

- A journalist has a CSV with one row per municipality and a shapefile of municipal boundaries.
  Thirty minutes later there is a styled, embeddable choropleth on their newsroom's website.
- A developer downloads `osm.versatiles`, cuts out their city, restyles it to match their brand, and
  gets a copy-paste HTML snippet plus a 40 MB file to host.
- A tile maintainer rebuilds a data set, opens old and new side by side, and sees in one screen which
  layers grew, which tiles broke, and whether the result still conforms to the spec.
- A state agency turns a folder of GeoTIFFs into a hillshaded terrain layer, checks it, exports it,
  and gets the exact CLI command to reproduce the whole thing on their own server.

## Related documents

Who these scenarios belong to: [Target Audiences](audiences.md). What is needed to support them:
[Feature Catalogue](features.md). What we already have: [Ecosystem Inventory](ecosystem.md).
