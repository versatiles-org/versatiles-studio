/**
 * The control plane, as the application uses it.
 *
 * **The types and the invoke calls are generated** — see `bindings.ts` and `src-tauri/src/
 * bindings.rs`. Every interface here used to be written twice, once in Rust and once in TypeScript,
 * and `svelte-check` cannot catch that drift: it flags a *use* of a missing field, not a missing
 * field, so adding one on the Rust side and forgetting this one failed nothing until somebody read
 * it.
 *
 * What is left here is the part a generator cannot produce:
 *
 * * **The error convention.** `tauri-specta` returns `{ status: 'ok' | 'error' }` rather than
 *   throwing. Studio's call sites are `try`/`catch`, and a rejected promise carrying the error is
 *   what an editor wants — a parse failure with a span has to reach a `catch`, not be checked for.
 *   `unwrap` below converts one into the other, in one place.
 * * **Names that read at the call site**, where the generated one is shaped by the Rust function:
 *   `getPipeline` rather than `pipeline`, which would shadow the variable holding it everywhere.
 */

import { commands } from './bindings';

export * from './bindings';

/**
 * Aliases for the tree types, whose generated names come from the Rust ones.
 *
 * `Node`, `Pipeline`, `Value` and `Token` are all names the DOM or the language already uses, and a
 * component importing `Node` to mean a VPL operation is a trap. The prefix says which world they
 * belong to.
 */
export type {
	Camera,
	Node as VplNode,
	Pipeline as VplPipeline,
	Property as VplProperty,
	Value as VplValue,
	Token as VplToken,
	TokenKind as VplTokenKind
} from './bindings';

/**
 * Turns tauri-specta's result object back into a promise that rejects.
 *
 * The error is thrown as-is rather than wrapped, so a `VplError` still arrives at the `catch` with
 * its `message` and its `span` — which is the whole point of C4.
 */
async function unwrap<T, E>(result: Promise<{ status: 'ok'; data: T } | { status: 'error'; error: E }>): Promise<T> {
	const outcome = await result;
	if (outcome.status === 'error') throw outcome.error;
	return outcome.data;
}

/** The event that says the OS asked Studio to open something while it was already running. */
export const OPENED_EVENT = 'studio://opened';

// -- shell -----------------------------------------------------------------------------------

export const appVersion = () => commands.appVersion();

/** Base URL of the embedded server. The port is ephemeral, so it must be asked for, never assumed. */
export const serverBaseUrl = () => unwrap(commands.serverBaseUrl());

/** Files the OS has asked Studio to open since the last call. Draining, so two windows cannot both. */
export const takeOpened = () => commands.takeOpened();

// -- jobs ------------------------------------------------------------------------------------

/** Points the runner's events at this window, and returns the list as it stood at that instant. */
export const subscribeJobs = (channel: Parameters<typeof commands.subscribeJobs>[0]) =>
	unwrap(commands.subscribeJobs(channel));

/** One job's log, oldest line first. Fetched when a row is expanded, not streamed on connect. */
export const jobLog = (id: number) => unwrap(commands.jobLog(id));

/** Asks a job to stop. Idempotent — a job that has already ended stays ended. */
export const cancelJob = (id: number) => unwrap(commands.cancelJob(id));

// -- sources ---------------------------------------------------------------------------------

/** Opens a container and mounts it on the embedded server (A1). Does not touch the pipeline. */
export const openContainer = (source: string) => unwrap(commands.openContainer(source));

/** Recently opened sources, newest first (A7). */
export const recentSources = () => unwrap(commands.recentSources());

export const forgetRecent = (source: string) => unwrap(commands.forgetRecent(source));

/** Decodes one tile, layer by layer (A4). Null when the tile is absent. */
export const inspectTile = (source: string, z: number, x: number, y: number) =>
	unwrap(commands.inspectTile(source, z, x, y));

// -- bookmarks -------------------------------------------------------------------------------

export const listBookmarks = () => unwrap(commands.listBookmarks());
export const saveBookmark = (bookmark: Parameters<typeof commands.saveBookmark>[0]) =>
	unwrap(commands.saveBookmark(bookmark));
export const deleteBookmark = (name: string) => unwrap(commands.deleteBookmark(name));

// -- layout ----------------------------------------------------------------------------------

/** The remembered pane layout. Durable state lives in the core, never the webview (Q16). */
export const getLayout = () => unwrap(commands.layout());

/** Persists the layout and returns what was actually stored — the core clamps the widths. */
export const setLayout = (layout: Parameters<typeof commands.setLayout>[0]) => unwrap(commands.setLayout(layout));

// -- VPL -------------------------------------------------------------------------------------

/** Parses VPL into a tree with spans. Rejects with a `VplError` carrying the position. */
export const vplParse = (text: string) => unwrap(commands.vplParse(text));

