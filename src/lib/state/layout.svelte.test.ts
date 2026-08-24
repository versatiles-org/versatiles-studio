import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layout } from '../ipc/commands';

/**
 * The window's furniture, and the one thing a module buys over four call sites: **every write goes
 * through one funnel**.
 *
 * The layout is read-modify-write on a single record — a pane drag reads it, a toggle reads it, the
 * camera timer reads it. Four call sites each spreading `{ ...layout, … }` is four chances to spread
 * a stale one, and the bug that produces is invisible until two things happen at once.
 */

const ipc = vi.hoisted(() => ({ getLayout: vi.fn(), setLayout: vi.fn() }));
vi.mock('../ipc/commands', () => ipc);

const { layout } = await import('./layout.svelte');

const stored = (over: Partial<Layout> = {}): Layout =>
	({
		leftWidth: 300,
		rightWidth: 300,
		background: 'none',
		panes: [
			{ id: 'pipeline', side: 'left', open: true },
			{ id: 'style', side: 'right', open: false }
		],
		...over
	}) as Layout;

beforeEach(async () => {
	vi.useRealTimers();
	ipc.getLayout.mockResolvedValue(stored());
	ipc.setLayout.mockImplementation((next: Layout) => Promise.resolve(next));
	await layout.load();
	ipc.setLayout.mockClear();
});

describe('the panes', () => {
	it('gives each sidebar the panes that belong to it, in order', () => {
		expect(layout.on('left').map((pane) => pane.id)).toEqual(['pipeline']);
		expect(layout.on('right').map((pane) => pane.id)).toEqual(['style']);
	});

	it('folds one pane without disturbing the others', async () => {
		layout.toggle('style', true);
		await vi.waitFor(() => expect(ipc.setLayout).toHaveBeenCalled());
		const written = ipc.setLayout.mock.calls[0][0] as Layout;
		expect(written.panes).toEqual([
			{ id: 'pipeline', side: 'left', open: true },
			{ id: 'style', side: 'right', open: true }
		]);
		// Everything it did not touch is carried through, not dropped.
		expect(written.leftWidth).toBe(300);
	});
});

describe('a pane being dragged', () => {
	// An atomic write per frame is a lot of disk for a number that is about to change again.
	it('writes nothing until the drag is released', () => {
		layout.resize('left', 420, false);
		expect(layout.current?.leftWidth).toBe(420);
		expect(ipc.setLayout).not.toHaveBeenCalled();
	});

	it('persists on release', async () => {
		layout.resize('right', 500, true);
		await vi.waitFor(() => expect(ipc.setLayout).toHaveBeenCalled());
		expect((ipc.setLayout.mock.calls[0][0] as Layout).rightWidth).toBe(500);
	});
});

describe('the camera', () => {
	it('coalesces, because one scroll-zoom settles several times', async () => {
		vi.useFakeTimers();
		layout.rememberView({ lng: 1, lat: 1, zoom: 4 } as never);
		layout.rememberView({ lng: 2, lat: 2, zoom: 5 } as never);
		layout.rememberView({ lng: 3, lat: 3, zoom: 6 } as never);
		expect(ipc.setLayout).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(500);
		expect(ipc.setLayout).toHaveBeenCalledTimes(1);
		expect((ipc.setLayout.mock.calls[0][0] as Layout).view).toEqual({ lng: 3, lat: 3, zoom: 6 });
	});

	// The layout is read when the timer *fires*, so a pane collapsed mid-gesture is not undone by a
	// camera write carrying the older record.
	it('does not undo a change made while the timer was running', async () => {
		vi.useFakeTimers();
		layout.rememberView({ lng: 1, lat: 1, zoom: 4 } as never);
		layout.toggle('style', true);
		await vi.advanceTimersByTimeAsync(500);

		const last = ipc.setLayout.mock.calls.at(-1)![0] as Layout;
		expect(last.panes?.find((pane) => pane.id === 'style')?.open).toBe(true);
	});
});

describe('the background', () => {
	it('is what the layout says', async () => {
		ipc.getLayout.mockResolvedValue(stored({ background: 'colorful' } as Partial<Layout>));
		await layout.load();
		expect(layout.background).toBe('colorful');
	});

	// An old layout file must not be able to open a window onto a background this build cannot make.
	it('falls back to none for a value this build does not know', async () => {
		ipc.getLayout.mockResolvedValue(stored({ background: 'from-a-later-studio' } as Partial<Layout>));
		await layout.load();
		expect(layout.background).toBe('none');
	});
});

describe('when the core will not have it', () => {
	// The window is already arranged the way they asked; the only loss is that the next one will not
	// be. Interrupting someone for that would be worse than the failure.
	it('keeps what was asked for rather than reverting', async () => {
		ipc.setLayout.mockRejectedValue(new Error('disk full'));
		layout.resize('left', 999, true);
		await vi.waitFor(() => expect(layout.current?.leftWidth).toBe(999));
	});
});
