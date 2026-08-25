# Release 3 Scope

Release 2 made the style pane honest about what it is showing. This release makes **a window mean a
project** — which [Q16](decisions.md) decided at S0.8 and nothing since has actually built.

The stages continue the earlier numbering rather than restarting; `S7.1` is unambiguous where a
third `S1.1` would not be, and the items are what issues get opened against.

The decision this implements, and what it supersedes, is
[Q48](decisions.md#q48--a-window-is-a-project-and-the-launcher-is-a-window-of-its-own).

---

## S7 · One window, one project — and a launcher of its own

**What the code actually does today.** Every piece of project state in `AppState` is a single
app-wide `Mutex`: `graphs`, `style`, `history`, `pinned`, `project_dir`, `project_root` — and
`layout`, which carries the pane widths, the background _and the camera_. So ⌘N opens a second window
onto the same project, sharing one undo stack and one viewport. `open_project`'s own doc comment
concedes it: _"opening a second one beside the first would leave two sets of graphs sharing an undo
stack and a style, which is not a project."_

**And the launcher is a screen inside that window.** `LandingScreen` renders over the map region
whenever there are no graphs, which makes a project window two different things depending on its
contents — and makes "new project" mean "empty this window out".

| Item     | Work                                                                                                                                                                                                                                                                                                                                                                                                               | Feature        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| **S7.1** | ~~**A project per window.**~~ — **done**; `Project` holds the graphs, style, history, pin, directory and root, and `Projects` keys one per window label, created when a window first asks and dropped when it is destroyed. Thirty-four commands take the window they came from. The generated TypeScript did not move: specta skips a `Window` argument the way it skips `AppHandle`, so the webview is unchanged | infrastructure |
| **S7.2** | ~~**Mounts namespaced per window.**~~ — **done**; every mount carries the window's prefix, so `Preview.name` stays the graph's name for the style while the tiles are served from `window-2.pipeline`. `ServerManager::unmount_prefix` takes a closed window's mounts down, and the test for it builds its sources from `from_debug` so it runs without sample containers                                          | infrastructure |
| **S7.3** | ~~**A job list per project.**~~ — **done**; every job carries the window that submitted it, so a bar lists its own project's work, `Lane::Latest` supersedes only within a scope, events reach one sink, and history is pruned per scope. `Lane::Queued` deliberately still serialises application-wide: its argument is about the disk and the cores, which two projects share                                    | E7             |
| **S7.4** | **Layout per window.** Pane widths, background and camera follow the window; the stored `layout.json` becomes the defaults a new window opens with rather than a value two windows fight over                                                                                                                                                                                                                      | infrastructure |
| **S7.5** | **The launcher as a window.** Its own HTML entry and its own small window — import cards, the URL field, recents, open a project. No map, no panes, none of MapLibre                                                                                                                                                                                                                                               | A1, A2, A7     |
| **S7.6** | **The handoff.** Opening something from the launcher creates a project window, hands it the path, and closes the launcher. The queue that already delivers a double-clicked file becomes per window, so there is one way in rather than two                                                                                                                                                                        | infrastructure |
| **S7.7** | **Startup and lifecycle.** The launcher is what opens when the OS passed nothing to open; it comes back when the last project window closes; closing it with nothing else open quits                                                                                                                                                                                                                               | infrastructure |
| **S7.8** | **The menu follows focus.** Item enablement is re-applied when a window takes focus, so a focused launcher cannot disable Save for the project window behind it. `New Project` opens a launcher                                                                                                                                                                                                                    | infrastructure |
| **S7.9** | **The in-window landing screen goes**, and a project window with no graphs left shows a quiet empty workbench rather than a launcher inside a window that is already a project                                                                                                                                                                                                                                     | infrastructure |

**Built in this order, which is close to the numbering but not identical.** S7.1 is the change
everything else stands on. S7.2, S7.3 and S7.4 are not separate features — they are the three places
where app-wide state was doing per-project work, and each is a live bug the moment two windows
exist. They land with S7.1 or immediately after it, before anything invites a person to open a
second project.

S7.5 to S7.9 are the visible half and are mostly new code: a second entry point, a window, and the
wiring between them.

## The three collisions S7.1 exposes

Each was found by reading, not by running, and each produces a symptom nowhere near its cause. They
are worth naming because "make the state per window" sounds complete and is not.

**Mounts are named after the graph.** `build_into` calls `server.mount(name, …)` with the graph's
name, and one server serves the whole application. Two projects with a graph called `pipeline` — the
name a container import gives its first graph — mount over each other, and each window draws the
other's tiles. Pinned previews are worse: every one of them mounts under the literal `preview`.
`Preview` already carries `name` and `tile_url` separately, so the fix has room: the mount key gains
the window, the name stays the graph's, and the style's source ids do not move (S7.2).

**`Lane::Latest` cancels application-wide.** The lane means "newest wins", which is exactly right for
a preview of a document that has since been edited — and catastrophic across projects: every
keystroke in one window cancels the other window's build. The lane needs to know whose it is (S7.3).

**`Layout` holds the camera.** It reads as pane state and is not: `background` and `view` are map
settings, and two windows sharing them means panning one pans the other on its next save (S7.4).

## What breaks, and where it is caught

**`bindings_are_up_to_date` is the tripwire for S7.1.** Around forty commands gain the window they
were called from, and the generated TypeScript changes with every one of them. The test fails until
`src/lib/ipc/bindings.ts` is regenerated, which is what stops a signature drifting silently.

**The job runner's own tests cover S7.3.** `a_latest_job_supersedes_the_one_before_it` is the rule
being narrowed; it needs a sibling proving that two scopes do _not_ supersede each other. _It got
one, plus five more: what a window is listed, where events go, that `Queued` still serialises across
projects, and that forgetting a closed window stops the reporting without stopping the export._

**Nothing catches S7.2 automatically**, which is why it is called out here. Two mounts colliding
produce a map showing plausible tiles from the wrong project — no error, no failed job, nothing in
the problem log. It wants a test at the level of the mount key rather than of the map. _Landed as
four tests in `state.rs` on the naming and two in `server.rs` on the teardown; the latter build their
sources from `from_debug` rather than from a sample container, so the one collision with no runtime
symptom is not also the one whose test skips on most machines._

**The capability list gates the launcher.** `capabilities/default.json` grants permissions to `main`
and `window-*`; a window whose label falls outside that pattern opens and can then call no command at
all, which looks like the application hanging.

## What stays where it is

**One embedded server, one job runner, one core.** Q16's argument for windows over separate
application instances was never about state being global — it was about one Rust core, one server
with named mounts, and one asset writer. All of that stands. What changes is that a _project_ is now
a thing the core holds several of.

**Recents and named views stay application-wide.** They are about the person, not the project: a file
opened in one window is recent everywhere, and a saved view is a place you go back to. Keeping them
per project would mean a launcher that could not list what you last opened, which is most of what a
launcher is for.

**The problem log stays application-wide** (S6.8). It is the account of a _session_ — a panic, a
webview that died, a style that would not parse — and several of the things it records happen outside
any project or take the window with them.
