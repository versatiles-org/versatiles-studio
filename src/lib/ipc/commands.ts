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
