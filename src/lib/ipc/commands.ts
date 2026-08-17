// Typed wrappers over the control plane.
//
// Hand-written for now. Once tauri-specta is wired the generated `bindings.ts` lands beside this
// file and these thin out to re-exports — see Q3: the Tauri v2 line is still 2.0.0-rc.x, so the
// generator is deliberately not on the critical path yet.

import { invoke, Channel } from '@tauri-apps/api/core';

export function appVersion(): Promise<string> {
	return invoke<string>('app_version');
}

/** Base URL of the embedded server. The port is ephemeral, so it must be asked for, never assumed. */
export function serverBaseUrl(): Promise<string> {
	return invoke<string>('server_base_url');
}

/** Mirrors `studio_core::jobs::JobEvent`. Replaced by generated types once specta is wired. */
export type JobEvent =
	| { kind: 'progress'; id: number; fraction: number; message: string }
	| { kind: 'log'; id: number; line: string }
	| { kind: 'finished'; id: number }
	| { kind: 'cancelled'; id: number }
	| { kind: 'failed'; id: number; error: string };

/** Smoke test for the event plane; removed when the real job runner lands at S3.1. */
export function demoJob(onEvent: (event: JobEvent) => void): Promise<void> {
	const channel = new Channel<JobEvent>();
	channel.onmessage = onEvent;
	return invoke<void>('demo_job', { channel });
}

/** Mirrors `studio_core::analysis::ContainerInfo`. */
export interface ContainerInfo {
	source: string;
	container: string;
	tileFormat: string;
	tileCompression: string;
	minZoom: number;
	maxZoom: number;
	/** `[west, south, east, north]`. */
	bbox: [number, number, number, number] | null;
	tileJson: Record<string, unknown>;
}

export interface OpenedContainer {
	name: string;
	/** Ready-made MapLibre template; the server port is ephemeral, so never assume it. */
	tileUrl: string;
	/** The `from_container` node this corresponds to in the pipeline (Q22), built by the core. */
	vpl: string;
	info: ContainerInfo;
}

/** Opens a container and mounts it on the embedded server (A1). */
export function openContainer(source: string): Promise<OpenedContainer> {
	return invoke<OpenedContainer>('open_container', { source });
}

/** Mirrors `studio_core::store::RecentEntry`. */
export interface RecentEntry {
	source: string;
	/** Seconds since the Unix epoch. */
	openedAt: number;
}

/**
 * Files the operating system has asked Studio to open since the last call (S0.1).
 *
 * Draining rather than reading: a file double-clicked in Finder arrives before the window exists,
 * and two windows must not both open it.
 */
export function takeOpened(): Promise<string[]> {
	return invoke<string[]>('take_opened');
}

/** The event that says something arrived while the window was already running. */
export const OPENED_EVENT = 'studio://opened';

/** Recently opened sources, newest first (A7). */
export function recentSources(): Promise<RecentEntry[]> {
	return invoke<RecentEntry[]>('recent_sources');
}

export function forgetRecent(source: string): Promise<void> {
	return invoke<void>('forget_recent', { source });
}

/** Mirrors `studio_core::analysis::LayerInspection`. */
export interface LayerInspection {
	name: string;
	featureCount: number;
	encodedBytes: number;
	propertyKeys: string[];
}

/** Mirrors `studio_core::analysis::TileInspection`. */
export interface TileInspection {
	z: number;
	x: number;
	y: number;
	storedBytes: number;
	layers: LayerInspection[];
}

/** Decodes one tile, layer by layer (A4). Null when the tile is absent. */
export function inspectTile(source: string, z: number, x: number, y: number): Promise<TileInspection | null> {
	return invoke<TileInspection | null>('inspect_tile', { source, z, x, y });
}

// -- VPL -----------------------------------------------------------------------------------------

/** Byte offsets into the document. Mirrors `studio_core::vpl::Span`. */
export interface Span {
	start: number;
	end: number;
}

