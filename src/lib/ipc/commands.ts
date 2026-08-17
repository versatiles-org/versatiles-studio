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
}

/** This window's pipeline, or null before anything is opened. One document per window (Q25). */
export function getPipeline(): Promise<DocumentView | null> {
	return invoke<DocumentView | null>('pipeline');
}

/** Replaces the pipeline. Rejects with a {@link VplError} carrying the position of the problem. */
export function setPipeline(text: string): Promise<DocumentView> {
	return invoke<DocumentView>('set_pipeline', { text });
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

/** Removes the property at `span`. This is what clearing a field means — VPL has no empty value. */
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
	/** CSS pixels, already clamped by the core. */
	leftWidth: number;
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
