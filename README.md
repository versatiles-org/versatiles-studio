# VersaTiles Studio

A cross-platform desktop application for working with map tiles: open them, inspect them, build
processing pipelines, design styles, and produce new tile sets — without a terminal and without a
full GIS.

Built on [Tauri](https://tauri.app) and [versatiles-rs](https://github.com/versatiles-org/versatiles-rs).

> **Status: planning.** There is no application code yet. This repository currently holds the
> concept work — vision, audiences, feature catalogue, architecture and the decision log.
> Everything in [`docs/`](docs/) is a draft and up for discussion.

## Release 1

Studio is funded, and four features are committed for the first release:

1. Open and preview all supported tile container formats.
2. Create your own map style.
3. Convert image and vector data into map tiles.
4. Edit VPL and instantly see the result.

Release 1 targets **Linux and macOS**. Windows builds and Apple notarisation are deferred to a
later release, which keeps certificate procurement off the critical path — see
[Q10](docs/decisions.md).

See [Release 1 Scope](docs/scope-release-1.md) for how these map onto the feature catalogue.

## Planning documents

| Document                                   | Contents                                                   |
| ------------------------------------------ | ---------------------------------------------------------- |
| [Vision & Scope](docs/vision.md)           | What Studio is, what it deliberately is not                |
| [Target Audiences](docs/audiences.md)      | Who we build for, and what each group needs                |
| [Feature Catalogue](docs/features.md)      | The full idea pool, grouped and individually referenceable |
| [Release 1 Scope](docs/scope-release-1.md) | The four committed features, mapped to feature IDs         |
| [Ecosystem Inventory](docs/ecosystem.md)   | What already exists in versatiles-org and can be reused    |
| [Architecture](docs/architecture.md)       | How the pieces fit together                                |
| [UI Concept](docs/ui.md)                   | How the features are organised on screen, stage by stage   |
| [Decision Log](docs/decisions.md)          | Every question raised, and how it was settled              |
| [Roadmap](docs/roadmap.md)                 | Release 1 at a glance, and what comes after                |

## License

MIT
