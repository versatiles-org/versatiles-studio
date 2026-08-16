// Typed wrappers over the control plane.
//
// Hand-written for now. Once tauri-specta is wired (S0.3) the generated `bindings.ts` lands beside
// this file and these wrappers thin out to re-exports. See Q3 — the Tauri v2 line is still an RC.

import { invoke } from '@tauri-apps/api/core';

export function appVersion(): Promise<string> {
	return invoke<string>('app_version');
}
