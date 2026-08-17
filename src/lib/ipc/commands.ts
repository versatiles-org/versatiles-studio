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