/**
 * Sets the value at `span`.
 *
 * The quoting is decided by the core, never here — a second implementation of VPL's quoting rules
 * in TypeScript is exactly what would drift.
 */
export const vplSetValue = (text: string, span: Parameters<typeof commands.vplSetValue>[1], value: string) =>
	unwrap(commands.vplSetValue(text, span, value));

/** Sets a parameter by node, which is how a multi-part value and an absent parameter are both set. */
export const vplSetProperty = (
	text: string,
	span: Parameters<typeof commands.vplSetProperty>[1],
	key: string,
	values: string[]
) => unwrap(commands.vplSetProperty(text, span, key, values));

/** Adds an operation to the chain, right after the node whose name occupies `span`. */
export const vplInsertNode = (text: string, span: Parameters<typeof commands.vplInsertNode>[1], operation: string) =>
	unwrap(commands.vplInsertNode(text, span, operation));

/** Removes a node and the separator that joined it. Refused when it would empty the pipeline. */
export const vplRemoveNode = (text: string, span: Parameters<typeof commands.vplRemoveNode>[1]) =>
	unwrap(commands.vplRemoveNode(text, span));

/** Removes the property at `span`. This is what clearing a field means (see `NodeCard`). */
export const vplRemoveProperty = (text: string, span: Parameters<typeof commands.vplRemoveProperty>[1]) =>
	unwrap(commands.vplRemoveProperty(text, span));

/** How to paint the text and what is wrong with it — one parse, so the two cannot disagree. */
export const vplReview = (text: string) => unwrap(commands.vplReview(text));

/** Every operation and its parameters. Build-time information, so it is fetched once. */
export const vplOperations = () => commands.vplOperations();

// -- imports ---------------------------------------------------------------------------------

/** Every way this build can bring data in (S3.2). Build-time information, so it is fetched once. */
export const importKinds = () => commands.importKinds();

/** Which kind a path belongs to, or null for a file Studio has no way in for. */
export const importKindFor = (path: string) => commands.importKindFor(path);

/**
 * The read node a chosen file becomes, quoting included — and, for a CSV, its coordinate columns
 * already filled in when the header names them unambiguously (S3.4). Both are the core's decisions.
 */
export const importReadNode = (kindId: string, path: string) => commands.importReadNode(kindId, path);

/** Values the selected node's fields could take, read from what the node points at (S3.4). */
export const fieldSuggestions = (graph: number, path: number[]) => unwrap(commands.fieldSuggestions(graph, path));

// -- the pipeline ----------------------------------------------------------------------------

/** Every graph in the project, in the order the pane shows them (Q32). */
export const listGraphs = () => unwrap(commands.graphs());

/** One graph in full, or null once it has been removed. */
export const getGraph = (id: number) => unwrap(commands.graph(id));

/** Creates a graph. `name` is a suggestion — the core makes it unique and URL-safe. */
/** Creates a graph. The core names it after `source` — one rule for every way in ([Q35]). */
export const addGraph = (source: string | null, text: string) => unwrap(commands.addGraph(source, text));

export const removeGraph = (id: number) => unwrap(commands.removeGraph(id));

/** Renames a graph and returns the name it took. Refused when another graph has it. */
export const renameGraph = (id: number, name: string) => unwrap(commands.renameGraph(id, name));

/** Replaces a graph's text. `kind` decides undo granularity — only the caller knows which this is. */
export const setGraph = (id: number, text: string, kind: Parameters<typeof commands.setGraph>[2] = 'structured') =>
	unwrap(commands.setGraph(id, text, kind));

/** Opens a `.vpl` file as this window's pipeline (C9). Paths inside resolve against the file. */
export const openVpl = (path: string) => unwrap(commands.openVpl(path));

/** Writes a graph to a `.vpl` file and remembers it as that graph's file. */
export const saveVpl = (graph: number, path: string) => unwrap(commands.saveVpl(graph, path));

/**
 * Runs a graph up to `path`, mounts the result, and pins the map to it. An empty path means the
 * whole graph.
 */
export const previewPipeline = (graph: number, path: number[]) => unwrap(commands.previewPipeline(graph, path));

/** Builds a graph in full and mounts it under its own name — the ordinary view (Q32). */
export const mountGraph = (graph: number) => unwrap(commands.mountGraph(graph));

/** Where the map is looking, or null for the ordinary state. */
export const getPinned = () => unwrap(commands.pinned());

/** Pins the map to one node, or clears the pin. Exactly one across the project. */
export const setPin = (pin: { graph: number; path: number[] } | null) => unwrap(commands.setPin(pin));

/**
 * Steps back, or forward again. Null when there is nowhere to go.
 *
 * One stack across every graph (Q32), so what comes back may belong to a graph other than the one
 * being edited — which is why it returns the whole document rather than just its text.
 */
export const undo = () => unwrap(commands.undo());
export const redo = () => unwrap(commands.redo());
