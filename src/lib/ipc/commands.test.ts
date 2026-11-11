import { describe, expect, it, vi } from 'vitest';
import type { OpenProgress } from './bindings';

/** The wrappers that do more than rename a generated command. */

const generated = vi.hoisted(() => ({ openContainer: vi.fn() }));
vi.mock('./bindings', () => ({ commands: generated }));

// `Channel`'s constructor reaches for `window`. The wrapper only ever assigns `onmessage`.
vi.mock('@tauri-apps/api/core', () => ({
	Channel: class {
		onmessage: ((progress: OpenProgress) => void) | undefined;
	}
}));

const { openContainer } = await import('./commands');

describe('opening a container', () => {
	// A message can still be on its way when the command returns. By then the bar says something else,
	// and a late "reading the tile index · 99%" would draw a bar under it (#21).
	it('passes on progress until the open settles, and nothing after', async () => {
		let channel: { onmessage?: (progress: OpenProgress) => void } = {};
		generated.openContainer.mockImplementation((_source: string, given: typeof channel) => {
			channel = given;
			channel.onmessage?.({ step: 'reading the tile index', fraction: 0.5 });
			return Promise.resolve({ status: 'ok', data: { name: 'planet' } });
		});

		const heard: OpenProgress[] = [];
		await openContainer('planet.pmtiles', (progress) => void heard.push(progress));
		channel.onmessage?.({ step: 'reading the tile index', fraction: 0.99 });

		expect(heard).toEqual([{ step: 'reading the tile index', fraction: 0.5 }]);
	});

	it('stops passing on progress when the open fails, too', async () => {
		let channel: { onmessage?: (progress: OpenProgress) => void } = {};
		generated.openContainer.mockImplementation((_source: string, given: typeof channel) => {
			channel = given;
			return Promise.resolve({ status: 'error', error: 'no such file' });
		});

		const heard: OpenProgress[] = [];
		await expect(openContainer('gone.pmtiles', (progress) => void heard.push(progress))).rejects.toThrow();
		channel.onmessage?.({ step: 'reading the tile index', fraction: 0.5 });

		expect(heard).toEqual([]);
	});
});
