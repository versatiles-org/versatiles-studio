# VersaTiles Studio

A cross-platform desktop application for working with map tiles: open them, inspect them, build
processing pipelines, design styles, and produce new tile sets — without a terminal and without a
full GIS.

Built on [Tauri](https://tauri.app) and [versatiles-rs](https://github.com/versatiles-org/versatiles-rs).

> **Status: planning.** There is no application code yet. This repository currently holds the
> concept work — vision, audiences, feature catalogue, architecture and the decision log.
> Everything in [`docs/`](docs/) is a draft and up for discussion.

## Release 1

Studio is funded against four milestones:

|        | Milestone                                             | Delivered in |
| ------ | ----------------------------------------------------- | ------------ |
| **M1** | Open and preview all supported tile container formats | stage S1     |
| **M2** | Create your own map style                             | stage S4     |
| **M3** | Convert image and vector data into map tiles          | stage S3     |
| **M4** | Edit VPL and instantly see the result                 | stage S2     |

The stage order is derived from dependencies, not from the milestone numbering. Release 1 targets
**Linux and macOS**; Windows builds and Apple notarisation are deferred, which keeps certificate
procurement off the critical path ([Q10](docs/decisions.md)).

See [Release 1 Scope](docs/scope-release-1.md) for the feature mapping and the work-item breakdown.

## Planning documents

| Document                                   | Contents                                                   |
| ------------------------------------------ | ---------------------------------------------------------- |
| [Vision & Scope](docs/vision.md)           | What Studio is, what it deliberately is not                |
| [Target Audiences](docs/audiences.md)      | Who we build for, and what each group needs                |
| [Feature Catalogue](docs/features.md)      | The full idea pool, grouped and individually referenceable |
| [Release 1 Scope](docs/scope-release-1.md) | Milestones, stages, and the work items in each             |
| [Ecosystem Inventory](docs/ecosystem.md)   | What already exists in versatiles-org and can be reused    |
| [Architecture](docs/architecture.md)       | How the pieces fit together                                |
| [UI Concept](docs/ui.md)                   | How the features are organised on screen, stage by stage   |
| [Decision Log](docs/decisions.md)          | Every question raised, and how it was settled              |
| [Roadmap](docs/roadmap.md)                 | Release 1 at a glance, and what comes after                |

## Identifiers

Five schemes, all single-letter-plus-number so they cannot be confused. Letters are reserved:

| Prefix  | Means                              | Example                                      |
| ------- | ---------------------------------- | -------------------------------------------- |
| `A`–`G` | Feature clusters                   | `C1` — bidirectional node graph              |
| `M`     | Funding milestones                 | `M4` — edit VPL and instantly see the result |
| `P`     | Target audiences                   | `P1` — data journalists and NGOs             |
| `Q`     | Questions/decisions                | `Q11` — the node graph is in release 1       |
| `S`     | Stages, and work items within them | `S2.1` — lossless VPL syntax tree            |

Two rules that cost nothing now and save confusion later:

- **A new feature cluster takes the next free letter, `H` onward, and must stop before `M`.**
  `M`, `P`, `Q` and `S` are taken.
- **Retired identifiers are never reused.** A3 and E5 are dropped; if something else ever became
  "A3", every old issue and commit message would silently lie.

Milestone numbers are the funder's and are never renumbered. Work-item numbers are identity rather
than order — `S2.1` is not necessarily done before `S2.2` — so inserting work never renumbers
anything.

## License

MIT
