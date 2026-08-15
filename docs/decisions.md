# Decisions

Two lists: questions still open, and decisions already taken. When a question is answered, move it
down with a date and a short rationale.

---

## Open questions

### Q1 · Tauri app, or a subcommand serving a browser UI?

Both deliver "a desktop application" in the sense users mean.

|                                             | Tauri app                                   | `versatiles studio` subcommand |
|---------------------------------------------|---------------------------------------------|--------------------------------|
| Code signing, notarisation, installers      | required, costs money and ongoing effort    | none                           |
| Auto-update                                 | must be built                               | comes with the CLI             |
| Double-click a `.mbtiles` file              | yes                                         | no                             |
| Drag & drop, native dialogs                 | yes                                         | limited                        |
| Findable as an application                  | yes                                         | no                             |
| Works on the server holding the 500 GB file | no                                          | yes, over an SSH tunnel        |
| UI reusable in `versatiles-frontend-dev`    | no                                          | yes                            |
| Distribution                                | GitHub releases, Homebrew, package managers | already installed with the CLI |

**Proposal.** One web UI, two shells; treat shell independence as a design constraint from the
start and ship the Tauri shell first. Retrofitting this later is expensive; keeping the option
open now is nearly free. Depends on Q3.

### Q2 · Which audience do we build for first?

Not a question of value but of construction order.

- **Analysis first.** Weeks rather than months, because `probe` already does the work.
  Serves us immediately, generates community feedback, and builds the foundation — map canvas,
  layer stack, container abstraction — that the pipeline editor and style generator sit on. Small
  audience.
- **Creation first.** Much larger audience and the stronger story, but far more work, a
  higher polish bar, and direct competition with QGIS, Felt and Mapbox Studio.

**Proposal.** Analysis first, explicitly as the foundation for creation later — not as a change of
target audience.

### Q3 · How does the UI talk to the core?

Tauri IPC commands, or a local HTTP/JSON API used by both shells? IPC is more idiomatic and less
ceremony; HTTP is portable across shells (Q1), testable without a UI, and scriptable. The embedded
tile server means an HTTP surface exists in the process anyway.

### Q4 · Where do analysis statistics live?

Scanning a large container is expensive and users will re-open the same files. On-demand with an
in-memory cache, a persisted sidecar file next to the container, or results in the project file?
Determines whether cluster B feels instant or sluggish.

### Q5 · How much Node do we tolerate?

`versatiles-svg-renderer` and parts of the style tooling are JS. Bundle a Node runtime, port to
Rust, or degrade gracefully when Node is absent? Affects F6 most.

### Q6 · Project file format

TOML, YAML or JSON — and does it embed the pipeline and style, or reference sibling files?
Embedding makes a project one shareable artefact; referencing keeps `.vpl` and `style.json`
editable by other tools and produces cleaner diffs.

### Q7 · Scope of `planetiler` orchestration (E5)

Requires a JVM. Do we detect and drive an existing installation, download one, or leave this out?
Potentially the decisive feature for P2, and the largest single dependency we would take on.

### Q8 · What is the smallest thing worth releasing?

Related to Q2 but distinct: what does v0.1 have to do for someone to install it a second time?