export type VplValue =
	| { kind: 'single'; value: string; quote: 'none' | 'single' | 'double'; span: Span }
	| { kind: 'array'; items: { value: string; quote: string; span: Span }[]; span: Span };

export interface VplProperty {
	key: string;
	keySpan: Span;
	value: VplValue;
	span: Span;
}

export interface VplNode {
	name: string;
	nameSpan: Span;
	/** In source order, with duplicates kept — never alphabetised (Q23). */
	properties: VplProperty[];
	sources: VplPipeline[];
	sourcesSpan: Span | null;
	span: Span;
}

export interface VplPipeline {
	nodes: VplNode[];
	span: Span;
}

/** One highlighted run, from the parser's own tree (Q25). */
export interface VplToken {
	kind: 'operation' | 'key' | 'value' | 'punctuation' | 'comment';
	span: Span;
}

/** How a parameter should be edited. Derived from `field_meta` in the core, never here. */
export type Control =
	| { kind: 'text' }
	| { kind: 'number'; integer: boolean; min: number | null; max: number | null }
	| { kind: 'boolean' }
	| { kind: 'choice'; options: string[] }
	| { kind: 'list' }
	| { kind: 'numbers'; count: number };

export interface FieldInfo {
	name: string;
	/** Upstream's own documentation for the parameter. */
	doc: string;
	required: boolean;
	/** Fed by a `[ … ]` block rather than a `key=value` pair, so it has no control. */
	sources: boolean;
	control: Control;
}

export interface OperationInfo {
	name: string;
	kind: 'read' | 'transform';
	doc: string;
	fields: FieldInfo[];
}

/** Every operation and its parameters. Build-time information, so it is fetched once. */
export function vplOperations(): Promise<OperationInfo[]> {
	return invoke<OperationInfo[]>('vpl_operations');
}

/** The pipeline's output, mounted and ready for the map (C3). */
export interface Preview {
	name: string;
	tileUrl: string;
	info: ContainerInfo;
}

/**
 * Runs the pipeline up to `path` and mounts the result. An empty path means the whole pipeline.
 *
 * Building opens the inputs, so this is not instant on a large source. Null when there is no
 * pipeline, or the path names nothing.
 */
export function previewPipeline(path: number[]): Promise<Preview | null> {
	return invoke<Preview | null>('preview_pipeline', { path });
}

/** A problem with a position — a real operation that does not exist, a parameter that is not one. */
export interface Diagnostic {
	message: string;
	span: Span;
}

/** The whole document a view needs: text, tree, tokens and what is wrong with it. */
export interface DocumentView {
	text: string;
	pipeline: VplPipeline;
	tokens: VplToken[];
	diagnostics: Diagnostic[];
	/** Whether undo and redo have anywhere to go (G6). */
	canUndo: boolean;
	canRedo: boolean;
	/** The `.vpl` this came from, if any — where Save writes without asking. */
	path: string | null;
	/** Whether the pipeline differs from what is on disk. */
	dirty: boolean;
}

/** This window's pipeline, or null before anything is opened. One document per window (Q25). */
export function getPipeline(): Promise<DocumentView | null> {
	return invoke<DocumentView | null>('pipeline');
}

/** Where an edit came from. Only typing coalesces into a single undo step. */
export type EditKind = 'typing' | 'structured' | 'replaced';

/**
 * Replaces the pipeline. Rejects with a {@link VplError} carrying the position of the problem.
 *
 * `kind` decides undo granularity: a burst of keystrokes is one step, a form or graph change is its
 * own. Only the caller knows which this is.
 */
export function setPipeline(text: string, kind: EditKind = 'structured'): Promise<DocumentView> {
	return invoke<DocumentView>('set_pipeline', { text, kind });
}

/**
 * Opens a `.vpl` file as this window's pipeline (C9).
 *
 * Relative paths inside the file resolve against the file, the way `versatiles convert` resolves
 * them, so opening one also moves what later relative sources mean.
 */
export function openVpl(path: string): Promise<DocumentView> {
	return invoke<DocumentView>('open_vpl', { path });
}

