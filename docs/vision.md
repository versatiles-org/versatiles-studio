# Vision & Scope

VersaTiles Studio is a desktop application that makes the whole life cycle of map tiles - creating,
inspecting, transforming, styling and publishing them - accessible without a terminal and without a
full GIS.

## The problem

The people who most need maps - journalists, NGOs, public administrations - are the least likely to get through that toolchain. The people who do get through it still lack good instrumentation.

## What Studio should be

**A workbench, not a wizard.** It should make the underlying concepts visible rather than hide them. A user who spends a month in Studio should come out understanding tiles better, and should be able to reproduce on a server what they built on their desktop.

Four properties to hold on to:

## What Studio is not

| Not this             | Because                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A QGIS replacement   | No general geoprocessing, no attribute-table editing, no projections zoo. Studio is about _tiles_, not _geodata in general_                                                             |
| A geodata editor     | Drawing features is [`versatiles-map-editor`](https://github.com/versatiles-org/versatiles-map-editor) and iD. Studio consumes geodata, it does not author it                           |
| A new tile generator | The VPL pipeline covers the transformations we own. Planet-scale OSM builds stay with `planetiler` and `tilemaker` on a server ([Q7](decisions.md)); Studio opens and styles the result |
| A hosting product    | Studio can upload somewhere, and can run a local server for testing. It is not a server and not a subscription                                                                          |
| A web app            | It touches large local files and runs long jobs. That is a desktop job ([Q1](decisions.md))                                                                                             |

Saying no early keeps the scope buildable.

## Success, concretely

Scenarios that should feel easy. These double as acceptance tests for the concept:

## Related documents

- Who these scenarios belong to - [Target Audiences](audiences.md) - What is needed to support them - [Feature Catalogue](features.md) - What already exists to build on - [Ecosystem Inventory](ecosystem.md)