/**
 * Writes the pipeline to a `.vpl` file and remembers it as the file this window is editing.
 *
 * The narrower half of saving — the pipeline as the file the CLI already reads. Saving a *project*
 * (G1, S5.1) is a separate command with a different scope: one writes a file, the other a folder.
 */
export function saveVpl(path: string): Promise<DocumentView> {
	return invoke<DocumentView>('save_vpl', { path });
}

/** Steps the document back, or forward again. Null when there is nowhere to go. */
export function undo(): Promise<DocumentView | null> {
	return invoke<DocumentView | null>('undo');
}

export function redo(): Promise<DocumentView | null> {
	return invoke<DocumentView | null>('redo');
}

/** How to paint the text, and what is wrong with it — one parse, so the two cannot disagree. */
export interface Review {
	tokens: VplToken[];
	diagnostics: Diagnostic[];
}

/** Rejects with a {@link VplError} when the text does not parse; there is then no tree to check. */
export function vplReview(text: string): Promise<Review> {
	return invoke<Review>('vpl_review', { text });
}

/** A parse failure with a position, so the editor can place it (C4). */
export interface VplError {
	message: string;
	span: Span;
}

/** Parses VPL into a tree with spans. Rejects with a {@link VplError}. */
export function vplParse(text: string): Promise<VplPipeline> {
	return invoke<VplPipeline>('vpl_parse', { text });
}

/**
 * Sets the value at `span`, returning the whole document.
 *
 * The quoting is decided by the core, never here — a second implementation of VPL's quoting rules
 * in TypeScript is exactly what would drift.
 */
export function vplSetValue(text: string, span: Span, value: string): Promise<string> {
	return invoke<string>('vpl_set_value', { text, span, value });
}

/**
 * Sets a parameter on the node whose *name* occupies `span`, adding it if it is not set.
 *
 * Addressed by node rather than property, because the generated form offers every parameter an
 * operation accepts — including ones the node has no span for yet. More than one value becomes a
 * VPL array.
 */
export function vplSetProperty(text: string, span: Span, key: string, values: string[]): Promise<string> {
	return invoke<string>('vpl_set_property', { text, span, key, values });
}

/** Removes the property at `span`. This is what clearing a field means (see `VplNodeCard`). */
export function vplRemoveProperty(text: string, span: Span): Promise<string> {
	return invoke<string>('vpl_remove_property', { text, span });
}

/** Mirrors `studio_core::store::Layout`. Which left-pane sections are open (Q22). */
export interface Layout {
	pipelineOpen: boolean;
	/** Arrives S4. */
	styleOpen: boolean;
	/** Arrives S5. */
	exportOpen: boolean;
	/** CSS pixels, already clamped by the core. Both pane edges are draggable. */
	leftWidth: number;
	rightWidth: number;
	/** Which background map the map sits on, or `none`. Validated here — the core stores a string
	 *  because the catalogue is a webview concern. */
	background: string;
}

/** The remembered pane layout. Durable state lives in the core, never the webview (Q16). */
export function getLayout(): Promise<Layout> {
	return invoke<Layout>('layout');
}

/** Persists the layout and returns what was actually stored — the core clamps the width. */
export function setLayout(layout: Layout): Promise<Layout> {
	return invoke<Layout>('set_layout', { layout });
}

/** Mirrors `studio_core::store::Bookmark`. */
export interface Bookmark {
	name: string;
	source: string | null;
	lng: number;
	lat: number;
	zoom: number;
	bearing: number;
	pitch: number;
	createdAt: number;
}

/** Named view bookmarks, application-wide (A7). */
export function listBookmarks(): Promise<Bookmark[]> {
	return invoke<Bookmark[]>('list_bookmarks');
}

export function saveBookmark(bookmark: Bookmark): Promise<void> {
	return invoke<void>('save_bookmark', { bookmark });
}

export function deleteBookmark(name: string): Promise<boolean> {
	return invoke<boolean>('delete_bookmark', { name });
}
